import path from 'path';
import { createHash, randomBytes } from 'crypto';
import http from 'http';
import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { upsertEnvValue } from '../../../env-file';
import { refreshCloudProviderModels } from '../../../model-discovery';
import { recordEventSafe } from '../../../event-log';
import {
  setOpenAIApiKey,
  setOpenAIAuthMode,
  setOpenAICodexCliModel,
} from './credentials';
import { persistOpenAICodexSubscriptionCredentials } from './subscription-model';

const WORKER_ID = 'core.providers.openai';
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_CALLBACK_PORT = 1455;
const OAUTH_CALLBACK_PATH = '/auth/callback';
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`;
const OAUTH_SCOPE = 'openid profile email offline_access';

const OpenAICredentialsBodySchema = z.object({
  authMode: z.enum(['api', 'subscription']).optional(),
  apiKey: z.string().optional(),
  codexCliModel: z.string().optional(),
}).strict();

type PendingOAuthFlow = {
  state: string;
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

function oauthCallbackHtml(status: 'success' | 'error', message: string): string {
  const safeMessage = JSON.stringify(message);
  const safeStatus = JSON.stringify(status);
  const htmlMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>BFrost OpenAI login</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; display: grid; min-height: 100vh; place-items: center; background: #f7f9fb; color: #17202a; }
      main { width: min(420px, calc(100vw - 32px)); border: 1px solid #d9e1ea; border-radius: 8px; background: white; padding: 24px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.14); }
      h1 { font-size: 20px; margin: 0 0 8px; }
      p { color: #52606d; line-height: 1.5; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>${status === 'success' ? 'OpenAI login complete' : 'OpenAI login failed'}</h1>
      <p>${htmlMessage}</p>
    </main>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'bfrost:oauth-complete', provider: 'openai', status: ${safeStatus}, message: ${safeMessage} }, '*');
      }
      ${status === 'success' ? 'setTimeout(() => window.close(), 1200);' : ''}
    </script>
  </body>
</html>`;
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

function closePendingOAuthFlow(): void {
  if (!pendingOAuthFlow) return;
  pendingOAuthFlow.server.close();
  pendingOAuthFlow = null;
}

async function exchangeOAuthCode(code: string, verifier: string): Promise<{
  access: string;
  refresh: string;
  expires: number;
  idToken?: string;
}> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      code,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI OAuth token exchange failed (${response.status}): ${text || response.statusText}`);
  }
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('OpenAI OAuth token response was missing access_token, refresh_token, or expires_in.');
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    idToken: json.id_token,
    expires: Date.now() + json.expires_in * 1000,
  };
}

function createOAuthAuthorizationUrl(state: string, challenge: string): string {
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI);
  url.searchParams.set('scope', OAUTH_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('originator', 'bfrost');
  return url.toString();
}

async function startOpenAIOAuthFlow(): Promise<string> {
  const now = Date.now();
  if (pendingOAuthFlow && pendingOAuthFlow.expiresAt > now) return pendingOAuthFlow.authUrl;
  closePendingOAuthFlow();

  const { verifier, challenge } = createPkcePair();
  const state = randomBytes(16).toString('hex');
  const authUrl = createOAuthAuthorizationUrl(state, challenge);
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
        if (!flow || url.searchParams.get('state') !== flow.state) {
          throw new Error('OAuth state did not match the active BFrost login request.');
        }
        const error = url.searchParams.get('error');
        if (error) {
          throw new Error(url.searchParams.get('error_description') || error);
        }
        const code = url.searchParams.get('code');
        if (!code) {
          throw new Error('OAuth callback did not include an authorization code.');
        }
        const credentials = await exchangeOAuthCode(code, flow.verifier);
        await persistOpenAICodexSubscriptionCredentials(credentials);
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'BFROST_OPENAI_AUTH_MODE', 'subscription');
        setOpenAIAuthMode('subscription');
        await refreshCloudProviderModels();
        await recordEventSafe({
          category: 'admin',
          action: 'cloud_api_keys_updated',
          summary: 'OpenAI ChatGPT subscription login completed.',
          metadata: { workerId: WORKER_ID, openaiUpdated: true, anthropicUpdated: false, authMode: 'subscription' },
        });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          oauthCallbackHtml('success', 'BFrost saved your ChatGPT subscription login. You can close this window.'),
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
  pendingOAuthFlow = { state, verifier, authUrl, server, expiresAt };
  server.unref?.();
  return authUrl;
}

export const openaiProviderApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/workers/providers-openai/credentials',
    workerIds: [WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, OpenAICredentialsBodySchema);
      const mode = body.authMode ?? 'api';
      const key = body.apiKey?.trim() ?? '';

      if (mode === 'api' && !key && body.apiKey !== undefined) {
        throw new BadRequestError('apiKey must not be empty when provided.');
      }

      await upsertEnvValue(path.join(process.cwd(), '.env'), 'BFROST_OPENAI_AUTH_MODE', mode);
      setOpenAIAuthMode(mode);
      if (body.codexCliModel !== undefined) {
        const cliModel = body.codexCliModel.trim() || 'gpt-5.4-mini';
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'BFROST_OPENAI_CODEX_MODEL', cliModel);
        setOpenAICodexCliModel(cliModel);
      }
      if (key) {
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'OPENAI_API_KEY', key);
        setOpenAIApiKey(key);
      }
      await refreshCloudProviderModels();

      await recordEventSafe({
        category: 'admin',
        action: 'cloud_api_keys_updated',
        summary: mode === 'subscription' ? 'OpenAI provider set to subscription CLI mode.' : 'OpenAI provider settings updated.',
        metadata: { workerId: WORKER_ID, openaiUpdated: Boolean(key), anthropicUpdated: false, authMode: mode },
      });

      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/providers-openai/oauth/start',
    workerIds: [WORKER_ID],
    async handle() {
      const openUrl = await startOpenAIOAuthFlow();
      return {
        status: 200,
        body: {
          ok: true,
          openUrl,
          message: 'OpenAI login opened in a browser window.',
        },
      };
    },
  },
];
