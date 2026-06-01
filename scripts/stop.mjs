/**
 * Stop the BFrost background instance.
 *
 * Finds whatever process is listening on the admin port and sends SIGTERM
 * (graceful shutdown). Falls through to a force-kill if it doesn't exit
 * within 3 seconds.
 *
 * Usage: npm stop   (or: node scripts/stop.mjs)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BFROST_PORT ?? 3030);
const LABEL = 'net.bfrost.server';

// If an OS service is installed, stop via the service manager so KeepAlive
// doesn't immediately restart the process we just killed.
if (process.platform === 'darwin') {
  const plist = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (existsSync(plist)) {
    try {
      execFileSync('launchctl', ['unload', plist], { stdio: 'ignore' });
      console.log('BFrost service stopped (launchd). Run npm start to restart, or npm run install-service to re-enable auto-start.');
    } catch {
      console.log('BFrost service was not running.');
    }
    process.exit(0);
  }
} else if (process.platform === 'linux') {
  try {
    execFileSync('systemctl', ['--user', 'is-enabled', 'bfrost'], { stdio: 'ignore' });
    try {
      execFileSync('systemctl', ['--user', 'stop', 'bfrost'], { stdio: 'inherit' });
      console.log('BFrost service stopped (systemd). Run npm start to restart.');
    } catch {
      console.log('BFrost service was not running.');
    }
    process.exit(0);
  } catch { /* service not installed — fall through to port-based stop */ }
}

try {
  if (process.platform === 'win32') {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    const pids = [
      ...new Set(
        out
          .split('\n')
          .filter((l) => l.includes(`:${PORT} `) && l.includes('LISTENING'))
          .map((l) => l.trim().split(/\s+/).at(-1))
          .filter(Boolean),
      ),
    ];
    if (!pids.length) {
      console.log('BFrost is not running.');
      process.exit(0);
    }
    for (const pid of pids) {
      try {
        execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
      } catch { /* already gone */ }
    }
    console.log(`BFrost stopped (PID ${pids.join(', ')})`);
  } else {
    let pids;
    try {
      pids = execFileSync('lsof', ['-ti', `:${PORT}`], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
    } catch {
      console.log('BFrost is not running.');
      process.exit(0);
    }

    if (!pids.length) {
      console.log('BFrost is not running.');
      process.exit(0);
    }

    console.log(`Stopping BFrost (PID ${pids.join(', ')})...`);
    try {
      execFileSync('kill', pids, { stdio: 'ignore' });
    } catch { /* already gone */ }

    // Wait up to 3 s for graceful shutdown.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      try {
        execFileSync('lsof', ['-ti', `:${PORT}`], { stdio: 'ignore' });
        const until = Date.now() + 100;
        while (Date.now() < until) { /* busy-wait */ }
      } catch {
        console.log('BFrost stopped.');
        process.exit(0);
      }
    }

    // Still alive — force kill.
    try {
      const remaining = execFileSync('lsof', ['-ti', `:${PORT}`], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter(Boolean);
      if (remaining.length) {
        execFileSync('kill', ['-9', ...remaining], { stdio: 'ignore' });
        console.log('BFrost force-stopped.');
      } else {
        console.log('BFrost stopped.');
      }
    } catch {
      console.log('BFrost stopped.');
    }
  }
} catch (err) {
  console.error('Failed to stop BFrost:', err.message);
  process.exit(1);
}
