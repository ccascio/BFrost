import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { generateText, jsonSchema, stepCountIs, tool } from 'ai';
import { createAnthropicProviderAdapter } from './builtin/providers-anthropic/adapter';
import {
  setAnthropicAuthMode,
  setAnthropicClaudeCliModel,
  setAnthropicOAuthCredentials,
} from './builtin/providers-anthropic/credentials';
import { anthropicProviderWorker } from './builtin/providers-anthropic/manifest';
import { anthropicProviderApiRoutes } from './builtin/providers-anthropic/routes';
import { ANTHROPIC_OAUTH_BETA_HEADER } from './builtin/providers-anthropic/subscription-model';
import { createOpenAIProviderAdapter } from './builtin/providers-openai/adapter';
import {
  setOpenAIAuthMode,
  setOpenAICodexCliModel,
} from './builtin/providers-openai/credentials';
import { openaiProviderWorker } from './builtin/providers-openai/manifest';
import { openaiProviderApiRoutes } from './builtin/providers-openai/routes';
import { createPiCompatibleProviderAdapter } from './builtin/providers-pi-compatible/adapter';
import {
  PI_COMPATIBLE_PROVIDERS,
  PI_COMPATIBLE_WORKER_ID,
  getPiCompatibleProviderDefinition,
} from './builtin/providers-pi-compatible/catalog';
import {
  setCloudflareAccountId,
  setPiProviderApiKey,
} from './builtin/providers-pi-compatible/credentials';
import { piCompatibleProviderWorker } from './builtin/providers-pi-compatible/manifest';
import {
  getActiveLocalProvider,
  getProviderAdapter,
  getRegisteredProvider,
  listRegisteredProviders,
} from './registry';

test('built-in provider registry exposes the LM Studio adapter', () => {
  const providers = listRegisteredProviders();
  const lmstudio = providers.find((entry) => entry.manifest.id === 'lmstudio');

  assert.ok(lmstudio, 'lmstudio provider should be registered');
  assert.equal(lmstudio!.worker.id, 'core.providers.lmstudio');
  assert.equal(lmstudio!.manifest.capabilities.chat, true);
  assert.equal(lmstudio!.manifest.capabilities.localRuntime, true);
});

test('getProviderAdapter caches a single instance per provider id', () => {
  const first = getProviderAdapter('lmstudio');
  const second = getProviderAdapter('lmstudio');
  assert.ok(first, 'lmstudio adapter should resolve');
  assert.equal(first, second, 'adapter instances should be cached');
  assert.equal(first!.providerId, 'lmstudio');
  assert.equal(typeof first!.getChatModel, 'function');
  assert.equal(typeof first!.startRuntime, 'function');
  assert.equal(typeof first!.stopRuntime, 'function');
  assert.equal(typeof first!.listLoadedModels, 'function');
});

test('getActiveLocalProvider resolves the LM Studio adapter when configured', () => {
  const registered = getRegisteredProvider('lmstudio');
  assert.ok(registered);
  // Active resolution depends on isConfigured() — at minimum it should not throw,
  // and if configured it must be the local-runtime adapter we registered.
  const active = getActiveLocalProvider();
  if (active) {
    assert.equal(active.providerId, 'lmstudio');
  }
});

test('getRegisteredProvider returns undefined for unknown providers', () => {
  assert.equal(getRegisteredProvider('definitely-missing'), undefined);
  assert.equal(getProviderAdapter('definitely-missing'), undefined);
});

test('Pi-compatible provider worker registers the additional provider catalog in settings only', () => {
  const providers = listRegisteredProviders();
  const registeredIds = new Set(providers.map((entry) => entry.manifest.id));

  assert.equal(piCompatibleProviderWorker.id, PI_COMPATIBLE_WORKER_ID);
  assert.equal(piCompatibleProviderWorker.displayName, 'LLM Providers');
  assert.equal(piCompatibleProviderWorker.settingsOnly, true);
  assert.equal(PI_COMPATIBLE_PROVIDERS.length, 14);
  assert.equal(registeredIds.has('openai'), true, 'OpenAI remains owned by the existing worker');
  for (const provider of PI_COMPATIBLE_PROVIDERS) {
    assert.equal(registeredIds.has(provider.id), true, `${provider.id} should be registered`);
    const registered = getRegisteredProvider(provider.id);
    assert.equal(registered?.worker.id, PI_COMPATIBLE_WORKER_ID);
    assert.equal(registered?.manifest.defaultModels?.length, provider.defaultModels.length);
  }

  const fields = piCompatibleProviderWorker.dashboard?.settings?.find((entry) => entry.id === 'credentials')?.fields ?? [];
  assert.equal(fields.find((entry) => entry.key === 'openaiAuthMode')?.type, 'select');
  assert.equal(fields.find((entry) => entry.key === 'openaiAuthMode')?.group, 'openai');
  assert.equal(fields.find((entry) => entry.key === 'openaiSubscriptionLogin')?.type, 'action');
  assert.equal(fields.find((entry) => entry.key === 'anthropicAuthMode')?.type, 'select');
  assert.equal(fields.find((entry) => entry.key === 'anthropicAuthMode')?.group, 'anthropic');
  assert.equal(fields.find((entry) => entry.key === 'anthropicSubscriptionLogin')?.type, 'action');
  const groups = piCompatibleProviderWorker.dashboard?.settings?.find((entry) => entry.id === 'credentials')?.fieldGroups ?? [];
  assert.equal(groups.find((entry) => entry.id === 'openai')?.label, 'OpenAI');
  assert.equal(groups.find((entry) => entry.id === 'anthropic')?.label, 'Anthropic');
  for (const provider of PI_COMPATIBLE_PROVIDERS) {
    const field = fields.find((entry) => entry.key === provider.apiKeySettingKey);
    assert.equal(field?.type, 'secret-reference');
    assert.equal(field?.group, provider.id);
    assert.equal(groups.find((entry) => entry.id === provider.id)?.label, provider.label);
    const action = fields.find((entry) => entry.key === `${provider.apiKeySettingKey}SubscriptionLogin`);
    assert.equal(action?.type, 'action');
    assert.equal(action?.type === 'action' ? action.disabled : false, true);
  }
  assert.equal(fields.find((entry) => entry.key === 'cloudflareAccountId')?.type, 'text');
});

test('Pi-compatible provider adapter gates credentials and returns declared models', async () => {
  const provider = getPiCompatibleProviderDefinition('deepseek');
  assert.ok(provider);

  setPiProviderApiKey(provider.id, '');
  const unconfigured = createPiCompatibleProviderAdapter(provider);
  assert.equal(unconfigured.isConfigured(), false);
  assert.throws(() => unconfigured.getChatModel(provider.defaultModels[0]!.id), /DEEPSEEK_API_KEY/);

  setPiProviderApiKey(provider.id, 'fake-deepseek-key');
  try {
    const configured = createPiCompatibleProviderAdapter(provider);
    assert.equal(configured.isConfigured(), true);
    assert.deepEqual(await configured.listAvailableModels?.(), provider.defaultModels);
    assert.ok(configured.getChatModel(provider.defaultModels[0]!.id));
  } finally {
    setPiProviderApiKey(provider.id, '');
  }
});

test('Cloudflare Pi-compatible adapter requires both account id and API key', () => {
  const provider = getPiCompatibleProviderDefinition('cloudflare-workers-ai');
  assert.ok(provider);

  setPiProviderApiKey(provider.id, 'fake-cloudflare-key');
  setCloudflareAccountId('');
  try {
    const missingAccount = createPiCompatibleProviderAdapter(provider);
    assert.equal(missingAccount.isConfigured(), false);
    assert.throws(() => missingAccount.getChatModel(provider.defaultModels[0]!.id), /CLOUDFLARE_ACCOUNT_ID/);

    setCloudflareAccountId('account-123');
    const configured = createPiCompatibleProviderAdapter(provider);
    assert.equal(configured.isConfigured(), true);
    assert.ok(configured.getChatModel(provider.defaultModels[0]!.id));
  } finally {
    setPiProviderApiKey(provider.id, '');
    setCloudflareAccountId('');
  }
});

test('OpenAI provider exposes API/subscription settings and can generate through Codex OAuth mode', async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'bfrost-codex-home-'));
  await writeFile(
    path.join(codexHome, 'auth.json'),
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'fake-access-token',
        refresh_token: 'fake-refresh-token',
        account_id: 'fake-account-id',
      },
    }),
  );
  const previousCodexHome = process.env.CODEX_HOME;
  const previousFetch = globalThis.fetch;
  process.env.CODEX_HOME = codexHome;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    assert.equal(url, 'https://chatgpt.com/backend-api/codex/responses');
    assert.equal((init?.headers as Record<string, string>)['chatgpt-account-id'], 'fake-account-id');
    return new Response(
      [
        'data: {"type":"response.output_text.delta","delta":"openai "}',
        '',
        'data: {"type":"response.output_text.delta","delta":"subscription reply"}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  }) as typeof fetch;

  setOpenAIAuthMode('subscription');
  setOpenAICodexCliModel('gpt-subscription-test');
  try {
    assert.equal(openaiProviderWorker.dashboard?.settings?.length, 0);
    const surface = piCompatibleProviderWorker.dashboard?.settings?.find((entry) => entry.id === 'credentials');
    assert.ok(surface);
    const authMode = surface.fields?.find((field) => field.key === 'openaiAuthMode');
    assert.equal(authMode?.type, 'select');
    assert.deepEqual(
      authMode?.type === 'select' ? authMode.options.map((option) => option.value) : [],
      ['api', 'subscription'],
    );
    const loginAction = surface.fields?.find((field) => field.key === 'openaiSubscriptionLogin');
    assert.equal(loginAction?.type, 'action');
    assert.equal(loginAction?.type === 'action' ? loginAction.actionPath : '', '/api/workers/providers-openai/oauth/start');

    const adapter = createOpenAIProviderAdapter();
    assert.equal(adapter.isConfigured(), true);
    assert.deepEqual(await adapter.listAvailableModels?.(), [
      {
        id: 'gpt-subscription-test',
        alias: 'openai-subscription-gpt-subscription-test',
        label: 'ChatGPT subscription (gpt-subscription-test)',
      },
    ]);
    const model = adapter.getChatModel('gpt-subscription-test') as LanguageModelV3;
    const result = await model.doGenerate(callOptions('hello from bfrost'));
    assert.equal(result.content.find((part) => part.type === 'text')?.text, 'openai subscription reply');
  } finally {
    setOpenAIAuthMode('api');
    setOpenAICodexCliModel('gpt-5.4-mini');
    globalThis.fetch = previousFetch;
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test('OpenAI OAuth login route exchanges callback code and saves Codex credentials', async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'bfrost-oauth-codex-home-'));
  const routeCwd = await mkdtemp(path.join(os.tmpdir(), 'bfrost-oauth-route-'));
  const previousCwd = process.cwd();
  const previousCodexHome = process.env.CODEX_HOME;
  const previousFetch = globalThis.fetch;
  process.env.CODEX_HOME = codexHome;
  process.chdir(routeCwd);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://auth.openai.com/oauth/token');
    const body = init?.body as URLSearchParams;
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code'), 'fake-code');
    return Response.json({
      access_token: 'saved-access-token',
      refresh_token: 'saved-refresh-token',
      expires_in: 3600,
    });
  }) as typeof fetch;

  setOpenAIAuthMode('api');
  try {
    const route = openaiProviderApiRoutes.find((entry) => entry.path === '/api/workers/providers-openai/oauth/start');
    assert.ok(route);
    const result = await route.handle({
      req: {} as never,
      url: new URL('http://localhost/api/workers/providers-openai/oauth/start'),
      readJsonBody: async () => ({}),
      getDashboardState: async () => ({} as never),
    });
    assert.equal(result.status, 200);
    const body = result.body as { openUrl?: string };
    assert.ok(body.openUrl);
    const state = new URL(body.openUrl).searchParams.get('state');
    assert.ok(state);

    const callback = await httpGet(`http://localhost:1455/auth/callback?code=fake-code&state=${state}`);
    assert.equal(callback.status, 200);
    assert.match(callback.body, /OpenAI login complete/);
    const saved = JSON.parse(await readFile(path.join(codexHome, 'auth.json'), 'utf8')) as {
      tokens?: { access_token?: string; refresh_token?: string };
    };
    assert.equal(saved.tokens?.access_token, 'saved-access-token');
    assert.equal(saved.tokens?.refresh_token, 'saved-refresh-token');
  } finally {
    process.chdir(previousCwd);
    setOpenAIAuthMode('api');
    globalThis.fetch = previousFetch;
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test('OpenAI Codex OAuth mode exposes AI SDK tools to ChatGPT Responses', async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'bfrost-codex-tools-home-'));
  await writeFile(
    path.join(codexHome, 'auth.json'),
    JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: 'fake-access-token',
        refresh_token: 'fake-refresh-token',
        account_id: 'fake-account-id',
      },
    }),
  );
  const previousCodexHome = process.env.CODEX_HOME;
  const previousFetch = globalThis.fetch;
  let requestCount = 0;
  let toolExecuted = false;
  process.env.CODEX_HOME = codexHome;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://chatgpt.com/backend-api/codex/responses');
    requestCount += 1;
    const request = JSON.parse(String(init?.body ?? '{}')) as {
      tools?: Array<{ name?: string }>;
      input?: unknown;
    };
    if (requestCount === 1) {
      assert.deepEqual(request.tools?.map((entry) => entry.name), ['queryItems']);
      return new Response(
        [
          'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"queryItems","arguments":""}}',
          '',
          'data: {"type":"response.function_call_arguments.delta","delta":"{\\"limit\\":"}',
          '',
          'data: {"type":"response.function_call_arguments.done","arguments":"{\\"limit\\":1}"}',
          '',
          'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"queryItems","arguments":"{\\"limit\\":1}"}}',
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }
    assert.ok(JSON.stringify(request.input).includes('tool result'));
    return new Response(
      [
        'data: {"type":"response.output_text.delta","delta":"tool answer"}',
        '',
        'data: [DONE]',
        '',
      ].join('\n'),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
  }) as typeof fetch;

  setOpenAIAuthMode('subscription');
  setOpenAICodexCliModel('gpt-subscription-test');
  try {
    const adapter = createOpenAIProviderAdapter();
    const result = await generateText({
      model: adapter.getChatModel('gpt-subscription-test') as Parameters<typeof generateText>[0]['model'],
      prompt: 'Use the queue tool.',
      tools: {
        queryItems: tool({
          description: 'Read queue items.',
          inputSchema: jsonSchema<{ limit: number }>({
            type: 'object',
            properties: { limit: { type: 'number' } },
            required: ['limit'],
          }),
          execute: async (input) => {
            toolExecuted = true;
            assert.equal(input.limit, 1);
            return 'queue has one item';
          },
        }),
      },
      stopWhen: stepCountIs(2),
    });
    assert.equal(toolExecuted, true);
    assert.equal(requestCount, 2);
    assert.equal(result.text, 'tool answer');
  } finally {
    setOpenAIAuthMode('api');
    setOpenAICodexCliModel('gpt-5.4-mini');
    globalThis.fetch = previousFetch;
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test('Anthropic provider exposes OAuth subscription settings and can generate with a Claude login token', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.anthropic.com/v1/messages');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer fake-anthropic-access');
    assert.equal(headers.get('anthropic-beta'), ANTHROPIC_OAUTH_BETA_HEADER);
    return Response.json({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-test',
      content: [{ type: 'text', text: 'anthropic oauth reply' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 2 },
    });
  }) as typeof fetch;

  setAnthropicAuthMode('subscription');
  setAnthropicClaudeCliModel('claude-sonnet-test');
  setAnthropicOAuthCredentials({
    access: 'fake-anthropic-access',
    refresh: 'fake-anthropic-refresh',
    expires: Date.now() + 60 * 60_000,
  });
  try {
    assert.equal(anthropicProviderWorker.dashboard?.settings?.length, 0);
    const surface = piCompatibleProviderWorker.dashboard?.settings?.find((entry) => entry.id === 'credentials');
    assert.ok(surface);
    const authMode = surface.fields?.find((field) => field.key === 'anthropicAuthMode');
    assert.equal(authMode?.type, 'select');
    assert.deepEqual(
      authMode?.type === 'select' ? authMode.options.map((option) => option.value) : [],
      ['api', 'subscription'],
    );
    const loginAction = surface.fields?.find((field) => field.key === 'anthropicSubscriptionLogin');
    assert.equal(loginAction?.type, 'action');
    assert.equal(
      loginAction?.type === 'action' ? loginAction.actionPath : '',
      '/api/workers/providers-anthropic/oauth/start',
    );

    const adapter = createAnthropicProviderAdapter();
    assert.equal(adapter.isConfigured(), true);
    assert.deepEqual(await adapter.listAvailableModels?.(), [
      {
        id: 'claude-sonnet-test',
        alias: 'anthropic-subscription-claude-sonnet-test',
        label: 'Claude subscription (claude-sonnet-test)',
      },
    ]);
    const model = adapter.getChatModel('claude-sonnet-test') as LanguageModelV3;
    const result = await model.doGenerate(callOptions('hello from bfrost'));
    assert.equal(result.content.find((part) => part.type === 'text')?.text, 'anthropic oauth reply');
  } finally {
    setAnthropicAuthMode('api');
    setAnthropicClaudeCliModel('claude-sonnet-4-6');
    setAnthropicOAuthCredentials({ access: '', refresh: '', expires: 0 });
    globalThis.fetch = previousFetch;
  }
});

test('Anthropic OAuth login route exchanges callback code and saves Claude credentials', async () => {
  const routeCwd = await mkdtemp(path.join(os.tmpdir(), 'bfrost-anthropic-oauth-route-'));
  const previousCwd = process.cwd();
  const previousFetch = globalThis.fetch;
  process.chdir(routeCwd);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/models')) {
      return Response.json({ data: [] });
    }
    assert.equal(String(input), 'https://platform.claude.com/v1/oauth/token');
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      grant_type?: string;
      code?: string;
      state?: string;
      code_verifier?: string;
      redirect_uri?: string;
    };
    assert.equal(body.grant_type, 'authorization_code');
    assert.equal(body.code, 'fake-code');
    assert.equal(body.state, body.code_verifier);
    assert.equal(body.redirect_uri, 'http://localhost:53692/callback');
    return Response.json({
      access_token: 'saved-anthropic-access',
      refresh_token: 'saved-anthropic-refresh',
      expires_in: 3600,
    });
  }) as typeof fetch;

  setAnthropicAuthMode('api');
  setAnthropicOAuthCredentials({ access: '', refresh: '', expires: 0 });
  try {
    const route = anthropicProviderApiRoutes.find((entry) => entry.path === '/api/workers/providers-anthropic/oauth/start');
    assert.ok(route);
    const result = await route.handle({
      req: {} as never,
      url: new URL('http://localhost/api/workers/providers-anthropic/oauth/start'),
      readJsonBody: async () => ({}),
      getDashboardState: async () => ({} as never),
    });
    assert.equal(result.status, 200);
    const body = result.body as { openUrl?: string };
    assert.ok(body.openUrl);
    const state = new URL(body.openUrl).searchParams.get('state');
    assert.ok(state);

    const callback = await httpGet(`http://localhost:53692/callback?code=fake-code&state=${state}`);
    assert.equal(callback.status, 200);
    assert.match(callback.body, /Anthropic login complete/);
    const envFile = await readFile(path.join(routeCwd, '.env'), 'utf8');
    assert.match(envFile, /ANTHROPIC_OAUTH_TOKEN=saved-anthropic-access/);
    assert.match(envFile, /BFROST_ANTHROPIC_OAUTH_REFRESH_TOKEN=saved-anthropic-refresh/);
    assert.match(envFile, /BFROST_ANTHROPIC_AUTH_MODE=subscription/);
  } finally {
    process.chdir(previousCwd);
    setAnthropicAuthMode('api');
    setAnthropicOAuthCredentials({ access: '', refresh: '', expires: 0 });
    globalThis.fetch = previousFetch;
  }
});

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    }).on('error', reject);
  });
}

function callOptions(text: string): LanguageModelV3CallOptions {
  return {
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    ],
  };
}
