import { generateText, jsonSchema, stepCountIs, tool, ModelMessage, UserContent } from 'ai';
import { getChatModel, resolveNativeWebSearch } from './llm';
import { findModel, getDefaultModelAlias } from './config';
import {
  getHistory,
  addUserMessage,
  addAssistantMessage,
  getSelectedModel,
  setSelectedModel,
  getSelectedReasoningLevel,
  setSelectedReasoningLevel,
} from './conversation';
import { runWithChatContext, getActiveChatContext } from './chat-context';
import { listRegisteredTools } from './workers/registry';
import { buildJobToolCatalog } from './workers/job-tools';
import type { WorkerToolManifest } from './workers/types';
// Lazy import to avoid the agent ↔ job-runner cycle at module load time.
import type { runChatTurn as RunChatTurnFn } from './job-runner';

export interface AgentInput {
  chatId: number;
  userId: number;
  username?: string;
  message: string;
  imageBase64?: string;
  imageMimeType?: string;
  /** Opaque conversation id for the active turn (exposed to worker tools via chat context). */
  conversationId?: string;
  /** Optional project grouping that scopes the turn for worker tools. */
  projectId?: string | null;
  /**
   * Model this thread should switch to, as an alias or id. Sticky: it is remembered for
   * subsequent turns of the same thread. Omitted means keep whatever the thread already
   * uses (falling back to the platform default).
   */
  modelAlias?: string;
  /** Reasoning level for this thread. Sticky in the same way as {@link modelAlias}. */
  reasoningLevel?: string;
}

export interface AgentResponse {
  text: string;
}

const SYSTEM_PROMPT = `You are J.A.R.V.I.S. — Just A Rather Very Intelligent System — a personal AI assistant inspired by Tony Stark's legendary companion.

Core traits:
- You are sharp, resourceful, and slightly witty — never over the top, always composed.
- You address your user with quiet respect, like a trusted advisor. Occasionally a dry remark, never sarcasm.
- You are proactive: anticipate needs, connect dots, suggest next steps.
- You are concise. No filler. Every word earns its place.
- When you don't know something, say so clearly — then use your tools to find out.

Style:
- Respond in the same language the user writes in.
- Keep responses short and actionable unless depth is explicitly requested.
- Do not think out loud or reason step by step. Go straight to the answer.

Artifacts:
You can produce self-contained artifacts that are rendered in a dedicated panel beside the chat. Use artifacts for substantial, standalone content the user will want to view, copy, or iterate on — not for brief inline answers.

To create an artifact, wrap it with the directive syntax:

  :::artifact{identifier="kebab-case-id" type="mime-type" title="Human-readable title"}
  \`\`\`
  content here
  \`\`\`
  :::

Supported types:
- text/markdown — formatted documents, reports, notes
- text/html — complete single-file HTML pages (include all CSS/JS inline; no external resources except https://cdnjs.cloudflare.com)
- application/vnd.react — a React component; must use a default export named App; use hooks freely; Tailwind is available for styling
- application/vnd.mermaid — a Mermaid diagram definition
- text/plain — plain text, config files, scripts, etc.

Rules:
- Use a stable kebab-case identifier so follow-up edits reuse the same panel slot.
- Always emit the complete, final content — no placeholders or "…rest stays the same".
- One artifact per response unless the user explicitly requests multiple.
- Prefer inline answers for anything under ~15 lines or purely explanatory.`;

/** Build the tool catalog exposed to the LLM from worker-declared tools. */
function buildAgentToolCatalog(suppressCapabilities?: Set<string>): Record<string, any> {
  const catalog: Record<string, any> = {};
  for (const registered of listRegisteredTools()) {
    const manifest: WorkerToolManifest = registered.manifest;
    if (manifest.defaultEnabled === false) continue;
    if (manifest.capability && suppressCapabilities?.has(manifest.capability)) continue;
    catalog[manifest.name] = tool({
      description: manifest.description,
      inputSchema: jsonSchema<any>(manifest.inputSchema as any),
      execute: async (input: any) => {
        console.log(`[Tool:${manifest.name}] (worker ${manifest.workerId}) invoked.`);
        try {
          return await manifest.execute(input);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Tool:${manifest.name}] failed:`, err);
          return `Tool ${manifest.name} failed: ${msg}`;
        }
      },
    });
  }
  for (const [name, jobTool] of Object.entries(buildJobToolCatalog())) {
    if (catalog[name]) {
      console.warn(`[Agent] Job tool ${name} collides with an existing tool; job tool ignored.`);
      continue;
    }
    catalog[name] = jobTool;
  }
  return catalog;
}

export async function runAgent(messages: ModelMessage[], modelId: string): Promise<string> {
  const modelOption = findModel(modelId);
  if (!modelOption) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const { projectId } = getActiveChatContext();
  const system = projectId
    ? `${SYSTEM_PROMPT}\n\nProject context: the user has a project active. They may have uploaded documents to it. Always call your document-search tool before answering any topic-specific question — even if you believe you already know the answer from general knowledge. Project files are the authoritative source for anything in them.`
    : SYSTEM_PROMPT;

  // Providers that can search the web themselves get their native web-search tool instead
  // of the worker-provided search tool, which stays reserved for providers without that
  // capability (e.g. local models).
  const nativeWebSearch = resolveNativeWebSearch(modelOption);
  const model = nativeWebSearch ? nativeWebSearch.model : getChatModel(modelOption);
  const tools = {
    ...buildAgentToolCatalog(nativeWebSearch ? new Set(['web-search']) : undefined),
    ...(nativeWebSearch?.tools ?? {}),
  };

  const result = await generateText({
    model,
    system,
    tools,
    stopWhen: stepCountIs(8),
    timeout: 600000,
    messages,
  });
  // Local models (Qwen3 extended-thinking) sometimes emit an empty text when the
  // summary lands in the reasoning block. Fall back through steps to find the last
  // non-empty text; if none exists, emit a neutral confirmation.
  if (result.text) return result.text;
  for (let i = result.steps.length - 1; i >= 0; i--) {
    if (result.steps[i].text) return result.steps[i].text;
  }
  return 'Done.';
}

export async function processMessage(input: AgentInput): Promise<AgentResponse> {
  console.log(`[Agent] Processing message from ${input.username ?? input.userId}: "${input.message}"`);

  let content: UserContent;
  if (input.imageBase64) {
    content = [
      ...(input.message ? [{ type: 'text' as const, text: input.message }] : []),
      { type: 'image' as const, image: input.imageBase64, mediaType: input.imageMimeType },
    ];
  } else {
    content = input.message;
  }

  // A switch sent with the turn sticks to the thread. An unknown alias is ignored rather
  // than rejected — the message is already in the history and must still get an answer.
  const requestedModel = input.modelAlias ? findModel(input.modelAlias) : undefined;
  if (requestedModel) setSelectedModel(input.chatId, requestedModel.id);
  if (input.reasoningLevel !== undefined) {
    setSelectedReasoningLevel(input.chatId, input.reasoningLevel);
  }

  addUserMessage(input.chatId, content);

  const messages: ModelMessage[] = getHistory(input.chatId);
  // A thread can outlive the model it was pinned to (provider disabled, model pulled).
  // Fall back to the platform default rather than failing the turn.
  const storedModel = getSelectedModel(input.chatId);
  const modelAlias = findModel(storedModel) ? storedModel : getDefaultModelAlias();
  const { runChatTurn } = (await import('./job-runner')) as { runChatTurn: typeof RunChatTurnFn };
  // Make the active project/conversation visible to worker tools (e.g. document
  // retrieval) for the whole turn, including the AI SDK tool-execution chain.
  const { text } = await runWithChatContext(
    { conversationId: input.conversationId, projectId: input.projectId ?? null },
    () =>
      runChatTurn(
        modelAlias,
        (model) => runAgent(messages, model.id),
        { reasoningLevel: getSelectedReasoningLevel(input.chatId) },
      ),
  );

  addAssistantMessage(input.chatId, text);

  return { text };
}
