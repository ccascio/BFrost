import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import type { WorkerManifest } from './types';

export const LOCAL_WORKER_MANIFEST_VERSION = 1;
export const BFROST_WORKER_API_VERSION = '0.1';

const HealthRequirementSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  settingsTarget: z.string().optional(),
}).strict();

const OwnedSettingSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  scope: z.enum(['job', 'worker', 'global']),
  storageKey: z.string().min(1),
  dashboardTarget: z.string().optional(),
}).strict();

const DashboardFieldSchema = z.discriminatedUnion('type', [
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('text'),
    defaultValue: z.string(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('textarea'),
    defaultValue: z.string(),
    rows: z.number().optional(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('number'),
    defaultValue: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('boolean'),
    defaultValue: z.boolean(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('select'),
    defaultValue: z.string(),
    options: z.array(z.object({
      label: z.string().min(1),
      value: z.string(),
    }).strict()),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('string-list'),
    defaultValue: z.array(z.string()),
    rows: z.number().optional(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.literal('secret-reference'),
    defaultValue: z.string(),
    placeholder: z.string().optional(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
]);

const DashboardSurfaceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  path: z.string().optional(),
  tab: z.string().optional(),
  fields: z.array(DashboardFieldSchema).optional(),
}).strict();

const DashboardManifestSchema = z.object({
  settings: z.array(DashboardSurfaceSchema).optional(),
  routes: z.array(DashboardSurfaceSchema).optional(),
}).strict();

const LocalWorkerManifestSchema = z.object({
  manifestVersion: z.number().int().positive().optional(),
  bfrostApiVersion: z.string().optional(),
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  owner: z.string().optional(),
  kind: z.enum(['feature', 'channel', 'provider']).optional(),
  /** Language the backend is authored in. Defaults to "javascript". */
  language: z.enum(['javascript', 'typescript']).optional(),
  /** Path to the compiled JS entrypoint, relative to worker.json. Required when backend code is present. */
  backendEntrypoint: z.string().min(1).optional(),
  /** Path to the TS source entrypoint when language === 'typescript'. BFrost compiles it to backendEntrypoint at install/load time. */
  backendSource: z.string().min(1).optional(),
  /** Compiled JS bundle (IIFE) for the dashboard UI, relative to worker.json. Loaded at runtime via a <script> tag. */
  dashboardEntrypoint: z.string().min(1).optional(),
  /** TS/TSX source for the dashboard UI. BFrost bundles it to dashboardEntrypoint with esbuild on install/load. */
  dashboardSource: z.string().min(1).optional(),
  requiredCredentials: z.array(HealthRequirementSchema).optional(),
  optionalCredentials: z.array(HealthRequirementSchema).optional(),
  requiredDependencies: z.array(HealthRequirementSchema).optional(),
  optionalDependencies: z.array(HealthRequirementSchema).optional(),
  ownedSettings: z.array(OwnedSettingSchema).optional(),
  dashboard: DashboardManifestSchema.optional(),
}).strict();

export type LocalWorkerManifest = z.infer<typeof LocalWorkerManifestSchema>;

export interface DiscoveredLocalWorker {
  manifest: WorkerManifest;
  sourcePath: string;
  /** Backend authoring language as declared on the local manifest. */
  language?: 'javascript' | 'typescript';
  /** Compiled JS entrypoint (relative to worker.json) the loader should require(). */
  backendEntrypoint?: string;
  /** TS source entrypoint, used to compile to `backendEntrypoint` for typescript workers. */
  backendSource?: string;
  /** Compiled IIFE bundle the dashboard loads at runtime. */
  dashboardEntrypoint?: string;
  /** TS/TSX source for the dashboard, bundled to `dashboardEntrypoint` at install/load. */
  dashboardSource?: string;
}

export interface LocalWorkerLoadIssue {
  sourcePath: string;
  message: string;
}

export interface LocalWorkerDiscoveryResult {
  workers: DiscoveredLocalWorker[];
  issues: LocalWorkerLoadIssue[];
}

export async function discoverLocalWorkerResult(workerPaths = config.workerPaths): Promise<LocalWorkerDiscoveryResult> {
  const discovered = new Map<string, DiscoveredLocalWorker>();
  const issues: LocalWorkerLoadIssue[] = [];

  for (const workerPath of workerPaths) {
    const candidates = await listManifestCandidates(workerPath);
    for (const candidate of candidates) {
      const result = await readLocalWorker(candidate);
      if (!result.worker) {
        if (result.issue) {
          issues.push(result.issue);
        }
        continue;
      }
      if (!discovered.has(result.worker.manifest.id)) {
        discovered.set(result.worker.manifest.id, result.worker);
      }
    }
  }

  return { workers: Array.from(discovered.values()), issues };
}

export async function discoverLocalWorkers(workerPaths = config.workerPaths): Promise<DiscoveredLocalWorker[]> {
  return (await discoverLocalWorkerResult(workerPaths)).workers;
}

async function listManifestCandidates(workerPath: string): Promise<string[]> {
  try {
    const stat = await fs.stat(workerPath);
    if (stat.isFile()) {
      return workerPath.endsWith('.json') ? [workerPath] : [];
    }
    if (!stat.isDirectory()) {
      return [];
    }

    const direct = path.join(workerPath, 'worker.json');
    const entries = await fs.readdir(workerPath, { withFileTypes: true });
    const nested = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(workerPath, entry.name, 'worker.json'));
    return [direct, ...nested];
  } catch {
    return [];
  }
}

async function readLocalWorker(
  manifestPath: string,
): Promise<{ worker: DiscoveredLocalWorker | null; issue?: LocalWorkerLoadIssue }> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = LocalWorkerManifestSchema.parse(JSON.parse(raw));
    const manifestVersion = parsed.manifestVersion ?? LOCAL_WORKER_MANIFEST_VERSION;
    const apiVersion = parsed.bfrostApiVersion ?? BFROST_WORKER_API_VERSION;
    if (manifestVersion !== LOCAL_WORKER_MANIFEST_VERSION) {
      return {
        worker: null,
        issue: {
          sourcePath: manifestPath,
          message: `Unsupported manifestVersion ${manifestVersion}; expected ${LOCAL_WORKER_MANIFEST_VERSION}.`,
        },
      };
    }
    if (apiVersion !== BFROST_WORKER_API_VERSION) {
      return {
        worker: null,
        issue: {
          sourcePath: manifestPath,
          message: `Unsupported bfrostApiVersion ${apiVersion}; expected ${BFROST_WORKER_API_VERSION}.`,
        },
      };
    }
    if (parsed.backendEntrypoint) {
      validateBackendEntrypoint(manifestPath, parsed.backendEntrypoint);
    }
    const language = parsed.language ?? (parsed.backendSource ? 'typescript' : 'javascript');
    if (language === 'typescript' && !parsed.backendSource) {
      return {
        worker: null,
        issue: {
          sourcePath: manifestPath,
          message: 'language: "typescript" requires backendSource to be set.',
        },
      };
    }
    if (parsed.backendSource) {
      validateRelativePath(manifestPath, parsed.backendSource, ['.ts', '.tsx', '.mts', '.cts']);
    }
    if (parsed.dashboardEntrypoint) {
      validateRelativePath(manifestPath, parsed.dashboardEntrypoint, ['.js', '.mjs']);
    }
    if (parsed.dashboardSource) {
      validateRelativePath(manifestPath, parsed.dashboardSource, ['.ts', '.tsx', '.mts']);
    }
    return {
      worker: {
        sourcePath: manifestPath,
        language,
        backendEntrypoint: parsed.backendEntrypoint,
        backendSource: parsed.backendSource,
        dashboardEntrypoint: parsed.dashboardEntrypoint,
        dashboardSource: parsed.dashboardSource,
        manifest: {
          ...parsed,
          builtIn: false,
          jobs: [],
        },
      },
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[Workers] Failed to load local worker manifest at ${manifestPath}:`, err);
      return {
        worker: null,
        issue: {
          sourcePath: manifestPath,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
    return { worker: null };
  }
}

function validateBackendEntrypoint(manifestPath: string, entrypoint: string): void {
  validateRelativePath(manifestPath, entrypoint, ['.js', '.cjs', '.mjs']);
}

function validateRelativePath(manifestPath: string, relative: string, allowedExtensions: string[]): void {
  if (path.isAbsolute(relative)) {
    throw new Error(`${relative}: worker paths must be relative to worker.json.`);
  }
  if (!allowedExtensions.some((ext) => relative.endsWith(ext))) {
    throw new Error(`${relative}: must end with one of ${allowedExtensions.join(', ')}.`);
  }
  const workerDir = path.dirname(path.resolve(manifestPath));
  const resolved = path.resolve(workerDir, relative);
  const rel = path.relative(workerDir, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`${relative}: must stay inside the worker directory.`);
  }
}
