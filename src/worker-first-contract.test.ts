import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { builtInWorkerApiRoutes } from './workers/builtin/api-routes';
import { registerCoreRoutes } from './admin-routes';
import { HttpRouter } from './http/router';

const FORBIDDEN_WORKER_TOKENS = [
  'core.news',
  'core.research',
  'core.providers',
  'core.channels',
  'tweet-post',
  'publisher-x',
  'convertprivately',
  '/api/lmstudio',
  '/api/workers/providers-openai',
  '/api/workers/providers-anthropic',
  '/api/workers/core.providers',
];

const PHASE_1_CORE_SURFACES = [
  'src/admin-server.ts',
  'src/admin-routes.ts',
  'src/http/routes/actions.ts',
  'src/http/routes/auth.ts',
  'src/http/routes/admin.ts',
  'src/http/routes/backups.ts',
  'src/http/routes/chat.ts',
  'src/http/routes/config.ts',
  'src/http/routes/dashboard.ts',
  'src/http/routes/workers.ts',
  'web/src/tabs/ActionsTab.tsx',
  'web/src/tabs/ChannelsTab.tsx',
  'web/src/tabs/ChatTab.tsx',
  'web/src/tabs/ConfigTab.tsx',
  'web/src/tabs/HealthTab.tsx',
  'web/src/tabs/JobsTab.tsx',
  'web/src/tabs/OverviewTab.tsx',
  'web/src/tabs/StoreTab.tsx',
  'web/src/tabs/SystemTab.tsx',
  'web/src/tabs/WorkersTab.tsx',
];

test('core and built-in worker API routes do not collide', () => {
  const router = new HttpRouter();
  registerCoreRoutes(router);

  for (const route of builtInWorkerApiRoutes) {
    assert.doesNotThrow(
      () => router.add(route.method, route.path, () => undefined),
      `Worker route ${route.method.toUpperCase()} ${route.path} collides with a core route.`,
    );
  }
});

test('Phase 1 core surfaces do not name specific workers', async () => {
  const hits: string[] = [];

  for (const relPath of PHASE_1_CORE_SURFACES) {
    const absPath = path.join(process.cwd(), relPath);
    const content = await readFile(absPath, 'utf8');
    const tokens = FORBIDDEN_WORKER_TOKENS.filter((token) => content.includes(token));
    if (tokens.length > 0) {
      hits.push(`${relPath}: ${tokens.join(', ')}`);
    }
  }

  assert.deepEqual(hits, []);
});

test('new core files must be added to the worker-first contract scan', async () => {
  const scanned = new Set(PHASE_1_CORE_SURFACES);
  const required = [
    'src/admin-server.ts',
    'src/admin-routes.ts',
    ...(await listFiles('src/http/routes', '.ts')),
    ...(await listFiles('web/src/tabs', '.tsx')),
  ].sort();

  const missing = required.filter((relPath) => !scanned.has(relPath));
  assert.deepEqual(missing, []);
});

async function listFiles(dir: string, suffix: string): Promise<string[]> {
  const entries = await readdir(path.join(process.cwd(), dir), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => `${dir}/${entry.name}`)
    .sort();
}
