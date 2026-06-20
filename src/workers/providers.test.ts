import assert from 'node:assert/strict';
import http from 'node:http';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { LanguageModelV3, LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { generateText, jsonSchema, stepCountIs, tool } from 'ai';
import { createAnthropicProviderAdapter } from './builtin/providers-anthropic/adapter';
import {
  setAnthropicAuthMode,
  setAnthropicClaudeCliModel,
  setAnthropicClaudeCliPath,
} from './builtin/providers-anthropic/credentials';
import { anthropicProviderWorker } from './builtin/providers-anthropic/manifest';
import { createOpenAIProviderAdapter } from './builtin/providers-openai/adapter';
import {
  setOpenAIAuthMode,
  setOpenAICodexCliModel,
} from './builtin/providers-openai/credentials';
import { openaiProviderWorker } from './builtin/providers-openai/manifest';
import { openaiProviderApiRoutes } from './builtin/providers-openai/routes';
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
    const surface = openaiProviderWorker.dashboard?.settings?.find((entry) => entry.id === 'credentials');
    assert.ok(surface);
    const authMode = surface.fields?.find((field) => field.key === 'authMode');
    assert.equal(authMode?.type, 'select');
    assert.deepEqual(
      authMode?.type === 'select' ? authMode.options.map((option) => option.value) : [],
      ['api', 'subscription'],
    );
    const loginAction = surface.fields?.find((field) => field.key === 'chatgptLogin');
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

test('Anthropic provider exposes API/subscription settings and can generate through Claude CLI mode', async () => {
  const fakeClaude = await writeExecutable(
    'fake-claude',
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' }));
  process.exit(0);
}
if (args.includes('--print')) {
  let input = '';
  process.stdin.on('data', (chunk) => input += chunk);
  process.stdin.on('end', () => {
    if (!input.includes('User:')) process.exit(2);
    process.stdout.write('anthropic subscription reply');
  });
  return;
}
process.exit(1);
`,
  );

  setAnthropicAuthMode('subscription');
  setAnthropicClaudeCliPath(fakeClaude);
  setAnthropicClaudeCliModel('sonnet-test');
  try {
    const surface = anthropicProviderWorker.dashboard?.settings?.find((entry) => entry.id === 'credentials');
    assert.ok(surface);
    const authMode = surface.fields?.find((field) => field.key === 'authMode');
    assert.equal(authMode?.type, 'select');
    assert.deepEqual(
      authMode?.type === 'select' ? authMode.options.map((option) => option.value) : [],
      ['api', 'subscription'],
    );

    const adapter = createAnthropicProviderAdapter();
    assert.equal(adapter.isConfigured(), true);
    assert.deepEqual(await adapter.listAvailableModels?.(), [
      {
        id: 'sonnet-test',
        alias: 'anthropic-subscription-sonnet-test',
        label: 'Claude subscription via Claude CLI (sonnet-test)',
      },
    ]);
    const model = adapter.getChatModel('sonnet-test') as LanguageModelV3;
    const result = await model.doGenerate(callOptions('hello from bfrost'));
    assert.equal(result.content.find((part) => part.type === 'text')?.text, 'anthropic subscription reply');
  } finally {
    setAnthropicAuthMode('api');
    setAnthropicClaudeCliPath('claude');
    setAnthropicClaudeCliModel('sonnet');
  }
});

async function writeExecutable(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-provider-test-'));
  const filePath = path.join(dir, name);
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
  return filePath;
}

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
