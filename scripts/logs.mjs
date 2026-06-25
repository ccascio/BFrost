import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultLogFile } from './logging.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_FILE = defaultLogFile(ROOT);

execFileSync('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
