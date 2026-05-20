import { readdirSync, statSync } from 'fs';
import path from 'path';
import type { BackendWorkerModule } from '../module';
import type { WorkerManifest } from '../types';
import { validateBackendWorkerModules } from '../validation';

/**
 * Built-in workers are discovered the same way local workers are: by walking the filesystem.
 * No file in `src/workers/builtin/` other than each worker's own folder may reference a
 * specific worker. Adding or removing a built-in is a folder operation — no edit here, no
 * edit in core.
 *
 * Each `src/workers/builtin/<id>/module.ts` must export an object that matches the
 * `BackendWorkerModule` shape. The export can be the file's `default`, an export named
 * `module` or `workerModule`, or any other named export — the loader picks the first one
 * whose value carries a manifest with an `id`.
 */
function looksLikeBackendModule(value: unknown): value is BackendWorkerModule {
  if (!value || typeof value !== 'object') return false;
  const manifest = (value as { manifest?: unknown }).manifest;
  return (
    !!manifest &&
    typeof manifest === 'object' &&
    typeof (manifest as { id?: unknown }).id === 'string' &&
    typeof (manifest as { name?: unknown }).name === 'string' &&
    typeof (manifest as { version?: unknown }).version === 'string'
  );
}

function extractBackendModule(imported: unknown): BackendWorkerModule | null {
  if (!imported || typeof imported !== 'object') return null;
  const seen = new Set<unknown>();
  const candidates: unknown[] = [
    (imported as Record<string, unknown>).default,
    (imported as Record<string, unknown>).module,
    (imported as Record<string, unknown>).workerModule,
    imported,
    ...Object.values(imported as Record<string, unknown>),
  ];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (looksLikeBackendModule(candidate)) return candidate;
  }
  return null;
}

function discoverBuiltInModules(): BackendWorkerModule[] {
  const here = __dirname;
  const collected: BackendWorkerModule[] = [];
  const entries = readdirSync(here, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const moduleEntry = path.join(here, entry.name, 'module.js');
    try {
      statSync(moduleEntry);
    } catch {
      // A subdirectory without a module.js is allowed (e.g. assets); skip silently.
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imported = require(moduleEntry);
    const module = extractBackendModule(imported);
    if (!module) {
      throw new Error(
        `Built-in worker directory "${entry.name}" has a module.js that does not export a BackendWorkerModule. ` +
          `Export the module as \`default\`, \`module\`, \`workerModule\`, or any named export carrying a manifest.`,
      );
    }
    collected.push(module);
  }
  // Sort by manifest id so registration order is stable across filesystems.
  collected.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  return collected;
}

const modules = discoverBuiltInModules();

validateBackendWorkerModules(modules);

export const builtInWorkerModules: BackendWorkerModule[] = modules;

export const builtInWorkers: WorkerManifest[] = builtInWorkerModules.map((module) => module.manifest);
