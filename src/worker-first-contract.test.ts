import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { builtInWorkerApiRoutes } from './workers/builtin/api-routes';
import { registerCoreRoutes } from './admin-routes';
import { HttpRouter } from './http/router';

const FORBIDDEN_WORKER_TOKENS = [
  'news',
  'research',
  'telegram',
  'openai',
  'anthropic',
  'lmstudio',
  'core.news',
  'core.research',
  'core.providers',
  'core.channels',
  'tweet-post',
  'publisher-x',
  'convertprivately',
  '/api/lmstudio',
  '/api/dashboard/lmstudio-models',
  '/api/workers/providers-openai',
  '/api/workers/providers-anthropic',
  '/api/workers/core.providers',
];

const CONTRACT_CORE_ROOTS = ['src', 'web/src'];
const CONTRACT_FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.css']);

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

test('production core files do not name specific workers', async () => {
  const hits: string[] = [];

  for (const relPath of await listContractCoreFiles()) {
    const absPath = path.join(process.cwd(), relPath);
    const content = await readFile(absPath, 'utf8');
    const lower = content.toLowerCase();
    const tokens = FORBIDDEN_WORKER_TOKENS.filter((token) => lower.includes(token.toLowerCase()));
    if (tokens.length > 0) {
      hits.push(`${relPath}: ${tokens.join(', ')}`);
    }
  }

  assert.deepEqual(hits, []);
});

async function listContractCoreFiles(): Promise<string[]> {
  const results: string[] = [];
  for (const root of CONTRACT_CORE_ROOTS) {
    await walk(root, results);
  }
  return results.sort();
}

async function walk(relDir: string, results: string[]): Promise<void> {
  if (relDir === 'src/workers' || relDir.startsWith('src/workers/')) return;
  if (relDir === 'web/src/workers' || relDir.startsWith('web/src/workers/')) return;

  const entries = await readdir(path.join(process.cwd(), relDir), { withFileTypes: true });
  for (const entry of entries) {
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await walk(relPath, results);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name);
    if (!CONTRACT_FILE_EXTENSIONS.has(ext)) continue;
    if (path.basename(entry.name, ext).includes('.test')) continue;
    results.push(relPath);
  }
}
