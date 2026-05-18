import { spawn } from 'node:child_process';

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

console.log('[dev] Running unit tests before starting BFrost...');

try {
  await runOnce('test');
} catch (err) {
  console.error(`[dev] Startup aborted: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

console.log('[dev] Tests passed. Starting Telegram agents and GUI...');

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
