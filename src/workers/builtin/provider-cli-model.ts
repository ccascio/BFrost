import { spawn } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { config } from '../../config';

export interface CliLanguageModelConfig {
  providerId: string;
  modelId: string;
  command: string;
  clearEnv?: readonly string[];
  buildArgs(modelId: string, outputPath: string): string[];
  readOutput(outputPath: string, stdout: string): Promise<string>;
}

const FINISH_STOP: LanguageModelV3FinishReason = { unified: 'stop', raw: 'stop' };
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function makeUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
}

function textFromPart(part: unknown): string {
  const value = part as { type?: string; text?: unknown; output?: unknown; toolName?: unknown };
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  if (value.type === 'reasoning' && typeof value.text === 'string') return value.text;
  if (value.type === 'tool-result') return `[tool result${typeof value.toolName === 'string' ? `: ${value.toolName}` : ''}] ${JSON.stringify(value.output ?? '')}`;
  if (value.type === 'file') return '[file attachment omitted: subscription CLI provider accepts text only]';
  if (value.type === 'tool-call') return '[assistant requested a tool call; subscription CLI provider does not execute tools]';
  return '';
}

function messageToText(message: LanguageModelV3Message): string {
  if (message.role === 'system') return `System:\n${message.content}`;
  const content = Array.isArray(message.content)
    ? message.content.map(textFromPart).filter(Boolean).join('\n')
    : '';
  return `${message.role[0].toUpperCase()}${message.role.slice(1)}:\n${content}`;
}

function promptToText(options: LanguageModelV3CallOptions): string {
  const segments = options.prompt.map(messageToText).filter((segment) => segment.trim().length > 0);
  const instructions: string[] = [
    'You are being called by BFrost as a text-only language model provider.',
    'Return only the final answer text. Do not run tools or edit files.',
  ];
  if (options.responseFormat?.type === 'json') {
    instructions.push('The caller requested JSON. Return valid JSON only.');
  }
  if (options.tools && options.tools.length > 0) {
    instructions.push('The caller offered tools, but this subscription CLI provider cannot execute them. Answer from the prompt context only.');
  }
  return `${instructions.join('\n')}\n\n${segments.join('\n\n')}`.trim();
}

async function runCli(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  clearEnv: readonly string[] | undefined,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const key of clearEnv ?? []) {
      delete env[key];
    }
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Subscription CLI command timed out after ${config.jobLlmTimeoutMs}ms.`));
    }, config.jobLlmTimeoutMs);

    function finish(fn: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn();
    }

    function onAbort() {
      child.kill('SIGKILL');
      finish(() => reject(new Error('Subscription CLI command aborted.')));
    }

    signal?.addEventListener('abort', onAbort);

    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk);
    });
    child.on('error', (err) => {
      finish(() => reject(err));
    });
    child.on('close', (code, signalName) => {
      const stdout = Buffer.concat(chunks).toString('utf8');
      const stderr = Buffer.concat(errorChunks).toString('utf8');
      if (code === 0) {
        finish(() => resolve({ stdout, stderr }));
        return;
      }
      const suffix = stderr.trim() || stdout.trim() || signalName || `exit ${code}`;
      finish(() => reject(new Error(`Subscription CLI command failed: ${suffix}`)));
    });

    child.stdin.end(input);
  });
}

export function createCliLanguageModel(settings: CliLanguageModelConfig): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: settings.providerId,
    modelId: settings.modelId,
    supportedUrls: {},

    async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-provider-cli-'));
      const outputPath = path.join(dir, 'response.txt');
      try {
        const prompt = promptToText(options);
        const { stdout } = await runCli(
          settings.command,
          settings.buildArgs(settings.modelId, outputPath),
          prompt,
          dir,
          settings.clearEnv,
          options.abortSignal,
        );
        const text = (await settings.readOutput(outputPath, stdout)).trim();
        return {
          content: [{ type: 'text', text }],
          finishReason: FINISH_STOP,
          usage: makeUsage(),
          warnings: options.tools && options.tools.length > 0
            ? [{ type: 'unsupported', feature: 'tools', details: 'Subscription CLI mode is text-only.' }]
            : [],
        };
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      }
    },

    async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
      const result = await this.doGenerate(options);
      const text = result.content.find((part) => part.type === 'text')?.text ?? '';
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          const id = 'cli-text-0';
          controller.enqueue({ type: 'stream-start', warnings: result.warnings });
          controller.enqueue({ type: 'text-start', id });
          controller.enqueue({ type: 'text-delta', id, delta: text });
          controller.enqueue({ type: 'text-end', id });
          controller.enqueue({ type: 'finish', finishReason: FINISH_STOP, usage: makeUsage() });
          controller.close();
        },
      });
      return { stream };
    },
  };
}
