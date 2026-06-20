import { existsSync, readFileSync } from 'fs';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Message,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { config } from '../../../config';

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const FALLBACK_EXPIRY_MS = 60 * 60 * 1000;
const FINISH_STOP: LanguageModelV3FinishReason = { unified: 'stop', raw: 'stop' };
const FINISH_TOOL_CALLS: LanguageModelV3FinishReason = { unified: 'tool-calls', raw: 'tool-calls' };

interface CodexCredential {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  idToken?: string;
}

interface CodexAuthFile {
  auth_mode?: string;
  OPENAI_API_KEY?: string;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

function makeUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
}

function resolveCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return configured ? resolveHome(configured) : path.join(os.homedir(), '.codex');
}

function resolveHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function decodeJwtExpiry(token: string): number | undefined {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
}

function decodeJwtAccountId(token: string): string | undefined {
  const authClaim = decodeJwtPayload(token)?.['https://api.openai.com/auth'];
  if (!authClaim || typeof authClaim !== 'object') return undefined;
  const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id;
  return typeof accountId === 'string' && accountId.trim() ? accountId : undefined;
}

async function readCodexCredentials(): Promise<CodexCredential | null> {
  const authPath = path.join(resolveCodexHome(), 'auth.json');
  let raw: CodexAuthFile;
  try {
    raw = JSON.parse(await readFile(authPath, 'utf8')) as CodexAuthFile;
  } catch {
    return null;
  }
  const access = raw.tokens?.access_token;
  const refresh = raw.tokens?.refresh_token;
  if (!access || !refresh) return null;
  let fallbackExpiry = Date.now() + FALLBACK_EXPIRY_MS;
  try {
    fallbackExpiry = (await stat(authPath)).mtimeMs + FALLBACK_EXPIRY_MS;
  } catch {
    // Keep the conservative in-memory fallback.
  }
  return {
    access,
    refresh,
    expires: decodeJwtExpiry(access) ?? fallbackExpiry,
    accountId: raw.tokens?.account_id,
    idToken: raw.tokens?.id_token,
  };
}

async function persistCodexCredentials(credentials: CodexCredential): Promise<void> {
  const authPath = path.join(resolveCodexHome(), 'auth.json');
  await mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 });
  let raw: CodexAuthFile = {};
  try {
    raw = JSON.parse(await readFile(authPath, 'utf8')) as CodexAuthFile;
  } catch {
    // If the file disappeared after we read it, recreate only the auth fields we own.
  }
  raw.tokens = {
    ...(raw.tokens ?? {}),
    access_token: credentials.access,
    refresh_token: credentials.refresh,
    id_token: credentials.idToken ?? raw.tokens?.id_token,
    account_id: credentials.accountId ?? raw.tokens?.account_id,
  };
  raw.last_refresh = new Date().toISOString();
  await writeFile(authPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
}

export async function persistOpenAICodexSubscriptionCredentials(credentials: CodexCredential): Promise<void> {
  await persistCodexCredentials(credentials);
}

async function refreshCodexCredentials(refreshToken: string, signal?: AbortSignal): Promise<CodexCredential> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
    }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI Codex token refresh failed (${response.status}): ${text || response.statusText}`);
  }
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('OpenAI Codex token refresh response was missing access_token, refresh_token, or expires_in.');
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    idToken: json.id_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId: decodeJwtAccountId(json.access_token),
  };
}

export function readOpenAICodexSubscriptionReady(): boolean {
  const authPath = path.join(resolveCodexHome(), 'auth.json');
  if (!existsSync(authPath)) return false;
  try {
    const raw = JSON.parse(readFileSync(authPath, 'utf8')) as CodexAuthFile;
    return Boolean(raw.tokens?.access_token && raw.tokens.refresh_token);
  } catch {
    return false;
  }
}

async function getFreshCodexCredentials(signal?: AbortSignal): Promise<CodexCredential> {
  const credentials = await readCodexCredentials();
  if (!credentials) {
    throw new Error('Codex ChatGPT login not found. Run `codex login` and choose ChatGPT, then retry.');
  }
  if (Date.now() < credentials.expires - 60_000) {
    return credentials;
  }
  const refreshed = await refreshCodexCredentials(credentials.refresh, signal);
  refreshed.accountId ||= credentials.accountId;
  await persistCodexCredentials(refreshed);
  return refreshed;
}

function textFromPart(part: unknown): string {
  const value = part as { type?: string; text?: unknown; output?: unknown; toolName?: unknown; input?: unknown };
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  if (value.type === 'reasoning' && typeof value.text === 'string') return value.text;
  if (value.type === 'tool-result') return `[tool result${typeof value.toolName === 'string' ? `: ${value.toolName}` : ''}] ${formatToolOutput(value.output)}`;
  if (value.type === 'file') return '[file attachment omitted: ChatGPT subscription transport accepts text only]';
  if (value.type === 'tool-call') return `[assistant called tool${typeof value.toolName === 'string' ? `: ${value.toolName}` : ''}] ${JSON.stringify(value.input ?? {})}`;
  return '';
}

function formatToolOutput(output: unknown): string {
  const value = output as { type?: string; value?: unknown; reason?: unknown };
  if (value?.type === 'text' && typeof value.value === 'string') return value.value;
  if (value?.type === 'json') return JSON.stringify(value.value);
  if (value?.type === 'error-text' && typeof value.value === 'string') return `Error: ${value.value}`;
  if (value?.type === 'error-json') return `Error: ${JSON.stringify(value.value)}`;
  if (value?.type === 'execution-denied') return `Execution denied${typeof value.reason === 'string' ? `: ${value.reason}` : ''}`;
  return JSON.stringify(output ?? '');
}

function messageToText(message: LanguageModelV3Message): string {
  if (message.role === 'system') return String(message.content);
  const content = Array.isArray(message.content)
    ? message.content.map(textFromPart).filter(Boolean).join('\n')
    : '';
  return `${message.role[0].toUpperCase()}${message.role.slice(1)}:\n${content}`;
}

function promptToText(options: LanguageModelV3CallOptions): string {
  const segments = options.prompt.map(messageToText).filter((segment) => segment.trim().length > 0);
  const instructions = [
    'You are being called by BFrost as a language model provider.',
    options.tools && options.tools.length > 0
      ? 'Use the provided function tools when they are needed to answer accurately.'
      : 'Return only the final answer text. Do not edit files.',
  ];
  if (options.responseFormat?.type === 'json') {
    instructions.push('The caller requested JSON. Return valid JSON only.');
  }
  return `${instructions.join('\n')}\n\n${segments.join('\n\n')}`.trim();
}

function buildResponsesTools(tools: LanguageModelV3CallOptions['tools']): Array<Record<string, unknown>> {
  return (tools ?? [])
    .filter((tool): tool is LanguageModelV3FunctionTool => tool.type === 'function')
    .map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: tool.strict ?? false,
    }));
}

function buildRequestBody(modelId: string, options: LanguageModelV3CallOptions): Record<string, unknown> {
  const tools = buildResponsesTools(options.tools);
  const body: Record<string, unknown> = {
    model: modelId,
    store: false,
    stream: true,
    instructions: 'Follow the user request.',
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: promptToText(options) || ' ' }],
      },
    ],
    text: { verbosity: 'low' },
    include: ['reasoning.encrypted_content'],
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
    body.parallel_tool_calls = true;
  }
  return body;
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('');
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  return Object.values(record).map(extractText).filter(Boolean).join('');
}

function readSseDataLines(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;
  for (;;) {
    const separator = rest.indexOf('\n\n');
    if (separator < 0) break;
    const rawEvent = rest.slice(0, separator);
    rest = rest.slice(separator + 2);
    const data = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .join('\n');
    if (data) events.push(data);
  }
  return { events, rest };
}

type ParsedCodexResponse = {
  content: LanguageModelV3Content[];
  finishReason: LanguageModelV3FinishReason;
};

type PendingToolCall = {
  id: string;
  callId: string;
  name: string;
  argumentsText: string;
};

function parseToolInput(value: string): string {
  if (!value.trim()) return '{}';
  try {
    return JSON.stringify(JSON.parse(value));
  } catch {
    return value;
  }
}

function lastToolCall(calls: Map<string, PendingToolCall>): PendingToolCall | null {
  const values = Array.from(calls.values());
  return values.length > 0 ? values[values.length - 1] : null;
}

function collectCompletedResponse(value: unknown): ParsedCodexResponse | null {
  const response = value as { output?: unknown };
  if (!Array.isArray(response.output)) return null;
  const content: LanguageModelV3Content[] = [];
  for (const item of response.output as Array<Record<string, unknown>>) {
    if (item.type === 'function_call' && typeof item.name === 'string') {
      const callId = typeof item.call_id === 'string'
        ? item.call_id
        : typeof item.id === 'string'
          ? item.id
          : `call_${content.length}`;
      content.push({
        type: 'tool-call',
        toolCallId: callId,
        toolName: item.name,
        input: parseToolInput(typeof item.arguments === 'string' ? item.arguments : '{}'),
      });
    }
  }
  const text = extractText(response.output).trim();
  if (text) content.unshift({ type: 'text', text });
  if (content.some((part) => part.type === 'tool-call')) {
    return { content, finishReason: FINISH_TOOL_CALLS };
  }
  return content.length > 0 ? { content, finishReason: FINISH_STOP } : null;
}

async function parseResponsesSse(response: Response): Promise<ParsedCodexResponse> {
  if (!response.body) throw new Error('OpenAI Codex response did not include a body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const deltas: string[] = [];
  let completed: ParsedCodexResponse | null = null;
  let buffer = '';
  let activeToolCall: PendingToolCall | null = null;
  const toolCalls = new Map<string, PendingToolCall>();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const parsed = readSseDataLines(buffer);
    buffer = parsed.rest;
    for (const data of parsed.events) {
      if (data === '[DONE]') continue;
      const event = JSON.parse(data) as Record<string, unknown>;
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        deltas.push(event.delta);
      } else if (event.type === 'response.output_item.added') {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call' && typeof item.name === 'string') {
          const callId = typeof item.call_id === 'string'
            ? item.call_id
            : typeof item.id === 'string'
              ? item.id
              : `call_${toolCalls.size}`;
          const pending = {
            id: typeof item.id === 'string' ? item.id : callId,
            callId,
            name: item.name,
            argumentsText: typeof item.arguments === 'string' ? item.arguments : '',
          };
          activeToolCall = pending;
          toolCalls.set(pending.id, pending);
        }
      } else if (event.type === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
        activeToolCall = activeToolCall ?? lastToolCall(toolCalls);
        if (activeToolCall) activeToolCall.argumentsText += event.delta;
      } else if (event.type === 'response.function_call_arguments.done') {
        activeToolCall = activeToolCall ?? lastToolCall(toolCalls);
        if (activeToolCall && typeof event.arguments === 'string') {
          activeToolCall.argumentsText = event.arguments;
        }
      } else if (event.type === 'response.output_item.done') {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === 'function_call' && typeof item.name === 'string') {
          const id = typeof item.id === 'string' ? item.id : undefined;
          const callId = typeof item.call_id === 'string' ? item.call_id : id ?? `call_${toolCalls.size}`;
          const pending = (id ? toolCalls.get(id) : undefined) ?? {
            id: id ?? callId,
            callId,
            name: item.name,
            argumentsText: '',
          };
          pending.callId = callId;
          pending.name = item.name;
          pending.argumentsText = typeof item.arguments === 'string' ? item.arguments : pending.argumentsText;
          toolCalls.set(pending.id, pending);
          activeToolCall = null;
        }
      } else if (event.type === 'response.completed') {
        completed = collectCompletedResponse(event.response);
      } else if (event.type === 'error' || event.type === 'response.failed') {
        const message = extractText(event.error) || extractText(event.response) || 'OpenAI Codex response failed.';
        throw new Error(message);
      }
    }
  }
  const toolCallContent = Array.from(toolCalls.values()).map((call) => ({
    type: 'tool-call' as const,
    toolCallId: call.callId,
    toolName: call.name,
    input: parseToolInput(call.argumentsText),
  }));
  const text = deltas.join('').trim();
  if (toolCallContent.length > 0) {
    return {
      content: [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...toolCallContent,
      ],
      finishReason: FINISH_TOOL_CALLS,
    };
  }
  if (text) return { content: [{ type: 'text', text }], finishReason: FINISH_STOP };
  if (completed) return completed;
  return { content: [{ type: 'text', text: '' }], finishReason: FINISH_STOP };
}

async function generateWithCodex(modelId: string, options: LanguageModelV3CallOptions): Promise<ParsedCodexResponse> {
  const timeoutSignal = AbortSignal.timeout(config.jobLlmTimeoutMs);
  const signal = options.abortSignal
    ? AbortSignal.any([options.abortSignal, timeoutSignal])
    : timeoutSignal;
  const credentials = await getFreshCodexCredentials(signal);
  const accountId = credentials.accountId || decodeJwtAccountId(credentials.access);
  if (!accountId) {
    throw new Error('Codex OAuth token did not include a ChatGPT account id.');
  }
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.access}`,
      'chatgpt-account-id': accountId,
      originator: 'bfrost',
      'OpenAI-Beta': 'responses=experimental',
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'User-Agent': `bfrost (${os.platform()} ${os.release()}; ${os.arch()})`,
    },
    body: JSON.stringify(buildRequestBody(modelId, options)),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI Codex Responses request failed (${response.status}): ${text || response.statusText}`);
  }
  return parseResponsesSse(response);
}

export function createOpenAICodexSubscriptionLanguageModel(modelId: string): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'openai',
    modelId,
    supportedUrls: {},

    async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
      const result = await generateWithCodex(modelId, options);
      return {
        content: result.content,
        finishReason: result.finishReason,
        usage: makeUsage(),
        warnings: [],
      };
    },

    async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
      const result = await this.doGenerate(options);
      const text = result.content.find((part) => part.type === 'text')?.text ?? '';
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          const id = 'openai-codex-text-0';
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
