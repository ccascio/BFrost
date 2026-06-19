/**
 * Synthetic `bfrost` runtime module registration.
 *
 * Local workers are bundled with esbuild and the string literal `bfrost` is marked
 * external — so the compiled JS contains a literal `require('bfrost')` (CommonJS form
 * because we target node20/cjs). This module installs two hooks before any worker is
 * loaded:
 *   1. `Module._resolveFilename` intercepts the `bfrost` request and returns a stable
 *      sentinel filename.
 *   2. `require.cache[<sentinel>]` is pre-populated with a module record whose
 *      `exports` is the SDK surface.
 *
 * Subsequent `require('bfrost')` calls anywhere in the process (built-in workers,
 * local workers, tests) resolve to the same `bfrostSdk` object — the host owns the
 * singletons and the worker gets a frozen view.
 *
 * Idempotent: calling `registerBfrostRuntimeModule()` twice is a no-op.
 */
import Module from 'node:module';
import { bfrostSdk } from './sdk';

const VIRTUAL_FILENAME = '__bfrost_runtime_sdk__';

let registered = false;

export function registerBfrostRuntimeModule(): void {
  if (registered) return;
  registered = true;

  const cache = (require as NodeRequire & { cache: NodeJS.Dict<NodeJS.Module> }).cache;

  // Mint a Module record that looks loaded so Node serves the cached exports as-is
  // instead of trying to read the (nonexistent) file off disk.
  const virtualModule = new Module(VIRTUAL_FILENAME) as NodeJS.Module;
  virtualModule.filename = VIRTUAL_FILENAME;
  virtualModule.loaded = true;
  virtualModule.exports = bfrostSdk;
  cache[VIRTUAL_FILENAME] = virtualModule;

  const ModuleResolver = Module as typeof Module & {
    _resolveFilename: (request: string, parent: NodeJS.Module | null, ...rest: unknown[]) => string;
  };
  const originalResolveFilename = ModuleResolver._resolveFilename;
  ModuleResolver._resolveFilename = function (
    request: string,
    parent: NodeJS.Module | null,
    ...rest: unknown[]
  ): string {
    if (request === 'bfrost') return VIRTUAL_FILENAME;
    return originalResolveFilename.call(this, request, parent, ...rest);
  };
}
