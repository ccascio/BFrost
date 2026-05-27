import { spawn, execFileSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function npmArgs(script) {
  if (npmCli) {
    return {
      command: process.execPath,
      args: [npmCli, 'run', script],
    };
  }

  return {
    command: npmCommand,
    args: ['run', script],
  };
}

function runOnce(script) {
  const { command, args } = npmArgs(script);
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${script} exited with ${signal ?? `code ${code}`}`));
    });
  });
}

function startLongRunning(label, command, args) {
  console.log(`[dev] Starting ${label}...`);

  return spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
  });
}

function stopProcess(child, signal = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    child.kill(signal);
  } catch {
    child.kill(signal);
  }
}

/**
 * Kill any process already listening on `port` so a re-run of `npm run dev`
 * doesn't collide with a leftover backend from a previous session.
 * Uses `lsof` on macOS/Linux; falls back to `netstat`+`taskkill` on Windows;
 * silently skips if neither tool is available or the port is already free.
 */
function freePort(port) {
  try {
    if (process.platform === 'win32') {
      // netstat -ano | findstr :3030  → last column is PID
      const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
      const pids = new Set(
        out.split('\n')
          .filter((l) => l.includes(`:${port} `) && l.includes('LISTENING'))
          .map((l) => l.trim().split(/\s+/).at(-1))
          .filter(Boolean),
      );
      for (const pid of pids) {
        try { execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
      }
    } else {
      // lsof -ti:3030 returns one PID per line
      let pids;
      try {
        pids = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' })
          .trim().split('\n').filter(Boolean);
      } catch {
        return; // port is already free; lsof exits non-zero when no process found
      }
      if (pids.length === 0) return;
      console.log(`[dev] Freeing port ${port} (PID${pids.length > 1 ? 's' : ''}: ${pids.join(', ')})...`);
      try { execFileSync('kill', pids, { stdio: 'ignore' }); } catch { /* already gone */ }
      // Give the process up to 1 s to release the socket before we bind it
      const deadline = Date.now() + 1000;
      let stillListening = [];
      while (Date.now() < deadline) {
        try {
          stillListening = execFileSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' })
            .trim().split('\n').filter(Boolean);
          // Still alive — busy-wait a tick (synchronous sleep via Date)
          const until = Date.now() + 50;
          while (Date.now() < until) { /* spin */ }
        } catch {
          stillListening = [];
          break; // port is free
        }
      }
      if (stillListening.length > 0) {
        console.log(`[dev] Port ${port} still held; force-stopping PID${stillListening.length > 1 ? 's' : ''}: ${stillListening.join(', ')}...`);
        try { execFileSync('kill', ['-9', ...stillListening], { stdio: 'ignore' }); } catch { /* already gone */ }
      }
    }
  } catch {
    // Best-effort; don't fail the whole dev startup over a port-freeing hiccup.
  }
}

console.log('[dev] Running unit tests before starting BFrost...');

try {
  await runOnce('test');
} catch (err) {
  console.error(`[dev] Startup aborted: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

console.log('[dev] Tests passed. Starting Telegram agents and GUI...');

// Release port 3030 if a previous dev session is still holding it.
freePort(3030);

const children = [
  { label: 'app', child: startLongRunning('Telegram agents/backend', process.execPath, ['dist/index.js']) },
  { label: 'gui', child: startLongRunning('GUI', process.execPath, ['node_modules/vite/bin/vite.js']) },
];

let shuttingDown = false;
let desiredExitCode = 0;
let forceExitTimer;

function allChildrenExited() {
  return children.every(({ child }) => child.exitCode !== null || child.signalCode !== null);
}

function shutdown(signal = 'SIGTERM', exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  desiredExitCode = exitCode;
  process.exitCode = exitCode;
  console.log(`[dev] Stopping BFrost dev processes (${signal})...`);

  for (const { child } of children) {
    stopProcess(child, signal);
  }

  forceExitTimer = setTimeout(() => {
    for (const { child } of children) {
      stopProcess(child, 'SIGKILL');
    }
    process.exit(exitCode);
  }, 5000);
}

for (const { label, child } of children) {
  child.once('error', (err) => {
    console.error(`[dev] Failed to start ${label}:`, err);
    shutdown('SIGTERM', 1);
  });

  child.once('exit', (code, signal) => {
    if (shuttingDown) {
      if (allChildrenExited()) {
        clearTimeout(forceExitTimer);
        process.exit(desiredExitCode);
      }
      return;
    }

    console.error(`[dev] ${label} exited with ${signal ?? `code ${code}`}; stopping the rest.`);
    shutdown('SIGTERM', code ?? 1);
  });
}

process.once('SIGINT', () => shutdown('SIGINT', 0));
process.once('SIGTERM', () => shutdown('SIGTERM', 0));
