import path from 'path';
import { createHash, randomBytes } from 'crypto';
import http from 'http';
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
  setAnthropicOAuthCredentials,
} from './credentials';
import { persistAnthropicOAuthCredentials } from './subscription-model';

const WORKER_ID = 'core.providers.anthropic';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_CALLBACK_PORT = 53692;
const OAUTH_CALLBACK_PATH = '/callback';
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
const OAUTH_SCOPE =
  'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';

const AnthropicCredentialsBodySchema = z.object({
  authMode: z.enum(['api', 'subscription']).optional(),
  apiKey: z.string().optional(),
  subscriptionModel: z.string().optional(),
  claudeCliPath: z.string().optional(),
  claudeCliModel: z.string().optional(),
}).strict();

type PendingOAuthFlow = {
  verifier: string;
  authUrl: string;
  server: http.Server;
  expiresAt: number;
};

let pendingOAuthFlow: PendingOAuthFlow | null = null;

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function oauthCallbackHtml(status: 'success' | 'error', message: string): string {
  const safeMessage = JSON.stringify(message);
  const safeStatus = JSON.stringify(status);
  const htmlMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>BFrost Anthropic login</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; display: grid; min-height: 100vh; place-items: center; background: #f7f9fb; color: #17202a; }
      main { width: min(420px, calc(100vw - 32px)); border: 1px solid #d9e1ea; border-radius: 8px; background: white; padding: 24px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.14); }
      h1 { font-size: 20px; margin: 0 0 8px; }
      p { color: #52606d; line-height: 1.5; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>${status === 'success' ? 'Anthropic login complete' : 'Anthropic login failed'}</h1>
      <p>${htmlMessage}</p>
    </main>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'bfrost:oauth-complete', provider: 'anthropic', status: ${safeStatus}, message: ${safeMessage} }, '*');
      }
      ${status === 'success' ? 'setTimeout(() => window.close(), 1200);' : ''}
    </script>
  </body>
</html>`;
}

function closePendingOAuthFlow(): void {
  if (!pendingOAuthFlow) return;
  pendingOAuthFlow.server.close();
  pendingOAuthFlow = null;
}

async function exchangeOAuthCode(code: string, state: string, verifier: string): Promise<{
  access: string;
  refresh: string;
  expires: number;
}> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: OAUTH_CLIENT_ID,
      code,
      state,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic OAuth token exchange failed (${response.status}): ${text || response.statusText}`);
  }
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('Anthropic OAuth token response was missing access_token, refresh_token, or expires_in.');
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000 - 5 * 60_000,
  };
}

function createOAuthAuthorizationUrl(verifier: string, challenge: string): string {
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', OAUTH_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', OAUTH_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', verifier);
  return url.toString();
}

async function startAnthropicOAuthFlow(): Promise<string> {
  const now = Date.now();
  if (pendingOAuthFlow && pendingOAuthFlow.expiresAt > now) return pendingOAuthFlow.authUrl;
  closePendingOAuthFlow();

  const { verifier, challenge } = createPkcePair();
  const authUrl = createOAuthAuthorizationUrl(verifier, challenge);
  const expiresAt = now + 15 * 60_000;

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', OAUTH_REDIRECT_URI);
        if (url.pathname !== OAUTH_CALLBACK_PATH) {
          res.writeHead(404).end('Not found');
          return;
        }
        const flow = pendingOAuthFlow;
        if (!flow) {
          throw new Error('No active BFrost Anthropic login request.');
        }
        const error = url.searchParams.get('error');
        if (error) {
          throw new Error(url.searchParams.get('error_description') || error);
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state) {
          throw new Error('OAuth callback did not include both authorization code and state.');
        }
        if (state !== flow.verifier) {
          throw new Error('OAuth state did not match the active BFrost login request.');
        }
        const credentials = await exchangeOAuthCode(code, state, flow.verifier);
        await persistAnthropicOAuthCredentials(credentials);
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'BFROST_ANTHROPIC_AUTH_MODE', 'subscription');
        setAnthropicAuthMode('subscription');
        setAnthropicOAuthCredentials(credentials);
        await refreshCloudProviderModels();
        await recordEventSafe({
          category: 'admin',
          action: 'cloud_api_keys_updated',
          summary: 'Anthropic Claude subscription login completed.',
          metadata: { workerId: WORKER_ID, openaiUpdated: false, anthropicUpdated: true, authMode: 'subscription' },
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          oauthCallbackHtml('success', 'BFrost saved your Claude subscription login. You can close this window.'),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          oauthCallbackHtml('error', message),
        );
      } finally {
        setTimeout(closePendingOAuthFlow, 250);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(OAUTH_CALLBACK_PORT, 'localhost', () => {
      server.off('error', reject);
      resolve();
    });
  });
  pendingOAuthFlow = { verifier, authUrl, server, expiresAt };
  server.unref?.();
  return authUrl;
}

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
      const subscriptionModel = body.subscriptionModel ?? body.claudeCliModel;
      if (subscriptionModel !== undefined) {
        const cliModel = subscriptionModel.trim() || 'claude-sonnet-4-6';
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'BFROST_ANTHROPIC_SUBSCRIPTION_MODEL', cliModel);
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
  {
    method: 'POST',
    path: '/api/workers/providers-anthropic/oauth/start',
    workerIds: [WORKER_ID],
    async handle() {
      const openUrl = await startAnthropicOAuthFlow();
      return {
        status: 200,
        body: {
          ok: true,
          openUrl,
          message: 'Anthropic login opened in a browser window.',
        },
      };
    },
  },
];
