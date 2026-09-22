/**
 * Stop the background instance.
 *
 * If an OS service is installed for THIS project, stop it via the service manager so
 * KeepAlive doesn't immediately restart it. Otherwise sweep away every running instance
 * of this project's server — port-bound or not — via scripts/process-lock.mjs.
 *
 * Service identity is per-project — see scripts/service-config.mjs.
 *
 * Usage: npm stop   (or: node scripts/stop.mjs)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { service } from './service-config.mjs';
import { stopAllServerInstances } from './process-lock.mjs';

const { ENTRY, RUNNER, PORT, PLIST_PATH, SYSTEMD_UNIT, DISPLAY } = service;

// If an OS service is installed, stop via the service manager so KeepAlive
// doesn't immediately restart the process we just killed.
if (process.platform === 'darwin') {
  if (existsSync(PLIST_PATH)) {
    try {
      execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
      console.log(`${DISPLAY} service stopped (launchd). Run npm start to restart, or npm run install-service to re-enable auto-start.`);
    } catch {
      console.log(`${DISPLAY} service was not running.`);
    }
    process.exit(0);
  }
} else if (process.platform === 'linux') {
  try {
    execFileSync('systemctl', ['--user', 'is-enabled', SYSTEMD_UNIT], { stdio: 'ignore' });
    try {
      execFileSync('systemctl', ['--user', 'stop', SYSTEMD_UNIT], { stdio: 'inherit' });
      console.log(`${DISPLAY} service stopped (systemd). Run npm start to restart.`);
    } catch {
      console.log(`${DISPLAY} service was not running.`);
    }
    process.exit(0);
  } catch { /* service not installed — fall through to sweep-based stop */ }
}

try {
  const pids = stopAllServerInstances({ ENTRY, RUNNER, PORT });
  if (!pids.length) {
    console.log(`${DISPLAY} is not running.`);
  } else {
    console.log(`Stopped ${DISPLAY} (PID ${pids.join(', ')})`);
  }
} catch (err) {
  console.error(`Failed to stop ${DISPLAY}:`, err.message);
  process.exit(1);
}
