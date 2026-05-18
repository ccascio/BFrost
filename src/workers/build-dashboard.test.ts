import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileLocalWorkerDashboard } from './build';

const DASHBOARD_TSX = `
import { useState } from 'react';

function View() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}

window.bfrost.registerDashboardView({
  workerId: 'local.example',
  kind: 'example',
  surfaceIds: ['main'],
  count: () => undefined,
  render: () => <View />,
});
`;

test('compileLocalWorkerDashboard bundles TSX into an IIFE referencing host globals', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-dashboard-bundle-'));
  try {
    await writeFile(path.join(dir, 'dashboard.tsx'), DASHBOARD_TSX);

    const result = await compileLocalWorkerDashboard({
      workerDir: dir,
      source: 'dashboard.tsx',
      output: 'dist/dashboard.js',
    });

    assert.equal(result.reason, 'compiled');
    const compiled = await readFile(result.outputPath, 'utf8');

    // No raw `require("react")` or import statements survive — everything must be
    // rewired through window.bfrost.* so the host's React instance owns hooks.
    assert.ok(compiled.includes('window.bfrost.React'), 'expected window.bfrost.React in bundle');
    assert.ok(compiled.includes('window.bfrost.jsxRuntime'), 'expected window.bfrost.jsxRuntime in bundle');
    assert.ok(!/from\s+["']react["']/.test(compiled), 'bundle must not retain unresolved react imports');
    assert.ok(compiled.includes('registerDashboardView'), 'bundle should call the registration helper');

    // Second call with no source change should be a cache hit.
    const second = await compileLocalWorkerDashboard({
      workerDir: dir,
      source: 'dashboard.tsx',
      output: 'dist/dashboard.js',
    });
    assert.equal(second.reason, 'cached');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
