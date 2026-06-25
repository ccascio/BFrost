/**
 * Start BFrost in the background.
 *
 * - Stops any existing instance listening on the admin port first.
 * - Spawns a detached server runner so the terminal can close.
 * - Writes stdout/stderr through a bounded rotating bfrost.log.
 *
 * Usage: npm start   (or: node scripts/daemon.mjs)
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_LOG_BYTES, DEFAULT_LOG_ROTATIONS, defaultLogFile } from './logging.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'dist', 'index.js');
const RUNNER = path.join(ROOT, 'scripts', 'run-server.mjs');
const LOG_FILE = defaultLogFile(ROOT);
const PORT = Number(process.env.BFROST_PORT ?? 3030);
const LABEL = 'net.bfrost.server';

const REGISTRY = path.join(ROOT, 'dist', 'workers', 'registry.js');
if (!existsSync(ENTRY) || !existsSync(REGISTRY)) {
  console.error('Error: build is missing or incomplete. Run: npm run build');
  process.exit(1);
}

// If an OS service is installed, delegate to the service manager instead of
// spawning a bare detached process — otherwise we'd fight with KeepAlive.
if (process.platform === 'darwin') {
  const plist = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (existsSync(plist)) {
    try { execFileSync('launchctl', ['unload', plist], { stdio: 'ignore' }); } catch { /* not loaded */ }
    execFileSync('launchctl', ['load', plist], { stdio: 'inherit' });
    console.log(`BFrost service restarted (launchd).`);
    console.log(`  Dashboard: http://127.0.0.1:${PORT}`);
    console.log(`  Logs:      ${LOG_FILE}  (npm run logs)`);
    process.exit(0);
  }
} else if (process.platform === 'linux') {
  try {
    execFileSync('systemctl', ['--user', 'is-enabled', 'bfrost'], { stdio: 'ignore' });
    execFileSync('systemctl', ['--user', 'restart', 'bfrost'], { stdio: 'inherit' });
    console.log(`BFrost service restarted (systemd).`);
    console.log(`  Dashboard: http://127.0.0.1:${PORT}`);
    console.log(`  Logs:      ${LOG_FILE}  (npm run logs)`);
    process.exit(0);
  } catch { /* service not installed — fall through to detached spawn */ }
}

/**
 * Kill whatever process is currently listening on PORT.
 * Mirrors the freePort() logic in dev.mjs for cross-platform support.
 */
function stopExisting() {
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
      if (!pids.length) return;
      console.log(`Stopping existing BFrost instance (PID ${pids.join(', ')})...`);
      for (const pid of pids) {
        try {
          execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
        } catch { /* already gone */ }
      }
    } else {
      let pids;
      try {
        pids = execFileSync('lsof', ['-ti', `:${PORT}`], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .filter(Boolean);
      } catch {
        return; // Nothing on the port — nothing to stop.
      }
      if (!pids.length) return;
      console.log(`Stopping existing BFrost instance (PID ${pids.join(', ')})...`);
      try {
        execFileSync('kill', pids, { stdio: 'ignore' });
      } catch { /* already gone */ }

      // Wait up to 3 s for graceful shutdown before force-killing.
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        try {
          execFileSync('lsof', ['-ti', `:${PORT}`], { stdio: 'ignore' });
          const until = Date.now() + 100;
          while (Date.now() < until) { /* busy-wait */ }
        } catch {
          return; // Port is free.
        }
      }

      // Still alive after graceful window — force kill.
      try {
        const remaining = execFileSync('lsof', ['-ti', `:${PORT}`], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .filter(Boolean);
        if (remaining.length) {
          execFileSync('kill', ['-9', ...remaining], { stdio: 'ignore' });
        }
      } catch { /* already gone */ }
    }
  } catch {
    // Best-effort — don't abort the start if the stop fails.
  }
}

stopExisting();

mkdirSync(path.dirname(LOG_FILE), { recursive: true });

const child = spawn(process.execPath, [RUNNER], {
  detached: true,
  stdio: 'ignore',
  cwd: ROOT,
  env: process.env,
  windowsHide: true,
});

child.unref();

console.log(`BFrost started in background (PID ${child.pid})`);
console.log(`  Dashboard: http://127.0.0.1:${PORT}`);
console.log(`  Logs:      ${LOG_FILE} (rotates at ${DEFAULT_MAX_LOG_BYTES} bytes, keeps ${DEFAULT_LOG_ROTATIONS})`);
console.log(`  Stop:      npm stop`);
