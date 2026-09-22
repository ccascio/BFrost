/**
 * Run the backend in the foreground while writing bounded rotating logs.
 *
 * This is the process launched by npm-start's daemon wrapper and by installed
 * OS services. The backend still writes to stdout/stderr; this wrapper keeps
 * the project log capped.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  DEFAULT_MAX_LOG_BYTES,
  DEFAULT_LOG_ROTATIONS,
  RotatingLogWriter,
  parseLogLimit,
  parseLogRotations,
} from './logging.mjs';
import { envWithSystemCa } from './node-options.mjs';
import { service } from './service-config.mjs';

const { ROOT, ENTRY, REGISTRY, LOG_FILE, DISPLAY } = service;
const MAX_LOG_BYTES = parseLogLimit(process.env.BFROST_MAX_LOG_BYTES ?? process.env.BFROST_MAX_LOG_BYTES, DEFAULT_MAX_LOG_BYTES);
const LOG_ROTATIONS = parseLogRotations(process.env.BFROST_LOG_ROTATIONS ?? process.env.BFROST_LOG_ROTATIONS, DEFAULT_LOG_ROTATIONS);

if (!existsSync(ENTRY) || !existsSync(REGISTRY)) {
  console.error('Error: build is missing or incomplete. Run: npm run build');
  process.exit(1);
}

const log = new RotatingLogWriter(LOG_FILE, {
  maxBytes: MAX_LOG_BYTES,
  rotations: LOG_ROTATIONS,
});

function writeLauncherLine(message) {
  log.write(`[${DISPLAY} launcher] ${new Date().toISOString()} ${message}\n`);
}

writeLauncherLine(`Starting backend with log limit ${MAX_LOG_BYTES} bytes and ${LOG_ROTATIONS} rotation(s).`);

const child = spawn(process.execPath, [ENTRY], {
  cwd: ROOT,
  env: envWithSystemCa(process.env),
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });

let stopping = false;

function stopChild(signal) {
  if (stopping) return;
  stopping = true;
  writeLauncherLine(`Received ${signal}; stopping backend.`);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
}

process.once('SIGINT', () => stopChild('SIGINT'));
process.once('SIGTERM', () => stopChild('SIGTERM'));

child.once('error', (err) => {
  writeLauncherLine(`Failed to start backend: ${err.message}`);
  log.end(() => process.exit(1));
});

child.once('exit', (code, signal) => {
  writeLauncherLine(`Backend exited with ${signal ?? `code ${code}`}.`);
  log.end(() => {
    process.exit(code ?? (signal ? 1 : 0));
  });
});

