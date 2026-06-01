/**
 * Remove the BFrost OS background service installed by install-service.mjs.
 *
 * Usage: npm run uninstall-service
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.BFROST_PORT ?? 3030);

function killPort() {
  try {
    const pids = execFileSync('lsof', ['-ti', `:${PORT}`], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    if (pids.length) execFileSync('kill', pids, { stdio: 'ignore' });
  } catch { /* nothing on the port */ }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'net.bfrost.server';

function ok(msg) { console.log(`✓ ${msg}`); }
function warn(msg) { console.warn(`! ${msg}`); }

// ---------------------------------------------------------------------------
// macOS
// ---------------------------------------------------------------------------
if (process.platform === 'darwin') {
  const plistPath = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

  if (!existsSync(plistPath)) {
    console.log('No BFrost launchd service found.');
    process.exit(0);
  }

  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch { /* already unloaded */ }

  rmSync(plistPath, { force: true });
  killPort(); // ensure the process is stopped even if launchd is slow
  ok('BFrost launchd service removed.');
}

// ---------------------------------------------------------------------------
// Linux
// ---------------------------------------------------------------------------
else if (process.platform === 'linux') {
  const servicePath = path.join(homedir(), '.config', 'systemd', 'user', 'bfrost.service');

  if (!existsSync(servicePath)) {
    console.log('No BFrost systemd service found.');
    process.exit(0);
  }

  try {
    execFileSync('systemctl', ['--user', 'disable', '--now', 'bfrost'], { stdio: 'inherit' });
  } catch (err) {
    warn(`systemctl disable failed: ${err.message}`);
  }

  rmSync(servicePath, { force: true });
  killPort();

  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  } catch { /* best-effort */ }

  ok('BFrost systemd service removed.');
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
else if (process.platform === 'win32') {
  // Try PM2 first.
  const hasPm2 = spawnSync('pm2', ['--version'], { shell: true }).status === 0;
  if (hasPm2) {
    spawnSync('pm2', ['delete', 'bfrost'], { shell: true, stdio: 'inherit' });
    spawnSync('pm2', ['save'], { shell: true, stdio: 'inherit' });
    ok('BFrost removed from PM2.');
  }

  // Remove Task Scheduler entry if present.
  const ts = spawnSync('schtasks', ['/delete', '/tn', 'BFrost', '/f'], {
    shell: true,
    stdio: 'ignore',
  });
  if (ts.status === 0) ok('BFrost Task Scheduler entry removed.');

  // Remove the restart wrapper script if it exists.
  const wrapperPath = path.join(ROOT, 'scripts', '_bfrost-service.cmd');
  if (existsSync(wrapperPath)) rmSync(wrapperPath, { force: true });

  if (!hasPm2 && ts.status !== 0) {
    console.log('No BFrost Windows service found.');
  }
} else {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(1);
}
