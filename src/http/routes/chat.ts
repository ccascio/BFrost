import { generateText } from 'ai';
import { HttpRouter } from '../router';
import { readJsonBody, sendJson } from '../responses';
import { availableModels } from '../../config';
import { getChatModel } from '../../llm';
import { recordEventSafe } from '../../event-log';
import { processChannelMessage } from '../../channel';
import { getFullHistory } from '../../conversation';
import {
  listThreads,
  getThread,
  renameThread,
  assignThreadProject,
  clearProjectFromThreads,
  deleteThread,
} from '../../chat-threads';
import {
  listProjects,
  getProject,
  createProject,
  renameProject,
  deleteProject,
} from '../../projects';
import { buildDashboardState } from '../../admin-dashboard-state';
import {
  ChatMessageBodySchema,
  ChatThreadUpdateBodySchema,
  ProjectCreateBodySchema,
  ProjectRenameBodySchema,
} from '../../admin-api';

function extractTurnText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function registerChatRoutes(router: HttpRouter): void {
  router.add('POST', '/api/chat', async (req, res) => {
    const body = await readJsonBody(req, ChatMessageBodySchema);
    const response = await processChannelMessage({
      channel: 'dashboard',
      conversationId: body.conversationId ?? 'dashboard-admin',
      userId: 'admin',
      username: 'dashboard',
      text: body.message,
      projectId: body.projectId,
    });
    await recordEventSafe({
      category: 'chat',
      action: 'dashboard_message',
      summary: 'Dashboard chat message processed.',
      metadata: {
        conversationId: body.conversationId ?? 'dashboard-admin',
        messageLength: body.message.length,
        responseLength: response.text.length,
      },
    });
    return sendJson(res, 200, { response: response.text, dashboard: await buildDashboardState() });
  });

  router.add('POST', '/api/provider-ping', async (_req, res) => {
    const models = availableModels.filter((m) => m.provider !== 'demo');
    if (models.length === 0) {
      return sendJson(res, 400, { error: 'No real model provider configured.' });
    }
    const model = models[0];
    try {
      const result = await generateText({
        model: getChatModel(model),
        messages: [{ role: 'user', content: 'Say hello and tell me your name in one short sentence.' }],
      });
      return sendJson(res, 200, { ok: true, model: model.label, response: result.text.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, 200, { ok: false, error: msg });
    }
  });

  router.add('GET', '/api/chats', async (_req, res) => {
    return sendJson(res, 200, { threads: listThreads('dashboard') });
  });

  router.add('GET', '/api/chats/:id', async (_req, res, { params }) => {
    const conversationId = params.id;
    const thread = getThread(conversationId);
    if (!thread) return sendJson(res, 404, { error: 'Chat not found' });
    const turns = getFullHistory(thread.chatId)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role, text: extractTurnText(message.content) }))
      .filter((turn) => turn.text.length > 0);
    return sendJson(res, 200, { thread, turns });
  });

  router.add('PATCH', '/api/chats/:id', async (req, res, { params }) => {
    const conversationId = params.id;
    const body = await readJsonBody(req, ChatThreadUpdateBodySchema);
    if (!getThread(conversationId)) return sendJson(res, 404, { error: 'Chat not found' });
    if (body.title !== undefined) renameThread(conversationId, body.title);
    const updated =
      body.projectId !== undefined
        ? assignThreadProject(conversationId, body.projectId)
        : getThread(conversationId);
    return sendJson(res, 200, { thread: updated });
  });

  router.add('DELETE', '/api/chats/:id', async (_req, res, { params }) => {
    if (!deleteThread(params.id)) return sendJson(res, 404, { error: 'Chat not found' });
    return sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/projects', async (_req, res) => {
    return sendJson(res, 200, { projects: listProjects() });
  });

  router.add('POST', '/api/projects', async (req, res) => {
    const body = await readJsonBody(req, ProjectCreateBodySchema);
    const project = createProject(body.name);
    return sendJson(res, 201, { project });
  });

  router.add('PATCH', '/api/projects/:id', async (req, res, { params }) => {
    const body = await readJsonBody(req, ProjectRenameBodySchema);
    const updated = renameProject(params.id, body.name);
    if (!updated) return sendJson(res, 404, { error: 'Project not found' });
    return sendJson(res, 200, { project: updated });
  });

  router.add('DELETE', '/api/projects/:id', async (_req, res, { params }) => {
    const projectId = params.id;
    if (!getProject(projectId)) return sendJson(res, 404, { error: 'Project not found' });
    deleteProject(projectId);
    // Detach threads so the chat UI doesn't carry a dangling project id.
    clearProjectFromThreads(projectId);
    return sendJson(res, 200, { ok: true });
  });
}
