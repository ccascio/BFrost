import { rmSync, existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

function resolveNodeModuleScript(packageName, scriptPath) {
  const candidate = path.join(process.cwd(), 'node_modules', packageName, scriptPath);
  if (!existsSync(candidate)) {
    throw new Error(`Missing script: ${candidate}`);
  }
  return candidate;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function removeDir(dirPath) {
  // maxRetries/retryDelay make Node retry EBUSY/ENOTEMPTY/EPERM with backoff.
  // Needed here because iCloud/Spotlight indexing on macOS can briefly repopulate
  // a directory mid-delete, failing a bare recursive rm with ENOTEMPTY.
  rmSync(dirPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function clean(serverOnly = false) {
  removeDir(path.resolve('dist'));
  if (!serverOnly) {
    removeDir(path.resolve('web/dist'));
  }
}

function findTestFiles(rootDir) {
  const results = [];
  const stack = [rootDir];

  while (stack.length) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;

    for (const entry of readdirSync(current)) {
      const entryPath = path.join(current, entry);
      const stat = statSync(entryPath);
      if (stat.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.endsWith('.test.js')) {
        results.push(entryPath);
      }
    }
  }

  return results.sort();
}

function buildServer() {
  clean(true);
  run(process.execPath, [resolveNodeModuleScript('typescript', 'bin/tsc')]);
}

function buildFull() {
  clean(false);
  buildServer();
  run(process.execPath, [resolveNodeModuleScript('vite', 'bin/vite.js'), 'build']);
}

/**
 * Is `candidate` the live `data/` directory or something inside it?
 *
 * Used to refuse a store path that would let a test write to the operator's real data,
 * however that path arrived — unset (and thus defaulting to `data/`) or inherited from the
 * shell.
 */
function isUnderLiveData(candidate) {
  const liveData = path.resolve(process.cwd(), 'data');
  const resolved = path.resolve(candidate);
  const relative = path.relative(liveData, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Point every store at a throwaway directory for the test run, **fail-closed**.
 *
 * The store paths, left unset, default to the live `data/` directory, and at least one
 * pre-existing test opens the database without redirecting it — so the runner is the one
 * place that can guarantee the live store is never touched. Two rules:
 *
 *  - **An unset variable is redirected** to a throwaway.
 *  - **A variable pointing at `data/` is refused outright** rather than preserved. Keeping
 *    an inherited `APP_DB_PATH=data/BFrost.sqlite` would contradict the guarantee this
 *    function exists to make. A deliberate sandbox path (anywhere else) is respected.
 */
function withThrowawayStoreEnv(fn) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'bfrost-test-stores-'));
  const defaults = {
    APP_DB_PATH: path.join(scratch, 'test.sqlite'),
    // Case-sensitive: `BFROST_ITEM_BUS_DIR` is a different variable and would fall back to
    // the live `data/item-bus` on a case-sensitive platform.
    BFROST_ITEM_BUS_DIR: path.join(scratch, 'item-bus'),
    ADMIN_STORE_DIR: path.join(scratch, 'admin'),
    MEMORY_STORE_PATH: path.join(scratch, 'memory.json'),
    CONVERSATION_STORE_PATH: path.join(scratch, 'conversations.json'),
  };

  // Fail-closed: refuse any inherited store path that points at the live data directory.
  const unsafe = Object.keys(defaults).filter((name) => process.env[name]?.trim() && isUnderLiveData(process.env[name]));
  if (unsafe.length > 0) {
    removeDir(scratch);
    console.error(
      `\n[test] REFUSED: ${unsafe.join(', ')} point at the live data/ directory:\n` +
      unsafe.map((name) => `  ${name}=${process.env[name]}`).join('\n') +
      `\n\nRunning the suite against the live store is not allowed. Unset these (the runner\n` +
      `will redirect them) or point them at a sandbox outside data/.\n`,
    );
    process.exit(1);
  }

  const applied = [];
  for (const [name, value] of Object.entries(defaults)) {
    if (!process.env[name]?.trim()) {
      process.env[name] = value;
      applied.push(name);
    }
  }
  if (applied.length > 0) {
    console.log(`[test] Redirected ${applied.join(', ')} to a throwaway directory so no test can touch the live store.`);
  }
  try {
    return fn();
  } finally {
    removeDir(scratch);
  }
}

function runTests() {
  clean(true);
  run(process.execPath, [resolveNodeModuleScript('typescript', 'bin/tsc')]);

  withThrowawayStoreEnv(() => {
    const testFiles = findTestFiles(path.resolve('dist'));
    if (testFiles.length > 0) {
      run(process.execPath, ['--test', ...testFiles]);
    }
  });

  run(process.execPath, [resolveNodeModuleScript('typescript', 'bin/tsc'), '--noEmit', '-p', 'web/tsconfig.json']);
}

const [command] = process.argv.slice(2);

switch (command) {
  case 'clean':
    clean(false);
    break;
  case 'clean:server':
    clean(true);
    break;
  case 'build:server':
    buildServer();
    break;
  case 'build':
    buildFull();
    break;
  case 'test':
    runTests();
    break;
  default:
    console.error('Usage: node scripts/cross-platform.mjs <clean|clean:server|build|build:server|test>');
    process.exit(1);
}
