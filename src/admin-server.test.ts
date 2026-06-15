import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';
import {
  assertSafeArchiveNames,
  assertNoSymlinkEntries,
  startAdminServer,
  stopAdminServer,
} from './admin-server';
import { config } from './config';
import { closeDb } from './sqlite';
import { createThread, getThread, hydrateThreads } from './chat-threads';
import { hydrateProjects } from './projects';
import { addUserMessage, addAssistantMessage } from './conversation';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

// These guard worker zip/tarball installs against zip-slip / tar-slip path traversal and
// symlink-based escape. The verbose-listing assumption (`unzip -Z` / `tar -tvzf` emit the
// entry type as the first column, `l` for a symlink) was confirmed against the real tools;
// these cases lock in the parsing so a future refactor can't silently reopen the hole.

test('assertSafeArchiveNames rejects parent-directory traversal', () => {
  assert.throws(() => assertSafeArchiveNames(['ok/file.txt', '../escape.txt']), /path-traversal/);
  assert.throws(() => assertSafeArchiveNames(['a/../../b']), /path-traversal/);
});

test('assertSafeArchiveNames rejects absolute paths (posix and windows)', () => {
  assert.throws(() => assertSafeArchiveNames(['/etc/passwd']), /absolute path/);
  assert.throws(() => assertSafeArchiveNames(['C:/Windows/system32']), /absolute path/);
  assert.throws(() => assertSafeArchiveNames(['..\\winescape']), /path-traversal/);
});

test('assertSafeArchiveNames accepts ordinary nested entries', () => {
  assert.doesNotThrow(() =>
    assertSafeArchiveNames(['worker.json', 'src/index.ts', 'frontend/dashboard.tsx', '']),
  );
});

test('assertNoSymlinkEntries rejects a symlink line from unzip -Z / tar -tvzf', () => {
  // Real unzip -Z output for a symlink entry.
  assert.throws(
    () => assertNoSymlinkEntries(['lrwxr-xr-x  3.0 unx       11 bx stor 26-May-29 12:10 link']),
    /symbolic link/,
  );
  // Real tar -tvzf output for a symlink entry.
  assert.throws(
    () => assertNoSymlinkEntries(['lrwxr-xr-x  0 user wheel 0 May 29 12:10 link -> /etc/passwd']),
    /symbolic link/,
  );
});

test('assertNoSymlinkEntries accepts files, dirs, and listing headers', () => {
  assert.doesNotThrow(() =>
    assertNoSymlinkEntries([
      'Archive:  t.zip',
      'Zip file size: 323 bytes, number of entries: 2',
      '-rw-r--r--  3.0 unx        6 tx stor 26-May-29 12:10 normal.txt',
      'drwxr-xr-x  0 user wheel 0 May 29 12:10 src/',
      '2 files, 17 bytes uncompressed',
      '',
    ]),
  );
});

test('router dispatch serves exact routes, static fallback, and 404s over HTTP', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-admin-router-'));
  const previous = {
    appDbPath: config.appDbPath,
    adminPort: config.adminPort,
    adminHost: config.adminHost,
    adminPassword: config.adminPassword,
  };
  config.appDbPath = path.join(dir, 'app.sqlite');
  config.adminHost = '127.0.0.1';
  config.adminPort = await freePort();
  config.adminPassword = '';
  const base = `http://127.0.0.1:${config.adminPort}`;

  try {
    await hydrateThreads();
    await startAdminServer();

    // Exact core route resolves through the declarative table.
    const dashboard = await fetch(`${base}/api/dashboard`);
    assert.equal(dashboard.status, 200);
    assert.ok((await dashboard.json() as { workers?: unknown }).workers !== undefined);

    // Static fallback for a non-API GET (no router match → serveStatic serves the SPA).
    assert.notEqual((await fetch(`${base}/`)).status, 404);

    // Unmatched non-GET request → 404 (non-GET never falls through to static).
    assert.equal((await fetch(`${base}/api/does-not-exist`, { method: 'POST' })).status, 404);

    // Method specificity: /api/dashboard is GET-only, so POST falls through to 404.
    assert.equal((await fetch(`${base}/api/dashboard`, { method: 'POST' })).status, 404);
  } finally {
    await stopAdminServer();
    config.appDbPath = previous.appDbPath;
    config.adminPort = previous.adminPort;
    config.adminHost = previous.adminHost;
    config.adminPassword = previous.adminPassword;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('chat thread routes list, reopen, rename, and delete over HTTP', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-admin-chats-'));
  const previous = {
    appDbPath: config.appDbPath,
    adminPort: config.adminPort,
    adminHost: config.adminHost,
    adminPassword: config.adminPassword,
  };
  config.appDbPath = path.join(dir, 'app.sqlite');
  config.adminHost = '127.0.0.1';
  config.adminPort = await freePort();
  config.adminPassword = ''; // auth disabled so routes are reachable without a session
  const base = `http://127.0.0.1:${config.adminPort}`;

  try {
    await hydrateThreads();
    // Seed a thread and its stored history the same way the channel layer would:
    // the registry's chatId is the key into the conversation store.
    const thread = createThread({ channel: 'dashboard', conversationId: 'http-1', chatId: 5150, title: 'Seeded chat' });
    addUserMessage(thread.chatId, 'what is queued?');
    addAssistantMessage(thread.chatId, 'Three items are queued.');

    await startAdminServer();

    // List shows the dashboard thread.
    const list = await (await fetch(`${base}/api/chats`)).json() as { threads: Array<{ conversationId: string }> };
    assert.ok(list.threads.some((t) => t.conversationId === 'http-1'));

    // Reopen returns the stored turns — proves the route resolves history by registry chatId.
    const reopenRes = await fetch(`${base}/api/chats/http-1`);
    assert.equal(reopenRes.status, 200);
    const reopen = await reopenRes.json() as { turns: Array<{ role: string; text: string }> };
    assert.deepEqual(reopen.turns.map((t) => t.role), ['user', 'assistant']);
    assert.equal(reopen.turns[0].text, 'what is queued?');

    // Unknown thread → 404.
    assert.equal((await fetch(`${base}/api/chats/does-not-exist`)).status, 404);

    // Rename.
    const renameRes = await fetch(`${base}/api/chats/http-1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed via HTTP' }),
    });
    assert.equal(renameRes.status, 200);
    assert.equal((await renameRes.json() as { thread: { title: string } }).thread.title, 'Renamed via HTTP');

    // Delete, then reopen 404s.
    assert.equal((await fetch(`${base}/api/chats/http-1`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/api/chats/http-1`)).status, 404);
  } finally {
    await stopAdminServer();
    config.appDbPath = previous.appDbPath;
    config.adminPort = previous.adminPort;
    config.adminHost = previous.adminHost;
    config.adminPassword = previous.adminPassword;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('project routes create/list/delete and assign a chat to a project over HTTP', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-admin-projects-'));
  const previous = {
    appDbPath: config.appDbPath,
    adminPort: config.adminPort,
    adminHost: config.adminHost,
    adminPassword: config.adminPassword,
  };
  config.appDbPath = path.join(dir, 'app.sqlite');
  config.adminHost = '127.0.0.1';
  config.adminPort = await freePort();
  config.adminPassword = '';
  const base = `http://127.0.0.1:${config.adminPort}`;

  try {
    await hydrateThreads();
    await hydrateProjects();
    createThread({ channel: 'dashboard', conversationId: 'chat-proj', chatId: 7000, title: 'Assign me' });

    await startAdminServer();

    // Create a project.
    const created = await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Research' }),
    });
    assert.equal(created.status, 201);
    const { project } = await created.json() as { project: { projectId: string; name: string } };
    assert.equal(project.name, 'Research');

    // It appears in the list.
    const list = await (await fetch(`${base}/api/projects`)).json() as { projects: Array<{ projectId: string }> };
    assert.ok(list.projects.some((p) => p.projectId === project.projectId));

    // Assign the chat to the project via PATCH /api/chats/:id.
    const assign = await fetch(`${base}/api/chats/chat-proj`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.projectId }),
    });
    assert.equal(assign.status, 200);
    assert.equal(getThread('chat-proj')?.projectId, project.projectId);

    // Delete the project; unknown project → 404.
    assert.equal((await fetch(`${base}/api/projects/${project.projectId}`, { method: 'DELETE' })).status, 200);
    assert.equal((await fetch(`${base}/api/projects/nope`, { method: 'DELETE' })).status, 404);
    // The assigned thread is detached, not left with a dangling project id.
    assert.equal(getThread('chat-proj')?.projectId, null);
  } finally {
    await stopAdminServer();
    config.appDbPath = previous.appDbPath;
    config.adminPort = previous.adminPort;
    config.adminHost = previous.adminHost;
    config.adminPassword = previous.adminPassword;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});
