// Bundles and runs the frontend render smoke (web/src/__smoke__/render-smoke.tsx)
// in Node. esbuild handles JSX + the import graph; react-dom/server renders without
// a DOM. Exits non-zero if any component throws during render. See CODE_ROADMAP 1.2.
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'bfrost-web-smoke-'));
// CJS so react-dom/server.node's internal require('util') resolves natively
// (an ESM bundle turns those into an unsupported dynamic require).
const outfile = join(dir, 'smoke.cjs');

try {
  await build({
    entryPoints: ['web/src/__smoke__/render-smoke.tsx'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    outfile,
    logLevel: 'error',
    // Stylesheet imports anywhere in the graph are irrelevant to a render smoke.
    loader: { '.css': 'empty' },
  });

  const mod = await import(pathToFileURL(outfile).href);
  const results = mod.runSmoke();
  const failures = results.filter((r) => !r.ok);

  for (const r of results) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `  — ${r.error}`}`);
  }

  if (failures.length > 0) {
    console.error(`\n[web-smoke] ${failures.length}/${results.length} component(s) failed to render.`);
    process.exitCode = 1;
  } else {
    console.log(`\n[web-smoke] ${results.length} components rendered cleanly.`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
