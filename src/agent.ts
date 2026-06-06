import { generateText, jsonSchema, stepCountIs, tool, ModelMessage, UserContent } from 'ai';
import { getChatModel } from './llm';
import { findModel } from './config';
import { getHistory, addUserMessage, addAssistantMessage, getSelectedModel } from './conversation';
import { runWithChatContext } from './chat-context';
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
- Do not think out loud or reason step by step. Go straight to the answer.`;

/** Build the tool catalog exposed to the LLM from worker-declared tools. */
function buildAgentToolCatalog(): Record<string, any> {
  const catalog: Record<string, any> = {};
  for (const registered of listRegisteredTools()) {
    const manifest: WorkerToolManifest = registered.manifest;
    if (manifest.defaultEnabled === false) continue;
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

  const result = await generateText({
    model: getChatModel(modelOption),
    system: SYSTEM_PROMPT,
    tools: buildAgentToolCatalog(),
    stopWhen: stepCountIs(3),
    timeout: 600000,
    messages,
  });
  return result.text;
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

  addUserMessage(input.chatId, content);

  const messages: ModelMessage[] = getHistory(input.chatId);
  const { runChatTurn } = (await import('./job-runner')) as { runChatTurn: typeof RunChatTurnFn };
  // Make the active project/conversation visible to worker tools (e.g. document
  // retrieval) for the whole turn, including the AI SDK tool-execution chain.
  const { text } = await runWithChatContext(
    { conversationId: input.conversationId, projectId: input.projectId ?? null },
    () => runChatTurn(getSelectedModel(input.chatId), (model) => runAgent(messages, model.id)),
  );

  addAssistantMessage(input.chatId, text);

  return { text };
}
