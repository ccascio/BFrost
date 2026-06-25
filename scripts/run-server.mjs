/**
 * Run the BFrost backend in the foreground while writing bounded rotating logs.
 *
 * This is the process launched by npm-start's daemon wrapper and by installed
 * OS services. The backend still writes to stdout/stderr; this wrapper keeps
 * bfrost.log capped.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_MAX_LOG_BYTES,
  DEFAULT_LOG_ROTATIONS,
  RotatingLogWriter,
  defaultLogFile,
  parseLogLimit,
  parseLogRotations,
} from './logging.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'dist', 'index.js');
const REGISTRY = path.join(ROOT, 'dist', 'workers', 'registry.js');
const LOG_FILE = defaultLogFile(ROOT);
const MAX_LOG_BYTES = parseLogLimit(process.env.BFROST_MAX_LOG_BYTES, DEFAULT_MAX_LOG_BYTES);
const LOG_ROTATIONS = parseLogRotations(process.env.BFROST_LOG_ROTATIONS, DEFAULT_LOG_ROTATIONS);

if (!existsSync(ENTRY) || !existsSync(REGISTRY)) {
  console.error('Error: build is missing or incomplete. Run: npm run build');
  process.exit(1);
}

const log = new RotatingLogWriter(LOG_FILE, {
  maxBytes: MAX_LOG_BYTES,
  rotations: LOG_ROTATIONS,
});

function writeLauncherLine(message) {
  log.write(`[BFrost launcher] ${new Date().toISOString()} ${message}\n`);
}

writeLauncherLine(`Starting backend with log limit ${MAX_LOG_BYTES} bytes and ${LOG_ROTATIONS} rotation(s).`);

const child = spawn(process.execPath, [ENTRY], {
  cwd: ROOT,
  env: process.env,
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

