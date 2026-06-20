# Dev-Agent Worker + Developer Mode Toggle — Implementation Roadmap

**Goal:** Let JARVIS scaffold and edit BFrost workers from chat, gated behind a
"Developer mode" toggle in the chat UI. No external dependencies; no changes to
the worker-first contract.

This document is self-contained. You can implement it without the originating
conversation. Every design decision is justified here.

---

## Background and design decisions

### Why not bundle Pi (`@earendil-works/pi-coding-agent`)

Pi is a terminal coding agent with a proven read/write/edit/bash tool set and an
RPC subprocess mode. Three structural reasons to not embed it:

1. **Duplicate LLM layer.** Pi manages its own LLM session. BFrost already runs
   JARVIS on Claude — one of the best coding models available. Delegating to Pi
   would mean paying for two inference chains per "create a worker" request, with
   the context of what the user said in chat invisible to the inner Pi session.

2. **Provider fragmentation.** Pi maintains its own credential store (`~/.pi/`).
   A user who configured Anthropic in BFrost settings would have to configure it
   again in Pi, and BFrost's model selection UI would stop mattering.

3. **Dependency weight.** `@earendil-works/pi-coding-agent` pulls in a full TUI
   stack, image-resize WASM, clipboard native bindings, session branching, OAuth,
   and a shrinkwrap. That's a large attack surface for tooling we can replace
   with ~400 lines of focused TypeScript.

**What we take from Pi:** not the package, but the engineering decisions. Specific
patterns borrowed are documented in each tool section below.

### The `gatedBy` gate mechanism

Worker tools currently have one filter in the agent's tool catalog:
```typescript
// src/agent.ts — buildAgentToolCatalog()
if (manifest.defaultEnabled === false) continue;
```

Worker-enabled/disabled state (from `worker-state.json`) is only checked by the
scheduler and dashboard state builder — never by the agent. Disabling a worker
today does not remove its tools from the chat catalog. This is a gap.

The fix is a new optional field on `WorkerToolManifest`:

```typescript
gatedBy?: string;   // platform capability gate key
```

When present, the agent skips the tool unless a matching platform flag is active.
The agent never references a worker id — it checks the gate key and the flag.
The dev-agent worker uses gate key `'devMode'`.

### The `systemPromptFragment` manifest field

The BFrost worker contract (which files are off-limits, where to write new workers,
etc.) must be injected into JARVIS's system prompt when dev mode is active. This
content cannot live hardcoded in `src/agent.ts` — that would be core holding
worker-authoring knowledge, violating "removing a worker removes the feature."

The fix is a new optional field on `WorkerManifest`:

```typescript
systemPromptFragment?: { gate: string; text: string };
```

The agent collects these from all registered workers generically and appends any
whose gate is active. Removing the dev-agent worker removes the fragment.

### Auto-discovery of builtin workers

`src/workers/builtin/index.ts` walks the directory and loads any subfolder that
contains a `module.js`. **No manual registration step is needed.** Creating the
`src/workers/builtin/dev-agent/` folder and compiling is sufficient.

### Where dev mode is stored

A single KV key `'bfrost.devMode'` (value: `true | false`, JSON) stored via the
same `loadKvJson`/`saveKvJson` from `src/sqlite.ts` that admin-config.ts uses.
No worker-state changes. The flag is read per chat turn by the agent.

---

## Files to create

```
src/workers/builtin/dev-agent/
  manifest.ts       ← WorkerManifest with 4 tools + systemPromptFragment
  module.ts         ← BackendWorkerModule (no routes, no adapters)
  tools.ts          ← all 4 tool implementations + shared utilities
```

## Files to modify

```
src/workers/types.ts        ← add gatedBy to WorkerToolManifest
                              add systemPromptFragment to WorkerManifest
src/agent.ts                ← respect gatedBy gate; inject systemPromptFragment
src/http/routes/admin.ts    ← two new endpoints: GET/POST /api/dev-mode
web/src/tabs/ChatTab.tsx    ← dev mode toggle button in chat header
```

> **No changes needed in `src/admin-api.ts` or `src/admin-api.test.ts`.**
> `WorkerSummarySchema` does not include tool manifest details. The two new
> TypeScript fields are optional and never appear in the serialized API response.
> Run `npm run build:server` after changes; if any schema test fails unexpectedly,
> investigate before patching.

---

## Phase 1 — Core type changes

### 1.1  `src/workers/types.ts`

Add `gatedBy` to `WorkerToolManifest` (around line 280, after `defaultEnabled`):

```typescript
/**
 * Optional platform capability gate. When set, this tool is only included in
 * the agent's catalog when the named gate flag is active (e.g. `'devMode'`).
 * The agent reads the gate without knowing which worker the tool belongs to.
 */
gatedBy?: string;
```

Add `systemPromptFragment` to `WorkerManifest` (after `demoNotice`, around line 62):

```typescript
/**
 * Optional text fragment injected into the assistant's system prompt while the
 * named gate is active. The agent collects these from all registered workers
 * generically; removing the worker removes the fragment from the prompt.
 */
systemPromptFragment?: {
  /** Must match a gate key used by this worker's tools (e.g. `'devMode'`). */
  gate: string;
  /** Plain text appended after the main system prompt and project context. */
  text: string;
};
```

---

## Phase 2 — The `core.dev-agent` worker

### 2.1  `src/workers/builtin/dev-agent/module.ts`

Minimal module — no API routes, no adapters, no lifecycle hooks:

```typescript
import type { BackendWorkerModule } from '../../module';
import { devAgentWorker } from './manifest';

export const module: BackendWorkerModule = {
  manifest: devAgentWorker,
};
```

### 2.2  `src/workers/builtin/dev-agent/manifest.ts`

```typescript
import type { WorkerManifest } from '../../types';
import {
  executeDevReadFile,
  executeDevWriteFile,
  executeDevEditFile,
  executeDevRunBuild,
} from './tools';

const WORKER_ID = 'core.dev-agent';
const GATE = 'devMode';

export const devAgentWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: WORKER_ID,
  name: 'Dev Agent',
  displayName: 'Developer Agent',
  version: '0.1.0',
  description: 'Gives the assistant coding tools to scaffold and edit BFrost workers.',
  tagline:
    'Enable Developer mode to let the assistant read, write, and build workers ' +
    'directly from chat. All file operations are scoped to the BFrost project directory.',
  builtIn: true,
  section: 'system',
  settingsOnly: true,

  systemPromptFragment: {
    gate: GATE,
    text: `Developer mode is active. You have tools to read, write, edit, and build files in this BFrost installation.

BFrost worker contract — follow these rules without exception:
- New workers go in workers/local/<short-name>/ (hot-loaded without a server restart).
- Built-in workers go in src/workers/builtin/<id>/ only when the user explicitly requests one; they require a tsc rebuild + server restart to take effect.
- Never edit files in src/ outside src/workers/.
- Never edit files in web/src/ outside web/src/workers/.
- Core files that are always off-limits: src/agent.ts, src/admin-server.ts, src/scheduler.ts, src/llm.ts, src/workers/registry.ts, src/workers/validation.ts, src/workers/loader.ts, src/workers/build.ts, src/workers/bootstrap.ts, src/workers/storage.ts, src/workers/db.ts, src/workers/local.ts, src/workers/types.ts, src/sdk.ts, src/sdk-runtime.ts.
- Worker ids must be namespaced: local.<noun> for local workers (e.g. local.weather-poller), core.<category>.<noun> for built-ins.
- After writing or editing a local worker, run devRunBuild with command "tsc" to type-check. The local runtime hot-reloads on next use without a restart.
- After writing or editing a built-in worker, run devRunBuild with command "tsc" AND tell the user they must restart the server to pick up the changes.
- When creating a new worker, first read an existing reference worker (e.g. src/workers/builtin/shell/manifest.ts and module.ts) to understand the required shape.
- Use devReadFile for any file reading; do not ask the user to paste file contents.`,
  },

  jobs: [],
  tools: [
    {
      id: 'dev-read-file',
      workerId: WORKER_ID,
      name: 'devReadFile',
      description:
        'Read a file in the BFrost project. Path must be relative to the project root or absolute ' +
        'within it. Supports offset (1-indexed line number to start from) and limit (max lines to return). ' +
        'Output is capped at 2000 lines or 50 KB — when truncated, a continuation hint is included.',
      gatedBy: GATE,
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root, or absolute.' },
          offset: { type: 'number', description: '1-indexed line number to start reading from.' },
          limit: { type: 'number', description: 'Maximum number of lines to return.' },
        },
        required: ['path'],
      },
      execute: executeDevReadFile,
    },
    {
      id: 'dev-write-file',
      workerId: WORKER_ID,
      name: 'devWriteFile',
      description:
        'Create or overwrite a file in the BFrost project. Automatically creates parent directories. ' +
        'Use only for new files or complete rewrites; use devEditFile for targeted changes. ' +
        'Writes are restricted to workers/local/ and src/workers/builtin/ — core files are refused.',
      gatedBy: GATE,
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root, or absolute.' },
          content: { type: 'string', description: 'Full content to write.' },
        },
        required: ['path', 'content'],
      },
      execute: executeDevWriteFile,
    },
    {
      id: 'dev-edit-file',
      workerId: WORKER_ID,
      name: 'devEditFile',
      description:
        'Make one or more targeted text replacements in an existing file. ' +
        'Each edit replaces an exact region identified by oldText with newText. ' +
        'oldText must be unique in the file; if two changes touch overlapping or adjacent lines, ' +
        'merge them into a single edit. All edits are matched against the original file, not ' +
        'incrementally. Same path restrictions as devWriteFile.',
      gatedBy: GATE,
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root, or absolute.' },
          edits: {
            type: 'array',
            description: 'One or more replacements. Applied to the original file, not incrementally.',
            items: {
              type: 'object',
              properties: {
                oldText: {
                  type: 'string',
                  description: 'Exact text to replace. Must be unique in the file.',
                },
                newText: {
                  type: 'string',
                  description: 'Replacement text.',
                },
              },
              required: ['oldText', 'newText'],
            },
            minItems: 1,
          },
        },
        required: ['path', 'edits'],
      },
      execute: executeDevEditFile,
    },
    {
      id: 'dev-run-build',
      workerId: WORKER_ID,
      name: 'devRunBuild',
      description:
        'Run a build or test command in the BFrost project. ' +
        'Allowed: tsc (type-check), npm run build:server, npm run build:web, npm run build, ' +
        'node --test <dist-path>. ' +
        'Returns stdout + stderr, exit code, and duration. Output capped at 128 KB.',
      gatedBy: GATE,
      defaultEnabled: true,
      inputSchema: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['tsc', 'npm', 'node'],
            description: 'Binary to run.',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments. For npm: only ["run","build:server"] etc. For node: only ["--test","<path>"].',
          },
        },
        required: ['command'],
      },
      execute: executeDevRunBuild,
    },
  ],
};
```

### 2.3  `src/workers/builtin/dev-agent/tools.ts`

This is the core implementation. Read every section carefully.

#### Project root resolution

```typescript
import { execFile } from 'child_process';
import { mkdir, readFile, writeFile, access } from 'fs/promises';
import { constants } from 'fs';
import { realpath, resolve as resolvePath } from 'path';
import path from 'path';

/** Resolve the BFrost project root — the directory containing package.json. */
function getProjectRoot(): string {
  // __dirname is src/workers/builtin/dev-agent/ (compiled: dist/workers/builtin/dev-agent/)
  // Walk up four levels to reach the project root.
  return resolvePath(__dirname, '../../../../');
}
```

#### Path validation helpers

Two separate policies — reads are permissive (any file under root), writes are
restricted to worker directories only:

```typescript
/** Resolve a user-supplied path relative to the project root. */
function resolveUserPath(userPath: string): string {
  const root = getProjectRoot();
  const abs = path.isAbsolute(userPath)
    ? userPath
    : resolvePath(root, userPath);
  return abs;
}

/** Assert path is inside the project root. Throws on path traversal. */
function assertUnderRoot(abs: string): void {
  const root = getProjectRoot();
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the project root: ${abs}`);
  }
}

/**
 * Allowed write prefixes (relative to project root).
 * Core files can only be read, never written.
 */
const WRITE_ALLOWED_PREFIXES = [
  'workers/local/',
  'workers/local',          // exact directory
  'src/workers/builtin/',
  'src/workers/builtin',
];

function assertWriteAllowed(abs: string): void {
  const root = getProjectRoot();
  const rel = path.relative(root, abs).replace(/\\/g, '/');
  const allowed = WRITE_ALLOWED_PREFIXES.some(
    (prefix) => rel === prefix || rel.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'),
  );
  if (!allowed) {
    throw new Error(
      `Write refused: ${rel}\n` +
      `Writes are only allowed inside workers/local/ or src/workers/builtin/.\n` +
      `Core files (src/ outside src/workers/) are read-only.`,
    );
  }
}
```

#### File mutation queue (borrowed from Pi)

Serializes concurrent writes to the same file. Without this, two overlapping
tool executions can produce a torn file.

```typescript
const fileMutationQueues = new Map<string, Promise<void>>();
let registrationQueue = Promise.resolve();

async function getMutationKey(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return resolvePath(filePath);
  }
}

async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const registration = registrationQueue.then(async () => {
    const key = await getMutationKey(filePath);
    const current = fileMutationQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    fileMutationQueues.set(key, current.then(() => next));
    return { key, current, next, release };
  });
  registrationQueue = registration.then(() => undefined, () => undefined);

  const { key, current, next, release } = await registration;
  await current;
  try {
    return await fn();
  } finally {
    release();
    if (fileMutationQueues.get(key) === next) fileMutationQueues.delete(key);
  }
}
```

#### Truncation (borrowed from Pi — 2000 lines / 50 KB)

```typescript
const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

interface TruncationResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  outputLines: number;
}

function truncateOutput(text: string): TruncationResult {
  const allLines = text.split('\n');
  const totalLines = allLines.length;

  // Apply line limit first
  const byLines = allLines.slice(0, MAX_LINES);
  const byLinesText = byLines.join('\n');

  // Apply byte limit on the line-limited result
  const buf = Buffer.from(byLinesText, 'utf-8');
  if (buf.length <= MAX_BYTES && byLines.length === allLines.length) {
    return { content: byLinesText, truncated: false, totalLines, outputLines: byLines.length };
  }

  if (buf.length > MAX_BYTES) {
    // Truncate by bytes, never splitting a line in the middle
    const sliced = buf.slice(0, MAX_BYTES).toString('utf-8');
    const lastNewline = sliced.lastIndexOf('\n');
    const safe = lastNewline > 0 ? sliced.slice(0, lastNewline) : sliced;
    const outputLines = safe.split('\n').length;
    return { content: safe, truncated: true, totalLines, outputLines };
  }

  return { content: byLinesText, truncated: true, totalLines, outputLines: byLines.length };
}
```

#### `devReadFile` implementation

Supports `offset` (1-indexed) and `limit` with Pi-style continuation hints:

```typescript
export async function executeDevReadFile(
  input: { path: string; offset?: number; limit?: number },
): Promise<string> {
  const abs = resolveUserPath(input.path);
  assertUnderRoot(abs);

  let raw: Buffer;
  try {
    raw = await readFile(abs);
  } catch (err: any) {
    if (err.code === 'ENOENT') return `File not found: ${input.path}`;
    throw err;
  }

  const text = raw.toString('utf-8');
  const allLines = text.split('\n');
  const totalLines = allLines.length;

  const startIdx = input.offset !== undefined ? Math.max(0, input.offset - 1) : 0;
  if (startIdx >= totalLines) {
    return `Offset ${input.offset} is beyond end of file (${totalLines} lines total).`;
  }

  const slice = input.limit !== undefined
    ? allLines.slice(startIdx, startIdx + input.limit)
    : allLines.slice(startIdx);

  const { content, truncated, outputLines } = truncateOutput(slice.join('\n'));
  const startDisplay = startIdx + 1;
  const endDisplay = startIdx + outputLines;
  const nextOffset = endDisplay + 1;

  let result = content;
  if (truncated) {
    result += `\n\n[Showing lines ${startDisplay}–${endDisplay} of ${totalLines}. Use offset=${nextOffset} to continue.]`;
  } else if (input.limit !== undefined && startIdx + slice.length < totalLines) {
    result += `\n\n[${totalLines - (startIdx + slice.length)} more lines in file. Use offset=${startIdx + slice.length + 1} to continue.]`;
  }
  return result;
}
```

#### Fuzzy normalization for edit matching (borrowed from Pi)

Pi discovered that models often emit smart quotes, em-dashes, or Unicode spaces in
`oldText`, especially when the user copied text from a document. Without
normalization, exact matching silently fails. Copy this logic verbatim:

```typescript
function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    // smart single quotes → '
    .replace(/[‘’‚‛]/g, "'")
    // smart double quotes → "
    .replace(/[“”„‟]/g, '"')
    // various dashes → -
    .replace(/[‐‑‒–—―−]/g, '-')
    // special Unicode spaces → regular space
    .replace(/[  -   　]/g, ' ');
}

function detectLineEnding(text: string): '\r\n' | '\n' {
  const crlf = text.indexOf('\r\n');
  const lf = text.indexOf('\n');
  if (lf === -1) return '\n';
  if (crlf === -1) return '\n';
  return crlf < lf ? '\r\n' : '\n';
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function restoreLineEndings(text: string, ending: '\r\n' | '\n'): string {
  return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

function stripBom(text: string): { bom: string; text: string } {
  if (text.startsWith('﻿')) return { bom: '﻿', text: text.slice(1) };
  return { bom: '', text };
}
```

#### `devWriteFile` implementation

```typescript
export async function executeDevWriteFile(
  input: { path: string; content: string },
): Promise<string> {
  const abs = resolveUserPath(input.path);
  assertUnderRoot(abs);
  assertWriteAllowed(abs);

  return withFileMutationQueue(abs, async () => {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, input.content, 'utf-8');
    const lineCount = input.content.split('\n').length;
    const note = abs.includes('src/workers/builtin')
      ? ' Note: this is a built-in worker — run devRunBuild("tsc") then restart the server.'
      : '';
    return `Wrote ${input.content.length} bytes (${lineCount} lines) to ${input.path}.${note}`;
  });
}
```

#### `devEditFile` implementation

Batch `edits[]` matching with fuzzy normalization:

```typescript
interface EditPair { oldText: string; newText: string; }

export async function executeDevEditFile(
  input: { path: string; edits: EditPair[] },
): Promise<string> {
  const abs = resolveUserPath(input.path);
  assertUnderRoot(abs);
  assertWriteAllowed(abs);

  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    return 'Error: edits array must contain at least one entry.';
  }

  // Handle models that serialize edits as a JSON string (observed with some Claude versions)
  let edits: EditPair[] = input.edits;
  if (typeof (input.edits as unknown) === 'string') {
    try { edits = JSON.parse(input.edits as unknown as string); } catch { /* leave as-is */ }
  }

  return withFileMutationQueue(abs, async () => {
    let raw: Buffer;
    try {
      raw = await readFile(abs);
    } catch (err: any) {
      if (err.code === 'ENOENT') return `File not found: ${input.path}`;
      throw err;
    }

    const rawText = raw.toString('utf-8');
    const { bom, text: stripped } = stripBom(rawText);
    const lineEnding = detectLineEnding(stripped);
    const normalized = normalizeToLF(stripped);
    const normalizedForMatch = normalizeForMatch(normalized);

    // Validate all edits before applying any (fail early, fail clean)
    const matchedEdits: Array<{ index: number; length: number; newText: string }> = [];
    for (let i = 0; i < edits.length; i++) {
      const { oldText, newText } = edits[i];
      const normalizedOld = normalizeForMatch(normalizeToLF(oldText));

      const idx = normalizedForMatch.indexOf(normalizedOld);
      if (idx === -1) {
        return (
          `Edit ${i + 1} failed: oldText not found in file after normalization.\n` +
          `oldText was:\n${oldText}\n\n` +
          `Tip: read the file first with devReadFile to verify the exact content.`
        );
      }
      const secondIdx = normalizedForMatch.indexOf(normalizedOld, idx + 1);
      if (secondIdx !== -1) {
        return (
          `Edit ${i + 1} failed: oldText is not unique in the file — found at two positions.\n` +
          `Add more surrounding context to oldText to make it unique.`
        );
      }
      matchedEdits.push({ index: idx, length: normalizedOld.length, newText: normalizeToLF(newText) });
    }

    // Check for overlapping edits
    const sorted = [...matchedEdits].sort((a, b) => a.index - b.index);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.index + prev.length > curr.index) {
        return `Edit ${i + 1} overlaps with a previous edit. Merge them into a single edit entry.`;
      }
    }

    // Apply edits from last to first so earlier indices remain valid
    let result = normalized;
    for (const { index, length, newText } of sorted.reverse()) {
      result = result.slice(0, index) + newText + result.slice(index + length);
    }

    const final = bom + restoreLineEndings(result, lineEnding);
    await writeFile(abs, final, 'utf-8');

    return `Applied ${edits.length} edit(s) to ${input.path}.`;
  });
}
```

#### `devRunBuild` implementation

Strict allowlist — no shell interpolation, no pipes:

```typescript
const BUILD_ALLOWLIST: Record<string, string[][]> = {
  tsc: [[]],  // only bare `tsc`
  npm: [
    ['run', 'build'],
    ['run', 'build:server'],
    ['run', 'build:web'],
    ['run', 'test'],
  ],
  node: [
    // node --test, node --test <path>
  ],
};

const MAX_BUILD_OUTPUT_BYTES = 128 * 1024;
const BUILD_TIMEOUT_MS = 120_000;

function validateBuildArgs(command: string, args: string[]): void {
  if (command === 'tsc') {
    if (args.length > 0) throw new Error('tsc takes no arguments in dev mode.');
    return;
  }
  if (command === 'npm') {
    const allowed = BUILD_ALLOWLIST.npm!;
    const isAllowed = allowed.some(
      (pattern) => args.length >= pattern.length && pattern.every((p, i) => args[i] === p),
    );
    if (!isAllowed) {
      throw new Error(
        `npm subcommand not allowed: npm ${args.join(' ')}\n` +
        `Allowed: ${allowed.map((p) => 'npm ' + p.join(' ')).join(', ')}`,
      );
    }
    return;
  }
  if (command === 'node') {
    if (args[0] !== '--test') {
      throw new Error('node is only allowed with --test flag.');
    }
    // args[1] is optional: a dist/ path
    if (args[1] !== undefined) {
      const root = getProjectRoot();
      const abs = resolvePath(root, args[1]);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (rel.startsWith('..') || !rel.startsWith('dist/')) {
        throw new Error(`node --test path must be inside dist/: ${args[1]}`);
      }
    }
    return;
  }
  throw new Error(`Command not in allowlist: ${command}`);
}

export async function executeDevRunBuild(
  input: { command: string; args?: string[] },
): Promise<string> {
  const { command, args = [] } = input;

  try {
    validateBuildArgs(command, args);
  } catch (err: any) {
    return `Refused: ${err.message}`;
  }

  const root = getProjectRoot();

  return new Promise<string>((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let truncated = false;

    const proc = execFile(
      command,
      args,
      {
        cwd: root,
        timeout: BUILD_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_BUILD_OUTPUT_BYTES,
        windowsHide: true,
        env: { ...process.env },   // full env — build tools need PATH, NODE_PATH, etc.
      },
      (error, stdoutBuf, stderrBuf) => {
        const duration = Date.now() - start;
        let out = typeof stdoutBuf === 'string' ? stdoutBuf : stdoutBuf?.toString() ?? '';
        let err = typeof stderrBuf === 'string' ? stderrBuf : stderrBuf?.toString() ?? '';

        if (out.length > MAX_BUILD_OUTPUT_BYTES) { out = out.slice(0, MAX_BUILD_OUTPUT_BYTES); truncated = true; }
        if (err.length > MAX_BUILD_OUTPUT_BYTES) { err = err.slice(0, MAX_BUILD_OUTPUT_BYTES); truncated = true; }

        const exitCode = error
          ? (typeof (error as any).code === 'number' ? (error as any).code : 1)
          : 0;

        const lines: string[] = [`$ ${[command, ...args].join(' ')}`, `exit code: ${exitCode}`];
        if (out.trimEnd()) lines.push(`\nstdout:\n${out.trimEnd()}`);
        if (err.trimEnd()) lines.push(`\nstderr:\n${err.trimEnd()}`);
        if (!out.trimEnd() && !err.trimEnd()) lines.push('(no output)');
        if (truncated) lines.push('\n[output truncated]');
        lines.push(`\n(${duration} ms)`);

        resolve(lines.join('\n'));
      },
    );

    // Safety: if execFile callback fires with ERR_CHILD_PROCESS_STDIO_MAXBUFFER,
    // the process is already dead. Nothing else to do.
    proc.on('error', () => {}); // prevent unhandled rejection on spawn errors
  });
}
```

> **Note on build environment:** Unlike BFrost's `core.shell` worker, `devRunBuild`
> passes the full `process.env` to the child. This is necessary because `tsc`, `node`,
> and `npm` need `PATH` and `NODE_PATH` to resolve TypeScript, ts-node, and npm itself.
> The `core.shell` worker scrubs the environment because it runs arbitrary user commands;
> `devRunBuild` runs a hardcoded allowlist of build tools where env leakage is acceptable
> and required for correct operation.

---

## Phase 3 — Agent changes

### 3.1  `src/agent.ts`

Two changes to `buildAgentToolCatalog()` and `runAgent()`.

#### Read dev mode flag once per catalog build

At the top of `buildAgentToolCatalog()`, add an async helper:

```typescript
import { loadKvJson } from './sqlite';

const DEV_MODE_KV_KEY = 'bfrost.devMode';

async function isGateActive(gate: string): Promise<boolean> {
  if (gate === 'devMode') {
    return (await loadKvJson<boolean>(DEV_MODE_KV_KEY)) === true;
  }
  return false;
}
```

Since `buildAgentToolCatalog()` is currently synchronous, make it async (the
caller `runAgent` already `await`s it indirectly via `generateText`):

```typescript
async function buildAgentToolCatalog(): Promise<Record<string, any>> {
  const catalog: Record<string, any> = {};

  // Cache gate results for this catalog build — avoid one KV read per gated tool
  const gateCache = new Map<string, boolean>();
  async function checkGate(gate: string): Promise<boolean> {
    if (!gateCache.has(gate)) gateCache.set(gate, await isGateActive(gate));
    return gateCache.get(gate)!;
  }

  for (const registered of listRegisteredTools()) {
    const manifest = registered.manifest;
    if (manifest.defaultEnabled === false) continue;
    if (manifest.gatedBy && !(await checkGate(manifest.gatedBy))) continue;
    // ... rest of existing loop unchanged ...
  }
  // ... job tool catalog loop unchanged ...
  return catalog;
}
```

Update the call site in `runAgent`:
```typescript
tools: await buildAgentToolCatalog(),
```

#### Inject system prompt fragments from gated workers

In `runAgent()`, after the existing project-context block:

```typescript
import { listWorkerModules } from './workers/registry';

// Inside runAgent(), after building `system`:
const fragments: string[] = [];
for (const mod of listWorkerModules()) {
  const frag = mod.manifest.systemPromptFragment;
  if (!frag) continue;
  if (await isGateActive(frag.gate)) {
    fragments.push(frag.text);
  }
}
if (fragments.length > 0) {
  system = system + '\n\n' + fragments.join('\n\n');
}
```

> `listWorkerModules()` is already exported from `src/workers/registry.ts`.
> It returns all visible (non-hidden) backend modules. No new registry function
> is needed.

---

## Phase 4 — Dev mode API

### 4.1  `src/http/routes/admin.ts`

Add two routes (find the existing route registration pattern and follow it):

```typescript
import { loadKvJson, saveKvJson } from '../../sqlite';

const DEV_MODE_KV_KEY = 'bfrost.devMode';

// GET /api/dev-mode
{
  method: 'GET',
  path: '/api/dev-mode',
  workerId: null,
  async handler(_req, res) {
    const enabled = (await loadKvJson<boolean>(DEV_MODE_KV_KEY)) === true;
    res.json({ enabled });
  },
},

// POST /api/dev-mode
{
  method: 'POST',
  path: '/api/dev-mode',
  workerId: null,
  async handler(req, res) {
    const body = req.body as unknown;
    if (!body || typeof body !== 'object' || typeof (body as any).enabled !== 'boolean') {
      res.status(400).json({ error: 'Body must be { enabled: boolean }' });
      return;
    }
    await saveKvJson(DEV_MODE_KV_KEY, (body as any).enabled);
    res.json({ enabled: (body as any).enabled });
  },
},
```

> Check `src/http/routes/admin.ts` for the exact `AdminApiRoute` shape used by
> other routes in that file and match it.

---

## Phase 5 — Frontend toggle

### 5.1  `web/src/tabs/ChatTab.tsx`

Add a dev mode toggle button inside the `panel-head` div, alongside the existing
`StatusPill`. The toggle fetches state on mount and posts on click.

**State:**

```typescript
const [devMode, setDevMode] = useState<boolean | null>(null);

useEffect(() => {
  void fetch('/api/dev-mode')
    .then((r) => r.json())
    .then((data: { enabled: boolean }) => setDevMode(data.enabled));
}, []);

const toggleDevMode = async () => {
  const next = !devMode;
  await fetch('/api/dev-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: next }),
  });
  setDevMode(next);
};
```

**Render** (add inside `panel-head`, after the `StatusPill`):

```tsx
{devMode !== null && (
  <button
    type="button"
    className={`dev-mode-toggle${devMode ? ' dev-mode-toggle--on' : ''}`}
    title={devMode ? 'Developer mode on — coding tools active' : 'Developer mode off'}
    onClick={() => void toggleDevMode()}
  >
    {devMode ? '⚙ Dev mode' : '⚙'}
  </button>
)}
```

**CSS** (add to `web/src/styles.css` or the chat component's style block):

```css
.dev-mode-toggle {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.dev-mode-toggle--on {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
```

---

## Build and test checklist

Run these after each phase, not just at the end.

### After Phase 1 (type changes)
```bash
npm run build:server
# Expect: no TypeScript errors; the two new optional fields are backward-compatible.
```

### After Phase 2 (new worker)
```bash
npm run build:server
# Expect: tsc clean; the auto-discovery in src/workers/builtin/index.ts will
# pick up the new folder automatically — no manual registration.
npm start
# In another terminal:
curl http://localhost:3030/api/workers | jq '.workers[] | select(.id=="core.dev-agent")'
# Expect: worker appears in the list, section="system", settingsOnly=true.
```

### After Phase 3 (agent changes)
```bash
# Manually: enable dev mode via curl, then send a chat message.
curl -X POST http://localhost:3030/api/dev-mode -H 'Content-Type: application/json' -d '{"enabled":true}'
# Open the chat, type: "List the files in src/workers/builtin/shell/"
# Expect: JARVIS calls devReadFile and returns directory contents.
curl -X POST http://localhost:3030/api/dev-mode -H 'Content-Type: application/json' -d '{"enabled":false}'
# Type the same message again.
# Expect: JARVIS answers from general knowledge, devReadFile not called.
```

### After Phase 4 (API endpoints)
```bash
curl http://localhost:3030/api/dev-mode
# → {"enabled":false}
curl -X POST http://localhost:3030/api/dev-mode -H 'Content-Type: application/json' -d '{"enabled":true}'
# → {"enabled":true}
curl http://localhost:3030/api/dev-mode
# → {"enabled":true}
```

### After Phase 5 (frontend)
```bash
npm run build:web
npm start
# Open http://localhost:3030 → Chat tab.
# Expect: ⚙ button visible in chat header.
# Click it: button turns accent-colored, "Dev mode" label appears.
# Click again: returns to muted state.
```

### End-to-end worker authoring test
With dev mode enabled:

1. Type: `"Create a local BFrost worker called local.hello that exposes a tool called sayHello returning a greeting string."`
2. Expect JARVIS to: read a reference manifest, write `workers/local/hello/worker.json` + `src/index.ts`, run `devRunBuild("tsc")`, confirm success.
3. Restart the server.
4. Verify the worker appears in the workers list.
5. Type: `"Say hello"` — JARVIS should call the `sayHello` tool.

---

## Safety posture (state plainly)

These tools run with the OS permissions of the BFrost server process. Path
restriction is a prefix check, not an OS-level sandbox — an allowlisted path
cannot escape the BFrost root, but the process retains its ambient filesystem
permissions. This is the same posture as the existing `core.shell` worker's
documented sandbox note.

`devRunBuild` executing `node --test` runs compiled worker code on the host with
no additional privilege drops. This is inherent to an agentic coding tool and
identical to what Claude Code does. The gate (`devMode` toggle) is the operator's
explicit consent. It is off by default.

The toggle state persists across server restarts (stored in SQLite KV). The
operator must turn it off explicitly. Consider adding a visual indicator in
the chat header (already in Phase 5) so the operator is never surprised by
an active dev mode session.

---

## What was deliberately left out

- **AbortSignal support** on file tools — tools are invoked synchronously by the
  agent SDK per turn; mid-turn cancellation is not exposed to tool executors today.
- **Image reading** — not needed for TypeScript source files.
- **Grep / find / ls tools** — the `devReadFile` tool combined with JARVIS's
  knowledge of TypeScript project structure is sufficient. Add these later if
  navigating large directories proves cumbersome.
- **Pi's bash tool** — deliberately replaced with `devRunBuild`'s strict allowlist.
  If you later need arbitrary shell access from dev mode, extend the allowlist in
  `validateBuildArgs()` rather than opening a generic bash surface.
- **Per-session dev mode** — the flag is global. A future iteration could store
  it per `chatId` in the `ChatThread` table, but the complexity isn't worth it
  for a tool used by a single operator.
