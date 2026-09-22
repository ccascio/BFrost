/**
 * Start the server in the background.
 *
 * - If an OS service is installed for THIS project, delegate to the service manager.
 * - Otherwise sweep away any existing instance of this project's server — whether it's
 *   bound to the admin port, still starting up, or a stray manually-launched process —
 *   then spawn a fresh detached server runner. See scripts/process-lock.mjs.
 * - Writes stdout/stderr through a bounded rotating project log.
 *
 * Service identity (label, log path, port) is per-project — see scripts/service-config.mjs.
 *
 * Usage: npm start   (or: node scripts/daemon.mjs)
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { DEFAULT_MAX_LOG_BYTES, DEFAULT_LOG_ROTATIONS } from './logging.mjs';
import { service } from './service-config.mjs';
import { stopAllServerInstances } from './process-lock.mjs';

const { ROOT, ENTRY, REGISTRY, RUNNER, LOG_FILE, PORT, PLIST_PATH, SYSTEMD_UNIT, DISPLAY } = service;

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

if (!existsSync(ENTRY) || !existsSync(REGISTRY)) {
  console.error('Error: build is missing or incomplete. Run: npm run build');
  process.exit(1);
}

// BFrost's Memory/Documents workers use the local embedding endpoint. On Windows,
// prepare LM Studio before the backend starts so a normal `npm start` cannot forget
// the required runtime/model. Set BFROST_START_LMSTUDIO=false for an intentional
// one-off start without the local runtime.
if (process.platform === 'win32' && process.env.BFROST_START_LMSTUDIO !== 'false') {
  console.log('[BFrost] Preparing LM Studio and required local models...');
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'start-lmstudio-windows.mjs')], {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
  } catch {
    console.error('[BFrost] LM Studio startup failed; BFrost was not started.');
    console.error('[BFrost] Fix LM Studio or set BFROST_START_LMSTUDIO=false for an intentional bypass.');
    process.exit(1);
  }
}

// If an OS service is installed, delegate to the service manager instead of
// spawning a bare detached process — otherwise we'd fight with KeepAlive.
if (process.platform === 'darwin') {
  if (existsSync(PLIST_PATH)) {
    try { execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' }); } catch { /* not loaded */ }
    execFileSync('launchctl', ['load', PLIST_PATH], { stdio: 'inherit' });
    console.log(`${DISPLAY} service restarted (launchd).`);
    console.log(`  Dashboard: http://127.0.0.1:${PORT}`);
    console.log(`  Logs:      ${LOG_FILE}  (npm run logs)`);
    process.exit(0);
  }
} else if (process.platform === 'linux') {
  try {
    execFileSync('systemctl', ['--user', 'is-enabled', SYSTEMD_UNIT], { stdio: 'ignore' });
    execFileSync('systemctl', ['--user', 'restart', SYSTEMD_UNIT], { stdio: 'inherit' });
    console.log(`${DISPLAY} service restarted (systemd).`);
    console.log(`  Dashboard: http://127.0.0.1:${PORT}`);
    console.log(`  Logs:      ${LOG_FILE}  (npm run logs)`);
    process.exit(0);
  } catch { /* service not installed — fall through to detached spawn */ }
}

const stoppedPids = stopAllServerInstances({ ENTRY, RUNNER, PORT });
if (stoppedPids.length) {
  console.log(`Stopping existing ${DISPLAY} instance(s) (PID ${stoppedPids.join(', ')})...`);
}

mkdirSync(path.dirname(LOG_FILE), { recursive: true });

const child = spawn(process.execPath, [RUNNER], {
  detached: true,
  stdio: 'ignore',
  cwd: ROOT,
  env: process.env,
  windowsHide: true,
});

child.unref();

console.log(`${DISPLAY} started in background (PID ${child.pid})`);
console.log(`  Dashboard: http://127.0.0.1:${PORT}`);
console.log(`  Logs:      ${LOG_FILE} (rotates at ${DEFAULT_MAX_LOG_BYTES} bytes, keeps ${DEFAULT_LOG_ROTATIONS})`);
console.log(`  Stop:      npm stop`);
