#!/usr/bin/env node
/**
 * `npx bfrost` entry point.
 *
 * Runs the BFrost server in the foreground with all state kept in a stable
 * data home (default: ~/.bfrost, override with --home or $BFROST_HOME).
 * The process chdirs into the data home before booting, so every relative
 * path the server uses (./data, ./workers/local, .env) lands there instead
 * of inside the npx cache.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printHelp() {
  console.log(`Usage: bfrost [options]

Runs the BFrost server in the foreground. Press Ctrl+C to stop.

Options:
  --home <dir>   Data home for database, workers, and .env (default: ~/.bfrost,
                 or $BFROST_HOME when set)
  --port <n>     Dashboard port (default: 3030)
  --host <addr>  Bind address (default: 127.0.0.1 — keep loopback unless you
                 understand the exposure)
  -v, --version  Print the version and exit
  -h, --help     Show this help and exit
`);
}

const args = process.argv.slice(2);
let home = process.env.BFROST_HOME || path.join(homedir(), '.bfrost');

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  const next = () => {
    i += 1;
    if (i >= args.length || args[i].startsWith('-')) {
      console.error(`Error: ${arg} requires a value`);
      process.exit(1);
    }
    return args[i];
  };
  switch (arg) {
    case '--home':
      home = path.resolve(next());
      break;
    case '--port':
      process.env.ADMIN_PORT = next();
      break;
    case '--host':
      process.env.ADMIN_HOST = next();
      break;
    case '-v':
    case '--version': {
      const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
      console.log(pkg.version);
      process.exit(0);
      break;
    }
    case '-h':
    case '--help':
      printHelp();
      process.exit(0);
      break;
    default:
      console.error(`Unknown option: ${arg}`);
      printHelp();
      process.exit(1);
  }
}

mkdirSync(path.join(home, 'data'), { recursive: true });
mkdirSync(path.join(home, 'workers', 'local'), { recursive: true });
process.chdir(home);

const port = process.env.ADMIN_PORT || '3030';
console.log('BFrost starting...');
console.log(`  Dashboard: http://127.0.0.1:${port}`);
console.log(`  Data home: ${home}`);
console.log('  Stop:      Ctrl+C');
console.log('');

await import(pathToFileURL(path.join(PACKAGE_ROOT, 'dist', 'index.js')));
