import path from 'path';
import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { upsertEnvValue } from '../../../env-file';
import { refreshCloudProviderModels } from '../../../model-discovery';
import { recordEventSafe } from '../../../event-log';
import {
  setAnthropicApiKey,
  setAnthropicAuthMode,
  setAnthropicClaudeCliModel,
  setAnthropicClaudeCliPath,
} from './credentials';

const WORKER_ID = 'core.providers.anthropic';

const AnthropicCredentialsBodySchema = z.object({
  authMode: z.enum(['api', 'subscription']).optional(),
  apiKey: z.string().optional(),
  claudeCliPath: z.string().optional(),
  claudeCliModel: z.string().optional(),
}).strict();

export const anthropicProviderApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/workers/providers-anthropic/credentials',
    workerIds: [WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, AnthropicCredentialsBodySchema);
      const mode = body.authMode ?? 'api';
      const key = body.apiKey?.trim() ?? '';
      if (mode === 'api' && !key && body.apiKey !== undefined) {
        throw new BadRequestError('apiKey must not be empty when provided.');
      }

      await upsertEnvValue(path.join(process.cwd(), '.env'), 'BFROST_ANTHROPIC_AUTH_MODE', mode);
      setAnthropicAuthMode(mode);
      if (body.claudeCliPath !== undefined) {
        const cliPath = body.claudeCliPath.trim() || 'claude';
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'BFROST_ANTHROPIC_CLAUDE_CLI', cliPath);
        setAnthropicClaudeCliPath(cliPath);
      }
      if (body.claudeCliModel !== undefined) {
        const cliModel = body.claudeCliModel.trim() || 'sonnet';
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'BFROST_ANTHROPIC_CLAUDE_MODEL', cliModel);
        setAnthropicClaudeCliModel(cliModel);
      }
      if (key) {
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'ANTHROPIC_API_KEY', key);
        setAnthropicApiKey(key);
      }
      await refreshCloudProviderModels();

      await recordEventSafe({
        category: 'admin',
        action: 'cloud_api_keys_updated',
        summary: mode === 'subscription' ? 'Anthropic provider set to subscription CLI mode.' : 'Anthropic provider settings updated.',
        metadata: { workerId: WORKER_ID, openaiUpdated: false, anthropicUpdated: Boolean(key), authMode: mode },
      });

      return { status: 200, body: { ok: true } };
    },
  },
];
