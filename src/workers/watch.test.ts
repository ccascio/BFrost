import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compactOverlappingWatchRoots,
  findWorkerDirForChangedPath,
  shouldIgnoreWorkerWatchPath,
} from './watch';

test('watch roots are compacted so nested worker roots are not watched twice', () => {
  const parent = path.resolve('/tmp/bfrost-workers');
  const child = path.join(parent, 'local');
  const sibling = path.resolve('/tmp/bfrost-other-workers');

  assert.deepEqual(
    new Set(compactOverlappingWatchRoots([child, parent, child, sibling])),
    new Set([parent, sibling]),
  );
});

test('watch path filter ignores generated worker output and editor noise by path segment', () => {
  assert.equal(shouldIgnoreWorkerWatchPath('alpha/dist'), true);
  assert.equal(shouldIgnoreWorkerWatchPath('alpha/dist/index.js'), true);
  assert.equal(shouldIgnoreWorkerWatchPath(path.join('/tmp/workers/alpha', 'dist', 'index.js')), true);
  assert.equal(shouldIgnoreWorkerWatchPath('alpha/node_modules/pkg/index.js'), true);
  assert.equal(shouldIgnoreWorkerWatchPath('alpha/src/job.ts.tmp'), true);
  assert.equal(shouldIgnoreWorkerWatchPath('alpha/src/job.ts~'), true);

  assert.equal(shouldIgnoreWorkerWatchPath('alpha/src/job.ts'), false);
  assert.equal(shouldIgnoreWorkerWatchPath('alpha/src/distillation.ts'), false);
});

test('changed paths resolve to the owning worker directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bfrost-watch-'));
  const alpha = path.join(root, 'alpha');
  const beta = path.join(root, 'beta');

  try {
    await mkdir(path.join(alpha, 'src'), { recursive: true });
    await mkdir(path.join(beta, 'src'), { recursive: true });
    await writeFile(path.join(alpha, 'worker.json'), '{}', 'utf8');
    await writeFile(path.join(beta, 'worker.json'), '{}', 'utf8');
    await writeFile(path.join(alpha, 'src', 'job.ts'), '', 'utf8');
    await writeFile(path.join(root, 'notes.txt'), '', 'utf8');

    assert.equal(findWorkerDirForChangedPath(path.join(alpha, 'src', 'job.ts'), root), alpha);
    assert.equal(findWorkerDirForChangedPath(alpha, root), alpha);
    assert.equal(findWorkerDirForChangedPath(path.join(root, 'notes.txt'), root), null);
    assert.equal(findWorkerDirForChangedPath(path.join(root, 'missing', 'job.ts'), root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
