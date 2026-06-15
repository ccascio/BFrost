// Worker operations: catalog, upload, describe-to-scaffold, store install, dashboard
// bundle serving, and archive-safety. Extracted from admin-server.ts (CODE_ROADMAP 1.1).
// Imports are inherited verbatim from admin-server; unused ones are harmless (no
// noUnusedLocals) and keep the extraction mechanical.
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import http, { IncomingMessage, Server, ServerResponse } from 'http';
import { randomBytes, timingSafeEqual } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import {
  config,
  availableModels,
  getDefaultModel,
  setCloudApiKeys,
  setDefaultModel,
  setEmbeddingSettings,
  setAdminPassword,
  setLocalWorkerCodeEnabled,
  setAdminSessionTtlHours,
  setJobLlmTimeoutMs,
} from './config';
import { refreshActiveLocalProviderModels, refreshCloudProviderModels } from './model-discovery';
import { upsertEnvValue } from './env-file';
import {
  collectRecipes,
  getActiveLocalProvider,
  getRegisteredProvider,
  listRegisteredApiRoutes,
  listRegisteredChannels,
  listRegisteredProviders,
} from './workers/registry';
import { updatePlatformSettings } from './admin-config';
import { HttpRouter } from './http/router';
import { readJsonBody, readRawBody, sendJson } from './http/responses';
import type { ProviderAdapter } from './workers/module';
import { getSchedulerSnapshot, reloadSchedulerSchedules, triggerJobNow, updateSchedulerJob } from './scheduler';
import { isJobName, pinAndLoadModel, unpinAndUnloadModel } from './job-runner';
import { getPinnedModelId } from './local-model-pin';
import { listWorkers, setHiddenBuiltInIds } from './workers/registry';
import { builtInWorkers } from './workers/builtin';
import { discoverLocalWorkerResult, discoverLocalWorkers, type DiscoveredLocalWorker } from './workers/local';
import { compileLocalWorkerDashboard } from './workers/build';
import {
  normalizeScaffoldSpec,
  specFromModelOutput,
  writeWorkerScaffold,
  workerSlug,
  type WorkerScaffoldSpec,
} from './workers/scaffold';
import {
  forgetWorker,
  isWorkerEnabled,
  loadWorkerState,
  rememberSeenWorkers,
  setWorkerEnabled,
  setWorkerHidden,
  type WorkerStateStore,
} from './workers/state';
import { activateLocalWorker, deactivateLocalWorker } from './workers/bootstrap';
import { WorkerLoadError } from './workers/loader';
import type { WorkerManifest } from './workers/types';
import { getAppHealthSnapshot } from './health';
import type { AppHealthSnapshot, HealthStatus } from './health';
import { listRecentEventsSafe, recordEventSafe } from './event-log';
import { loadQueueSnapshot, updateDashboardQueueItem } from './jobs/queue-service';
import { loadRegisteredWorkerDashboardData } from './workers/dashboard-data';
import {
  AdminLoginBodySchema,
  AutoBackupSettingsSchema,
  BackupsSectionSchema,
  ChatMessageBodySchema,
  GenerateWorkerBodySchema,
  ChatThreadUpdateBodySchema,
  ProjectCreateBodySchema,
  ProjectRenameBodySchema,
  CloudApiKeysBodySchema,
  CoreSettingsBodySchema,
  EmbeddingSettingsBodySchema,
  FactoryResetBodySchema,
  PlatformSettingsBodySchema,
  CronJobUpdateBodySchema,
  CronRunsSectionSchema,
  DashboardStateSchema,
  DefaultModelBodySchema,
  EventsSectionSchema,
  LmStudioActionBodySchema,
  LmStudioModelsSectionSchema,
  LocalEmbeddingModelsSectionSchema,
  type LocalEmbeddingModelsSection,
  StoreInstallBodySchema,
  WorkerDataSectionSchema,
  WorkerUpdateBodySchema,
  QueueItemActionBodySchema,
  QueueSectionSchema,
  ActionDecisionBodySchema,
  JobMetricsResponseSchema,
  RecipeApplyBodySchema,
  type BackupsSection,
  type CronRunsSection,
  type DashboardState,
  type EventsSection,
  type LmStudioModelsSection,
  type WorkerDataSection,
  type QueueSection,
  type JobMetricsResponse,
} from './admin-api';
import {
  listPendingActionRequests,
  listActionRequests,
  approveActionRequest,
  rejectActionRequest,
} from './actions';
import { BadRequestError } from './admin-route';
import { listSchedulerRuns } from './scheduler-runs';
import {
  createAppBackup,
  getAutoBackupSettings,
  listAppBackups,
  restartAutoBackup,
  saveAutoBackupSettings,
  scheduleRestoreOnNextBoot,
  cancelPendingRestore,
} from './app-backup';
import { processChannelMessage } from './channel';
import { getFullHistory } from './conversation';
import {
  listThreads,
  getThread,
  renameThread,
  assignThreadProject,
  clearProjectFromThreads,
  deleteThread,
} from './chat-threads';
import {
  listProjects,
  getProject,
  createProject,
  renameProject,
  deleteProject,
} from './projects';
import { createHash } from 'crypto';
import { loadKvJson, saveKvJson } from './sqlite';
import { openWorkerKv } from './workers/storage';
import { generateText } from 'ai';
import { getChatModel } from './llm';
import { publishItem } from './jobs/item-bus';

// --- shared worker constants ---
// Set of ids that exist as built-in worker modules (checked without loading state).
export const builtInWorkerIds: ReadonlySet<string> = new Set(builtInWorkers.map((w) => w.id));

/**
 * Read the current worker state and push any hidden built-in ids into the
 * registry so `allModules()` / `listWorkers()` stays in sync with persistent
 * operator decisions across the full request cycle.
 *
 * We match against the static built-in catalog rather than the `builtIn` flag
 * in state, because the flag is set to `false` when a reinstalled local copy
 * overwrites the state entry while the original built-in is still hidden.
 */
export async function syncHiddenBuiltIns(state?: WorkerStateStore): Promise<void> {
  const s = state ?? await loadWorkerState();
  const ids = new Set(
    Object.entries(s.workers)
      .filter(([id, r]) => r.hidden === true && builtInWorkerIds.has(id))
      .map(([id]) => id),
  );
  setHiddenBuiltInIds(ids);
}
export const MAX_WORKER_UPLOAD_BYTES = 25 * 1024 * 1024;
export const execFileAsync = promisify(execFile);

export type CatalogWorker = WorkerManifest & { sourcePath?: string };

export async function withLocalProvider<T>(action: (provider: ProviderAdapter) => Promise<T>): Promise<T> {
  const provider = getActiveLocalProvider();
  if (!provider) {
    throw new BadRequestError('No local provider worker is configured.');
  }
  return action(provider);
}


export function workerCatalog(localWorkers: DiscoveredLocalWorker[]): Map<string, CatalogWorker> {
  const catalog = new Map<string, CatalogWorker>();
  for (const worker of listWorkers()) {
    catalog.set(worker.id, worker);
  }
  for (const worker of localWorkers) {
    const loaded = catalog.get(worker.manifest.id);
    catalog.set(
      worker.manifest.id,
      loaded
        ? {
            ...loaded,
            chatPrompts: loaded.chatPrompts ?? worker.manifest.chatPrompts,
            sourcePath: worker.sourcePath,
          }
        : { ...worker.manifest, sourcePath: worker.sourcePath },
    );
  }
  return catalog;
}

export async function uploadLocalWorkerZip(req: IncomingMessage): Promise<DiscoveredLocalWorker> {
  const filename = headerValue(req.headers['x-worker-filename']) || 'worker.zip';
  if (!filename.toLowerCase().endsWith('.zip')) {
    throw new BadRequestError('Upload must be a .zip file.');
  }

  const body = await readRawBody(req, MAX_WORKER_UPLOAD_BYTES);
  if (body.length === 0) {
    throw new BadRequestError('Uploaded worker zip is empty.');
  }

  const installRoot = path.resolve(config.workerPaths[0] || './workers/local');
  const targetName = safeWorkerFolderName(filename.replace(/\.zip$/i, ''));
  const targetDir = path.join(installRoot, targetName);
  if (!isPathInside(installRoot, targetDir) || targetDir === installRoot) {
    throw new BadRequestError('Invalid worker upload target.');
  }

  await fs.mkdir(installRoot, { recursive: true });
  if (await pathExists(targetDir)) {
    throw new BadRequestError(`A local worker folder named ${targetName} already exists.`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bfrost-worker-upload-'));
  const zipPath = path.join(tempRoot, 'worker.zip');
  const extractDir = path.join(tempRoot, 'extract');

  try {
    await fs.writeFile(zipPath, body);
    await fs.mkdir(extractDir, { recursive: true });
    await safeExtractZip(zipPath, extractDir);

    const result = await discoverLocalWorkerResult([extractDir]);
    if (result.workers.length !== 1) {
      const detail = result.issues[0]?.message ?? 'Zip must contain exactly one worker.json manifest.';
      throw new BadRequestError(detail);
    }

    const worker = result.workers[0];
    const existing = workerCatalog(await discoverLocalWorkers()).get(worker.manifest.id);
    if (existing) {
      throw new BadRequestError(`A worker with id ${worker.manifest.id} is already installed.`);
    }

    const workerDir = path.dirname(path.resolve(worker.sourcePath));
    if (!isPathInside(extractDir, workerDir)) {
      throw new BadRequestError('Worker manifest must stay inside the uploaded zip contents.');
    }

    await moveDirectory(workerDir, targetDir);
    const installed = await discoverLocalWorkers([targetDir]);
    const uploaded = installed.find((item) => item.manifest.id === worker.manifest.id);
    if (!uploaded) {
      throw new BadRequestError('Uploaded worker could not be discovered after installation.');
    }
    await rememberSeenWorkers([{ id: uploaded.manifest.id, builtIn: false, sourcePath: uploaded.sourcePath }]);
    return uploaded;
  } catch (err) {
    await fs.rm(targetDir, { recursive: true, force: true });
    if (err instanceof BadRequestError) {
      throw err;
    }
    throw new BadRequestError(`Worker upload failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Describe-a-worker: turn a natural-language description into an installed,
// enabled local worker. The model only ever emits a constrained JSON spec —
// the worker's TypeScript is generated deterministically by the scaffolder, so
// a flaky model can never produce code that fails to compile or load.
// ---------------------------------------------------------------------------

export const WORKER_SPEC_SYSTEM_PROMPT = `You design a single BFrost "local worker" from a user's description.

A worker is one of:
- "producer": generates content on a schedule and publishes it to the Item Bus.
- "consumer": reads items of a given type from the Item Bus and acts on each one.

Return ONLY a JSON object — no prose, no markdown code fences — with exactly these fields:
{
  "id": "local.<short-kebab-noun>",
  "name": "<short technical name>",
  "displayName": "<friendly name a non-developer reads>",
  "description": "<one sentence: what it does>",
  "tagline": "<one short pitch sentence>",
  "role": "producer" or "consumer",
  "itemType": "<dot.namespaced.type, e.g. local.standup.note>",
  "cron": "<standard 5-field cron expression>",
  "prompt": "<the system prompt the worker's model will run on each scheduled turn>"
}

Rules:
- Choose "producer" unless the user clearly wants to react to items that already exist.
- "prompt" must be self-contained and specific to the described task — it is the worker's brain.
- "cron" must be a valid 5-field expression (default to "0 9 * * *" for a daily morning run).`;

export async function requestWorkerSpec(
  model: (typeof availableModels)[number],
  description: string,
  corrective?: string,
): Promise<string> {
  const result = await generateText({
    model: getChatModel(model) as Parameters<typeof generateText>[0]['model'],
    system: WORKER_SPEC_SYSTEM_PROMPT,
    prompt:
      '/no_think\n' +
      (corrective ? corrective + '\n\n' : '') +
      'User description of the worker they want:\n' +
      description,
  });
  return result.text ?? '';
}

/** Append a numeric suffix until the worker id collides with neither a local nor a built-in worker. */
export async function ensureUniqueWorkerId(spec: WorkerScaffoldSpec): Promise<WorkerScaffoldSpec> {
  const localIds = new Set((await discoverLocalWorkers()).map((w) => w.manifest.id));
  const builtInIds = new Set(builtInWorkers.map((w) => w.id));
  const taken = (id: string) => localIds.has(id) || builtInIds.has(id);
  if (!taken(spec.id)) return spec;
  for (let n = 2; n < 100; n += 1) {
    const candidate = normalizeScaffoldSpec({ ...spec, id: `${spec.id}-${n}` });
    if (!taken(candidate.id)) return candidate;
  }
  throw new BadRequestError('Could not find a free worker id — too many similarly-named workers installed.');
}

export async function generateWorkerFromDescription(
  description: string,
): Promise<{ spec: WorkerScaffoldSpec; enabled: boolean; note?: string }> {
  // Code generation needs a capable model; the always-on demo provider is too weak to emit
  // reliable structured JSON, and a broken spec is the opposite of the "wow" this feature exists for.
  const realModels = availableModels.filter((m) => m.provider !== 'demo');
  if (realModels.length === 0) {
    throw new BadRequestError(
      'Creating a worker from a description needs a real model. Connect LM Studio or Ollama, ' +
        'or add a cloud API key in the Models tab, then try again.',
    );
  }
  const preferred = getDefaultModel();
  const model = preferred && preferred.provider !== 'demo' ? preferred : realModels[0];

  // Parse the model's JSON into a validated, normalized spec, with one corrective retry.
  let spec: WorkerScaffoldSpec | null = null;
  let lastError = '';
  for (let attempt = 0; attempt < 2 && !spec; attempt += 1) {
    const corrective = attempt === 0 ? undefined : `Your previous reply could not be parsed (${lastError}). Reply with ONLY the JSON object.`;
    try {
      const raw = await requestWorkerSpec(model, description, corrective);
      spec = specFromModelOutput(raw);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      spec = null;
    }
  }
  if (!spec) {
    throw new BadRequestError(`The model did not return a usable worker spec (${lastError}). Try rephrasing your description.`);
  }

  spec = await ensureUniqueWorkerId(spec);

  const installRoot = path.resolve(config.workerPaths[0] || './workers/local');
  const targetDir = path.join(installRoot, workerSlug(spec.id));
  if (!isPathInside(installRoot, targetDir) || targetDir === installRoot) {
    throw new BadRequestError('Invalid worker install path.');
  }

  await fs.mkdir(targetDir, { recursive: true });
  try {
    await writeWorkerScaffold(targetDir, spec);
    const discovered = (await discoverLocalWorkers([targetDir])).find((w) => w.manifest.id === spec.id);
    if (!discovered) {
      throw new Error('Generated worker could not be discovered after writing.');
    }
    await rememberSeenWorkers([{ id: spec.id, builtIn: false, sourcePath: discovered.sourcePath }]);

    // Enable + register it live so the user sees a running worker, not just files on disk.
    if (!config.localWorkerCodeEnabled) {
      return {
        spec,
        enabled: false,
        note: 'Worker created. Turn on "Allow local worker code" in Platform & Security, then enable it from the Workers tab.',
      };
    }
    try {
      await activateLocalWorker(discovered, { previousVersion: null });
      await setWorkerEnabled(spec.id, true, { builtIn: false, sourcePath: discovered.sourcePath });
      await reloadSchedulerSchedules();
      return { spec, enabled: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        spec,
        enabled: false,
        note: `Worker created but could not be enabled automatically: ${message}. Enable it from the Workers tab.`,
      };
    }
  } catch (err) {
    await fs.rm(targetDir, { recursive: true, force: true });
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError(`Worker generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Download a worker package from the community store, verify its SHA-256 hash,
 * extract the tarball, and install it into `workers/local/<id>/`.
 */
export async function installWorkerFromStore(
  workerId: string,
  bundleUrl: string,
  expectedSha256: string,
): Promise<DiscoveredLocalWorker> {
  const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;

  // Validate the worker id before touching the filesystem.
  const safeId = safeWorkerFolderName(workerId);
  if (!safeId) throw new BadRequestError('Invalid worker id.');

  const installRoot = path.resolve(config.workerPaths[0] || './workers/local');
  const targetDir = path.join(installRoot, safeId);
  if (!isPathInside(installRoot, targetDir) || targetDir === installRoot) {
    throw new BadRequestError('Invalid worker install path.');
  }

  if (await pathExists(targetDir)) {
    throw new BadRequestError(`Worker "${workerId}" is already installed.`);
  }

  // Download the bundle.
  let response: Response;
  try {
    response = await fetch(bundleUrl, { signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new BadRequestError(`Could not download worker bundle: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new BadRequestError(`Bundle download failed: HTTP ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  if (body.length === 0) throw new BadRequestError('Downloaded bundle is empty.');
  if (body.length > MAX_BUNDLE_BYTES) throw new BadRequestError('Bundle exceeds 25 MB limit.');

  // Verify SHA-256.
  const actualHash = createHash('sha256').update(body).digest('hex');
  if (actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new BadRequestError(`Bundle SHA-256 mismatch. Expected ${expectedSha256}, got ${actualHash}.`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bfrost-store-install-'));
  try {
    const archivePath = path.join(tempRoot, 'bundle.tar.gz');
    const extractDir = path.join(tempRoot, 'extract');

    await fs.writeFile(archivePath, body);
    await fs.mkdir(extractDir, { recursive: true });

    // Extract with system tar, rejecting traversal and symlink entries first.
    try {
      await safeExtractTarGz(archivePath, extractDir);
    } catch (err) {
      if (err instanceof BadRequestError) throw err;
      throw new BadRequestError(`Failed to extract bundle: ${err instanceof Error ? (err as any).stderr || err.message : String(err)}`);
    }

    const result = await discoverLocalWorkerResult([extractDir]);
    if (result.workers.length !== 1) {
      const detail = result.issues[0]?.message ?? 'Bundle must contain exactly one worker manifest.';
      throw new BadRequestError(detail);
    }

    const worker = result.workers[0];
    if (worker.manifest.id !== workerId) {
      throw new BadRequestError(
        `Bundle contains worker id "${worker.manifest.id}" but expected "${workerId}".`,
      );
    }

    const existing = workerCatalog(await discoverLocalWorkers()).get(worker.manifest.id);
    if (existing) {
      throw new BadRequestError(`Worker "${worker.manifest.id}" is already installed.`);
    }

    const workerDir = path.dirname(path.resolve(worker.sourcePath));
    if (!isPathInside(extractDir, workerDir)) {
      throw new BadRequestError('Worker manifest must stay inside the bundle contents.');
    }

    await fs.mkdir(installRoot, { recursive: true });
    await moveDirectory(workerDir, targetDir);

    const installed = await discoverLocalWorkers([targetDir]);
    const found = installed.find((item) => item.manifest.id === workerId);
    if (!found) {
      throw new BadRequestError('Worker could not be discovered after installation.');
    }
    await rememberSeenWorkers([{ id: found.manifest.id, builtIn: false, sourcePath: found.sourcePath }]);
    return found;
  } catch (err) {
    await fs.rm(targetDir, { recursive: true, force: true });
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError(`Store install failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function serveWorkerDashboardBundle(
  workerId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const localWorkers = await discoverLocalWorkers();
  const worker = localWorkers.find((entry) => entry.manifest.id === workerId);
  if (!worker || !(worker.dashboardEntrypoint || worker.dashboardSource)) {
    return sendJson(res, 404, { error: 'Worker has no dashboard bundle.' });
  }

  const workerDir = path.dirname(path.resolve(worker.sourcePath));
  const entrypoint = worker.dashboardEntrypoint ?? path.join('dist', 'dashboard.js');

  if (worker.dashboardSource) {
    try {
      await compileLocalWorkerDashboard({
        workerDir,
        source: worker.dashboardSource,
        output: entrypoint,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return sendJson(res, 500, { error: `Dashboard bundle compile failed: ${message}` });
    }
  }

  const bundlePath = path.resolve(workerDir, entrypoint);
  let stat;
  try {
    stat = await fs.stat(bundlePath);
  } catch {
    return sendJson(res, 404, { error: 'Dashboard bundle not found on disk.' });
  }

  // ETag derived from the compiled bundle's mtime — invalidates whenever esbuild
  // re-runs, so the browser stops serving a stale cached IIFE the moment a worker
  // author edits and reloads.
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  const body = await fs.readFile(bundlePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Length', String(body.length));
  res.end(body);
}

export async function deleteLocalWorkerFiles(sourcePath: string): Promise<void> {
  const resolvedSource = path.resolve(sourcePath);
  const workerDir = path.dirname(resolvedSource);
  const roots = config.workerPaths.map((workerPath) => path.resolve(workerPath));
  const owningRoot = roots.find((root) => resolvedSource === root || isPathInside(root, resolvedSource));

  if (!owningRoot) {
    throw new BadRequestError('Local worker files are outside configured worker paths.');
  }

  if (workerDir === owningRoot) {
    await fs.rm(resolvedSource, { force: true });
    return;
  }

  if (!isPathInside(owningRoot, workerDir)) {
    throw new BadRequestError('Refusing to delete a path outside the configured worker directory.');
  }

  await fs.rm(workerDir, { recursive: true, force: true });
}

/**
 * Reject archive entry names that could escape the extraction directory: absolute paths
 * (`/etc/...`, `C:\...`) and parent-directory traversal (`../`). Run on the archive *listing*
 * before extraction so nothing dangerous is ever written to disk (zip-slip / tar-slip).
 */
export function assertSafeArchiveNames(names: string[]): void {
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const normalized = name.replace(/\\/g, '/');
    if (path.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized)) {
      throw new BadRequestError(`Archive contains an absolute path, which is not allowed: ${name}`);
    }
    if (normalized.split('/').some((segment) => segment === '..')) {
      throw new BadRequestError(`Archive contains a path-traversal entry, which is not allowed: ${name}`);
    }
  }
}

/**
 * Reject symlink entries in a verbose archive listing. A symlink whose target is absolute or
 * traverses upward lets a *later* entry be written through it to land outside the temp dir —
 * a name-only scan misses this because the symlink's own name is innocuous. Worker payloads
 * never legitimately contain symlinks. Both `tar -tvzf` and `unzip -Z` start each entry line
 * with a type/permission string whose first character is `l` for a symlink.
 */
export function assertNoSymlinkEntries(verboseListingLines: string[]): void {
  for (const line of verboseListingLines) {
    if (/^l/.test(line.trimStart())) {
      throw new BadRequestError('Archive contains a symbolic link, which is not allowed.');
    }
  }
}

/** Belt-and-suspenders: walk the extracted tree and reject if any entry is a symlink. */
export async function assertNoSymlinksOnDisk(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new BadRequestError(`Extracted archive contains a symbolic link, which is not allowed: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      await assertNoSymlinksOnDisk(path.join(dir, entry.name));
    }
  }
}

/** Safely extract a zip into `destDir`: vet entry names + symlinks before writing, walk after. */
export async function safeExtractZip(zipPath: string, destDir: string): Promise<void> {
  const { stdout: names } = await execFileAsync('unzip', ['-Z1', zipPath]);
  assertSafeArchiveNames(names.split('\n'));
  const { stdout: verbose } = await execFileAsync('unzip', ['-Z', zipPath]);
  assertNoSymlinkEntries(verbose.split('\n'));
  await execFileAsync('unzip', ['-q', zipPath, '-d', destDir]);
  await assertNoSymlinksOnDisk(destDir);
}

/** Safely extract a .tar.gz into `destDir`: vet entry names + symlinks before writing, walk after. */
export async function safeExtractTarGz(archivePath: string, destDir: string): Promise<void> {
  const { stdout: names } = await execFileAsync('tar', ['-tzf', archivePath]);
  assertSafeArchiveNames(names.split('\n'));
  const { stdout: verbose } = await execFileAsync('tar', ['-tvzf', archivePath]);
  assertNoSymlinkEntries(verbose.split('\n'));
  await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir]);
  await assertNoSymlinksOnDisk(destDir);
}

export async function moveDirectory(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw err;
    }
    await fs.cp(source, target, { recursive: true, errorOnExist: true });
    await fs.rm(source, { recursive: true, force: true });
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function safeWorkerFolderName(value: string): string {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe || `worker-${Date.now()}`;
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
