import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = process.platform === 'darwin'
  ? path.join(homedir(), 'Library', 'Logs', 'BFrost', 'bfrost.log')
  : path.join(ROOT, 'data', 'bfrost.log');

execFileSync('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
