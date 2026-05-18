import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileLocalWorker } from './build';
import { loadLocalWorkerModule } from './loader';
import {
  getRegisteredTool,
  registerLoadedLocalModule,
  unregisterLocalWorkerModule,
} from './registry';
import type { DiscoveredLocalWorker } from './local';

const WORKER_TS_SOURCE = `
const manifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'local.test-worker',
  name: 'Test Worker',
  version: '0.1.0',
  description: 'A local worker generated for the loader e2e test.',
  builtIn: false,
  jobs: [],
  tools: [
    {
      id: 'echo-tool',
      workerId: 'local.test-worker',
      name: 'echoTool',
      description: 'Echoes input back.',
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message'],
      },
      async execute({ message }: { message: string }) {
        return 'echo: ' + message;
      },
    },
  ],
};

export default { manifest };
`;

async function withTempWorker<T>(fn: (worker: DiscoveredLocalWorker, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-loader-'));
  try {
    const srcDir = path.join(dir, 'src');
    await writeFile(path.join(dir, 'worker.json'), JSON.stringify({
      manifestVersion: 1,
      bfrostApiVersion: '0.1',
      id: 'local.test-worker',
      name: 'Test Worker',
      version: '0.1.0',
      description: 'A local worker generated for the loader e2e test.',
      language: 'typescript',
      backendSource: 'src/index.ts',
      backendEntrypoint: 'dist/index.js',
    }), 'utf8');
    await writeFile(path.join(dir, 'src.placeholder'), '', 'utf8');
    await rm(path.join(dir, 'src.placeholder'));
    await writeFile(path.join(srcDir, 'index.ts').replace(/\/src\//, '/src/'), WORKER_TS_SOURCE, 'utf8').catch(async () => {
      // ensure src dir exists, then retry
      const { mkdir } = await import('node:fs/promises');
      await mkdir(srcDir, { recursive: true });
      await writeFile(path.join(srcDir, 'index.ts'), WORKER_TS_SOURCE, 'utf8');
    });

    const worker: DiscoveredLocalWorker = {
      sourcePath: path.join(dir, 'worker.json'),
      language: 'typescript',
      backendSource: 'src/index.ts',
      backendEntrypoint: 'dist/index.js',
      manifest: {
        manifestVersion: 1,
        bfrostApiVersion: '0.1',
        id: 'local.test-worker',
        name: 'Test Worker',
        version: '0.1.0',
        description: 'A local worker generated for the loader e2e test.',
        builtIn: false,
        jobs: [],
      },
    };

    return await fn(worker, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('compileLocalWorker bundles a TS worker into a runnable JS file', async () => {
  await withTempWorker(async (_worker, dir) => {
    const result = await compileLocalWorker({
      workerDir: dir,
      source: 'src/index.ts',
      output: 'dist/index.js',
    });
    assert.equal(result.compiled, true);
    assert.equal(result.reason, 'compiled');

    // Second call should hit the cache.
    const cached = await compileLocalWorker({
      workerDir: dir,
      source: 'src/index.ts',
      output: 'dist/index.js',
    });
    assert.equal(cached.compiled, false);
    assert.equal(cached.reason, 'cached');
  });
});

test('loadLocalWorkerModule compiles, requires, and exposes the worker tool', async () => {
  await withTempWorker(async (worker) => {
    const loaded = await loadLocalWorkerModule(worker);
    assert.equal(loaded.module.manifest.id, 'local.test-worker');
    assert.equal(loaded.module.manifest.tools?.length, 1);

    registerLoadedLocalModule(loaded.module, loaded.workerDir);
    try {
      const registered = getRegisteredTool('echoTool');
      assert.ok(registered, 'echoTool should be visible through the tool registry');
      assert.equal(registered!.worker.id, 'local.test-worker');
      const result = await registered!.manifest.execute({ message: 'hello' });
      assert.equal(result, 'echo: hello');
    } finally {
      unregisterLocalWorkerModule('local.test-worker');
    }
  });
});

test('loadLocalWorkerModule rejects a mismatched manifest id', async () => {
  await withTempWorker(async (worker) => {
    worker.manifest = { ...worker.manifest, id: 'local.wrong-id' };
    await assert.rejects(() => loadLocalWorkerModule(worker), /does not match/);
  });
});

test('loadLocalWorkerModule rejects a module that declares an incompatible bfrostApiVersion', async () => {
  const { mkdir } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-loader-apiver-'));
  try {
    await mkdir(path.join(dir, 'dist'), { recursive: true });
    // Pre-compiled CJS so no esbuild step needed; declare a bogus API version in the module.
    await writeFile(
      path.join(dir, 'dist', 'index.js'),
      `module.exports = { manifest: { manifestVersion: 1, bfrostApiVersion: '99.0', id: 'local.apiver-worker', name: 'API Ver Worker', version: '0.1.0', description: 'test', builtIn: false, jobs: [] } };`,
      'utf8',
    );

    const worker: DiscoveredLocalWorker = {
      sourcePath: path.join(dir, 'worker.json'),
      language: 'javascript',
      backendEntrypoint: 'dist/index.js',
      manifest: {
        manifestVersion: 1,
        bfrostApiVersion: '0.1',
        id: 'local.apiver-worker',
        name: 'API Ver Worker',
        version: '0.1.0',
        description: 'test',
        builtIn: false,
        jobs: [],
      },
    };

    await assert.rejects(() => loadLocalWorkerModule(worker), /bfrostApiVersion/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
