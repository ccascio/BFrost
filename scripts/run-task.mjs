import { spawn } from 'node:child_process';
import { envWithSystemCa } from './node-options.mjs';

const child = spawn(process.execPath, ['dist/cron.js', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: envWithSystemCa(process.env),
  windowsHide: true,
});

child.once('error', (err) => {
  console.error('[task] Failed to start:', err.message);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
