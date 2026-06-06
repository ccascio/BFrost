import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { closeDb } from './sqlite';
import {
  createProject,
  deleteProject,
  flushProjects,
  getProject,
  hydrateProjects,
  listProjectIds,
  listProjects,
  renameProject,
} from './projects';

async function withTempDb(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-projects-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');
  try {
    await hydrateProjects();
    await run();
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
}

test('projects can be created, listed, renamed, and deleted', async () => {
  await withTempDb(async () => {
    const a = createProject('Zeta');
    const b = createProject('Alpha');

    // Sorted by name.
    assert.deepEqual(listProjects().map((p) => p.name), ['Alpha', 'Zeta']);
    assert.deepEqual(listProjectIds().sort(), [a.projectId, b.projectId].sort());

    renameProject(a.projectId, 'Renamed');
    assert.equal(getProject(a.projectId)?.name, 'Renamed');

    assert.equal(deleteProject(b.projectId), true);
    assert.equal(getProject(b.projectId), undefined);
    assert.equal(deleteProject(b.projectId), false);
  });
});

test('projects persist across hydration', async () => {
  await withTempDb(async () => {
    const project = createProject('Persistent');
    await flushProjects();

    await hydrateProjects();
    assert.equal(getProject(project.projectId)?.name, 'Persistent');
  });
});
