/**
 * Compile-on-install support for local workers authored in TypeScript.
 *
 * Workers may ship either:
 *   - pre-built JavaScript at `manifest.backendEntrypoint` (default contract), or
 *   - TypeScript source at `manifest.backendSource` plus a `language: "typescript"` flag.
 *
 * For TS workers, BFrost bundles the source with esbuild on install / on first load and
 * writes the result to a BFrost-managed `<worker>/dist/index.js`. The compiled JS is what
 * actually runs at runtime — BFrost never executes TS source directly.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { build, type Plugin as EsbuildWorker } from 'esbuild';

/**
 * The host BFrost installation's node_modules. Worker source may import third-party packages the
 * host already ships (e.g. `ai`, `zod`) and expect them to bundle in. When a worker lives outside
 * the repo — under `~/.bfrost/workers/local` for an `npx bfrost` install, or any store/CLI install
 * — there is no adjacent node_modules for esbuild to walk up to. Adding the host's node_modules to
 * the resolution path (NODE_PATH-style) lets those bare imports resolve to the host's copy, exactly
 * as they would when the worker is developed inside the repo. The `bfrost` runtime and node built-ins
 * stay external; everything else bundles into the worker's single output file.
 */
const HOST_NODE_MODULES = path.resolve(__dirname, '..', '..', 'node_modules');

export interface CompileLocalWorkerInput {
  workerDir: string;
  source: string;
  output: string;
}

export interface CompileLocalWorkerResult {
  outputPath: string;
  compiled: boolean;
  reason: 'compiled' | 'cached' | 'no-source';
}

/**
 * Compile a local worker's TypeScript source into a bundled JS file the runtime can require().
 *
 * Idempotent: skips work when the output file's mtime is newer than the newest source file's mtime.
 * Walks the worker source directory rather than checking only the entry point, so changes to
 * any imported module (e.g. job.ts) trigger a rebuild without requiring a touch on index.ts.
 */
export async function compileLocalWorker(input: CompileLocalWorkerInput): Promise<CompileLocalWorkerResult> {
  const sourcePath = path.resolve(input.workerDir, input.source);
  const outputPath = path.resolve(input.workerDir, input.output);

  try {
    await fs.stat(sourcePath);
  } catch {
    return { outputPath, compiled: false, reason: 'no-source' };
  }

  const newestSourceMs = await newestMtimeMs(path.dirname(sourcePath));

  try {
    const outStat = await fs.stat(outputPath);
    if (outStat.mtimeMs >= newestSourceMs) {
      return { outputPath, compiled: false, reason: 'cached' };
    }
  } catch {
    // output missing — fall through and build
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await build({
    entryPoints: [sourcePath],
    outfile: outputPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    sourcemap: 'inline',
    logLevel: 'silent',
    // Workers consume BFrost runtime types via peer imports rather than bundling them.
    // Keep node built-ins and the BFrost runtime module external so the host process owns
    // those singletons. Node modules unrelated to BFrost bundle in normally.
    external: ['bfrost', 'node:*'],
    // Resolve bare imports (e.g. `ai`, `zod`) against the host install when the worker lives
    // outside the repo and has no adjacent node_modules.
    nodePaths: [HOST_NODE_MODULES],
  });

  return { outputPath, compiled: true, reason: 'compiled' };
}

export interface CompileLocalWorkerDashboardInput {
  workerDir: string;
  source: string;
  output: string;
}

/**
 * Compile a local worker's dashboard UI source (TSX/TS) into a browser IIFE bundle.
 *
 * The host page exposes React + ReactDOM + tiny registration helpers as `window.bfrost`
 * — see `web/src/App.tsx`. We resolve `react`, `react-dom`, `react/jsx-runtime`, and
 * `react/jsx-dev-runtime` to that global so every worker uses the host's React instance
 * (a duplicate React would silently break hooks).
 */
export async function compileLocalWorkerDashboard(input: CompileLocalWorkerDashboardInput): Promise<CompileLocalWorkerResult> {
  const sourcePath = path.resolve(input.workerDir, input.source);
  const outputPath = path.resolve(input.workerDir, input.output);

  try {
    await fs.stat(sourcePath);
  } catch {
    return { outputPath, compiled: false, reason: 'no-source' };
  }

  // Dashboard source is typically a single file; check the worker root dir to catch co-located helpers.
  const newestSourceMs = await newestMtimeMs(path.dirname(sourcePath));

  try {
    const outStat = await fs.stat(outputPath);
    if (outStat.mtimeMs >= newestSourceMs) {
      return { outputPath, compiled: false, reason: 'cached' };
    }
  } catch {
    // missing — fall through
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await build({
    entryPoints: [sourcePath],
    outfile: outputPath,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    jsx: 'automatic',
    sourcemap: 'inline',
    logLevel: 'silent',
    plugins: [reactGlobalsWorker()],
    nodePaths: [HOST_NODE_MODULES],
  });

  return { outputPath, compiled: true, reason: 'compiled' };
}

function reactGlobalsWorker(): EsbuildWorker {
  const aliases: Record<string, string> = {
    'react': 'window.bfrost.React',
    'react-dom': 'window.bfrost.ReactDOM',
    'react/jsx-runtime': 'window.bfrost.jsxRuntime',
    'react/jsx-dev-runtime': 'window.bfrost.jsxRuntime',
  };
  return {
    name: 'bfrost-react-globals',
    setup(build) {
      const filter = new RegExp(`^(${Object.keys(aliases).map(escapeRegex).join('|')})$`);
      build.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'bfrost-react' }));
      build.onLoad({ filter: /.*/, namespace: 'bfrost-react' }, (args) => {
        const target = aliases[args.path];
        return { contents: `module.exports = ${target};`, loader: 'js' };
      });
    },
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Return the newest mtime (ms) across all files directly inside `dir` (non-recursive). */
async function newestMtimeMs(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    let newest = 0;
    for (const e of entries) {
      if (!e.isFile()) continue;
      try {
        const s = await fs.stat(path.join(dir, e.name));
        if (s.mtimeMs > newest) newest = s.mtimeMs;
      } catch {
        // ignore unreadable entries
      }
    }
    return newest;
  } catch {
    return 0;
  }
}
