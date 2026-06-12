import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import type { ProviderAdapter } from '../../module';

const PROVIDER_ID = 'demo';
const MODEL_ID = 'demo-brain';

// Fixed canned response returned for every prompt. Intentionally generic and plausible
// as a synthesis of tech/AI items so it reads correctly in the context where workers
// usually call generateText (news digests, research notes).
const CANNED_TEXT = [
  'The material points to a consistent direction: ownership and control of AI tooling are moving back to the operator.',
  ' Self-hosted runtimes and local inference close the cost and latency gap for routine work; plugin-based architectures keep the core extensible without forks;',
  ' approval gates ensure autonomy never means losing oversight.',
  ' Taken together these trends define a new class of AI operations infrastructure —',
  ' one that you run, extend, and inspect on your own hardware without ongoing cloud dependency.',
  '\n\n*[Demo Brain — zero-credential placeholder. Connect a real provider for live AI synthesis.]*',
].join('');

const FINISH_STOP: LanguageModelV3FinishReason = { unified: 'stop', raw: 'stop' };

function makeUsage(): LanguageModelV3Usage {
  return {
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  };
}

function createDemoBrain(): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: PROVIDER_ID,
    modelId: MODEL_ID,
    supportedUrls: {},

    async doGenerate(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
      return {
        content: [{ type: 'text', text: CANNED_TEXT }],
        finishReason: FINISH_STOP,
        usage: makeUsage(),
        warnings: [],
      };
    },

    async doStream(_options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
      const TEXT_ID = 'demo-text-0';
      const chunks = CANNED_TEXT.match(/.{1,40}/gs) ?? [CANNED_TEXT];

      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: TEXT_ID });
          for (const chunk of chunks) {
            controller.enqueue({ type: 'text-delta', id: TEXT_ID, delta: chunk });
          }
          controller.enqueue({ type: 'text-end', id: TEXT_ID });
          controller.enqueue({ type: 'finish', finishReason: FINISH_STOP, usage: makeUsage() });
          controller.close();
        },
      });

      return { stream };
    },
  };
}

export function createDemoProviderAdapter(): ProviderAdapter {
  const brain = createDemoBrain();
  return {
    providerId: PROVIDER_ID,
    isConfigured() {
      return true;
    },
    getChatModel(_modelId: string) {
      return brain;
    },
    async listAvailableModels() {
      return [{ id: MODEL_ID, alias: 'demo-brain', label: 'Demo Brain (no API key)' }];
    },
  };
}
