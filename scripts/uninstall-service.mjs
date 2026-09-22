/**
 * Remove the OS background service installed by install-service.mjs.
 *
 * Service identity is per-project — see scripts/service-config.mjs — so this only ever
 * removes THIS project's service, never an upstream fork's.
 *
 * Usage: npm run uninstall-service
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { service } from './service-config.mjs';

const { PORT, PLIST_PATH, SYSTEMD_UNIT, SYSTEMD_PATH, PM2_NAME, WIN_TASK, WIN_WRAPPER, DISPLAY } = service;

function killPort() {
  try {
    const pids = execFileSync('lsof', ['-ti', `:${PORT}`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    if (pids.length) execFileSync('kill', pids, { stdio: 'ignore' });
  } catch { /* nothing on the port */ }
}

function ok(msg) { console.log(`✓ ${msg}`); }
function warn(msg) { console.warn(`! ${msg}`); }

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------
if (process.platform === 'darwin') {
  if (!existsSync(PLIST_PATH)) {
    console.log(`No ${DISPLAY} launchd service found.`);
    process.exit(0);
  }

  try {
    execFileSync('launchctl', ['unload', PLIST_PATH], { stdio: 'ignore' });
  } catch { /* already unloaded */ }

  rmSync(PLIST_PATH, { force: true });
  killPort(); // ensure the process is stopped even if launchd is slow
  ok(`${DISPLAY} launchd service removed.`);
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------
else if (process.platform === 'linux') {
  if (!existsSync(SYSTEMD_PATH)) {
    console.log(`No ${DISPLAY} systemd service found.`);
    process.exit(0);
  }

  try {
    execFileSync('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT], { stdio: 'inherit' });
  } catch (err) {
    warn(`systemctl disable failed: ${err.message}`);
  }

  rmSync(SYSTEMD_PATH, { force: true });
  killPort();

  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  } catch { /* best-effort */ }

  ok(`${DISPLAY} systemd service removed.`);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
else if (process.platform === 'win32') {
  // Try PM2 first.
  const hasPm2 = spawnSync('pm2', ['--version'], { shell: true }).status === 0;
  if (hasPm2) {
    spawnSync('pm2', ['delete', PM2_NAME], { shell: true, stdio: 'inherit' });
    spawnSync('pm2', ['save'], { shell: true, stdio: 'inherit' });
    ok(`${DISPLAY} removed from PM2.`);
  }

  // Remove Task Scheduler entry if present.
  const ts = spawnSync('schtasks', ['/delete', '/tn', WIN_TASK, '/f'], {
    shell: true,
    stdio: 'ignore',
  });
  if (ts.status === 0) ok(`${DISPLAY} Task Scheduler entry removed.`);

  // Remove the restart wrapper script if it exists.
  if (existsSync(WIN_WRAPPER)) rmSync(WIN_WRAPPER, { force: true });

  if (!hasPm2 && ts.status !== 0) {
    console.log(`No ${DISPLAY} Windows service found.`);
  }
} else {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}
