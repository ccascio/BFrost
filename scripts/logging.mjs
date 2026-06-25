import { existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

export const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024;
export const DEFAULT_LOG_ROTATIONS = 1;

export function defaultLogFile(root) {
  return process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Logs', 'BFrost', 'bfrost.log')
    : path.join(root, 'data', 'bfrost.log');
}

export function parseLogLimit(value, fallback = DEFAULT_MAX_LOG_BYTES) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function parseLogRotations(value, fallback = DEFAULT_LOG_ROTATIONS) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function rotateLogFile(file, maxBytes, rotations = DEFAULT_LOG_ROTATIONS) {
  if (maxBytes <= 0 || !existsSync(file)) return;
  const size = statSync(file).size;
  if (size < maxBytes) return;

  mkdirSync(path.dirname(file), { recursive: true });

  if (rotations <= 0) {
    rmSync(file, { force: true });
    return;
  }

  for (let i = rotations; i >= 1; i -= 1) {
    const target = `${file}.${i}`;
    if (i === rotations) {
      rmSync(target, { force: true });
    } else {
      const source = `${file}.${i}`;
      const nextTarget = `${file}.${i + 1}`;
      if (existsSync(source)) renameSync(source, nextTarget);
    }
  }

  renameSync(file, `${file}.1`);
}

export class RotatingLogWriter extends Writable {
  constructor(file, options = {}) {
    super();
    this.file = file;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
    this.rotations = options.rotations ?? DEFAULT_LOG_ROTATIONS;
    mkdirSync(path.dirname(this.file), { recursive: true });
    rotateLogFile(this.file, this.maxBytes, this.rotations);
    this.fd = openSync(this.file, 'a');
    this.size = existsSync(this.file) ? statSync(this.file).size : 0;
  }

  _write(chunk, _encoding, callback) {
    try {
      let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (this.maxBytes > 0 && data.length > this.maxBytes) {
        data = data.subarray(data.length - this.maxBytes);
      }
      if (this.maxBytes > 0 && this.size + data.length > this.maxBytes) {
        this.rotate();
      }
      writeSync(this.fd, data);
      this.size += data.length;
      callback();
    } catch (err) {
      callback(err);
    }
  }

  _final(callback) {
    try {
      closeSync(this.fd);
      callback();
    } catch (err) {
      callback(err);
    }
  }

  rotate() {
    closeSync(this.fd);
    rotateLogFile(this.file, 1, this.rotations);
    this.fd = openSync(this.file, 'a');
    this.size = existsSync(this.file) ? statSync(this.file).size : 0;
  }
}
