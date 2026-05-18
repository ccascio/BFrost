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
 * Idempotent: skips work when the output file's mtime is newer than the source's mtime.
 */
export async function compileLocalWorker(input: CompileLocalWorkerInput): Promise<CompileLocalWorkerResult> {
  const sourcePath = path.resolve(input.workerDir, input.source);
  const outputPath = path.resolve(input.workerDir, input.output);

  let sourceStat;
  try {
    sourceStat = await fs.stat(sourcePath);
  } catch {
    return { outputPath, compiled: false, reason: 'no-source' };
  }

  try {
    const outStat = await fs.stat(outputPath);
    if (outStat.mtimeMs >= sourceStat.mtimeMs) {
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

  let sourceStat;
  try {
    sourceStat = await fs.stat(sourcePath);
  } catch {
    return { outputPath, compiled: false, reason: 'no-source' };
  }

  try {
    const outStat = await fs.stat(outputPath);
    if (outStat.mtimeMs >= sourceStat.mtimeMs) {
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
