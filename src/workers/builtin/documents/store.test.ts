import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../../../config';
import { closeDb } from '../../../sqlite';
import { runWithChatContext } from '../../../chat-context';
import { createProject, deleteProject, hydrateProjects } from '../../../projects';
import { documentsWorker } from './manifest';
import { addFile, listFiles, reconcileOrphans, resetDocumentStoreForTests } from './store';

const searchDocumentsTool = (documentsWorker.tools ?? []).find((t) => t.name === 'searchDocuments')!;

async function withDocStore(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-docs-'));
  const previousDbPath = config.appDbPath;
  const previousProvider = config.embeddingProvider;
  const previousKey = config.openaiApiKey;
  config.appDbPath = path.join(dir, 'app.sqlite');
  // Force the keyword path: an unconfigured embed provider makes embedText throw,
  // which the store treats as "no embeddings available". Keeps the test offline.
  config.embeddingProvider = 'openai';
  config.openaiApiKey = '';
  resetDocumentStoreForTests();
  try {
    await hydrateProjects();
    await run();
  } finally {
    config.appDbPath = previousDbPath;
    config.embeddingProvider = previousProvider;
    config.openaiApiKey = previousKey;
    resetDocumentStoreForTests();
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
}

test('searchDocuments tool only sees the active project (ALS scoping)', async () => {
  await withDocStore(async () => {
    const projectA = createProject('Garden');
    const projectB = createProject('Physics');
    await addFile({ projectId: projectA.projectId, filename: 'garden.md', content: 'Tomatoes need full sun and regular watering.' });
    await addFile({ projectId: projectB.projectId, filename: 'physics.md', content: 'Quantum entanglement links distant particles.' });

    // In project A's context, a tomato query finds A's file and never B's.
    const inA = await runWithChatContext(
      { conversationId: 'c-a', projectId: projectA.projectId },
      () => searchDocumentsTool.execute({ query: 'tomatoes watering' }) as Promise<string>,
    );
    assert.match(inA, /garden\.md/);
    assert.doesNotMatch(inA, /physics\.md/);

    // The same query in project B finds nothing — B has no matching documents.
    const inB = await runWithChatContext(
      { conversationId: 'c-b', projectId: projectB.projectId },
      () => searchDocumentsTool.execute({ query: 'tomatoes watering' }) as Promise<string>,
    );
    assert.match(inB, /No relevant content/i);
  });
});

test('searchDocuments tool reports when no project is in context', async () => {
  await withDocStore(async () => {
    const result = await (searchDocumentsTool.execute({ query: 'anything' }) as Promise<string>);
    assert.match(result, /No project is selected/i);
  });
});

test('reconcileOrphans drops files from deleted projects', async () => {
  await withDocStore(async () => {
    const project = createProject('Temp');
    await addFile({ projectId: project.projectId, filename: 'note.txt', content: 'Some content here.' });
    assert.equal((await listFiles(project.projectId)).length, 1);

    deleteProject(project.projectId);
    const removed = await reconcileOrphans();
    assert.equal(removed, 1);
    assert.equal((await listFiles(project.projectId)).length, 0);
  });
});
