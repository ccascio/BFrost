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
  console.log(`Usage: bfrost [command] [options]

Commands:
  (none)             Run the BFrost server in the foreground (default).
  new worker [name]  Scaffold a new local worker into workers/local and exit.

Server options:
  --home <dir>   Data home for database, workers, and .env (default: ~/.bfrost,
                 or $BFROST_HOME when set)
  --port <n>     Dashboard port (default: 3030)
  --host <addr>  Bind address (default: 127.0.0.1 — keep loopback unless you
                 understand the exposure)
  -v, --version  Print the version and exit
  -h, --help     Show this help and exit

Run "bfrost new worker --help" for scaffold options.
`);
}

const rawArgs = process.argv.slice(2);

// Subcommand dispatch happens before the server-arg parser so `bfrost new worker`
// never boots the server. The scaffold path imports only dist/workers/scaffold.js.
if (rawArgs[0] === 'new') {
  await runNewCommand(rawArgs.slice(1));
  process.exit(0);
}

const args = rawArgs;
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

// ---------------------------------------------------------------------------
// `bfrost new worker` — scaffold a local worker without booting the server.
// ---------------------------------------------------------------------------

function printNewWorkerHelp() {
  console.log(`Usage: bfrost new worker [name] [options]

Scaffolds a runnable local worker (manifest, backend job, dashboard, README)
into <home>/workers/local/<id>. The worker ships disabled — enable it from the
Workers tab once the server is running.

Options:
  --id <id>            Worker id (default: derived from name, "local." prefixed)
  --role <role>        producer | consumer (default: producer)
  --item-type <type>   Item Bus item type to produce/consume
                       (default: local.<slug>.item)
  --cron <expr>        Schedule for the job (default: "0 9 * * *")
  --description <text> One-paragraph description
  --prompt <text>      System prompt that steers the job's model call
  --home <dir>         Data home (default: ~/.bfrost or $BFROST_HOME)
  -h, --help           Show this help and exit

Example:
  bfrost new worker "Daily Haiku" --prompt "Write one calm haiku about the day."
`);
}

async function runNewCommand(subArgs) {
  const target = subArgs[0];
  if (target !== 'worker') {
    console.error(`Unknown "new" target: ${target ?? '(none)'}. Try: bfrost new worker`);
    process.exit(1);
  }
  const argv = subArgs.slice(1);
  if (argv.includes('-h') || argv.includes('--help')) {
    printNewWorkerHelp();
    process.exit(0);
  }

  const opts = {};
  let positionalName;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const takeValue = (flag) => {
      i += 1;
      if (i >= argv.length) {
        console.error(`Error: ${flag} requires a value`);
        process.exit(1);
      }
      return argv[i];
    };
    switch (arg) {
      case '--id': opts.id = takeValue(arg); break;
      case '--name': opts.name = takeValue(arg); break;
      case '--role': opts.role = takeValue(arg); break;
      case '--item-type': opts.itemType = takeValue(arg); break;
      case '--cron': opts.cron = takeValue(arg); break;
      case '--description': opts.description = takeValue(arg); break;
      case '--tagline': opts.tagline = takeValue(arg); break;
      case '--prompt': opts.prompt = takeValue(arg); break;
      case '--home': opts.home = takeValue(arg); break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          printNewWorkerHelp();
          process.exit(1);
        }
        if (positionalName === undefined) positionalName = arg;
    }
  }
  if (positionalName !== undefined && opts.name === undefined) opts.name = positionalName;
  if (opts.name === undefined && opts.id === undefined) {
    console.error('Error: provide a worker name, e.g. bfrost new worker "Daily Haiku"');
    printNewWorkerHelp();
    process.exit(1);
  }

  const scaffoldUrl = pathToFileURL(path.join(PACKAGE_ROOT, 'dist', 'workers', 'scaffold.js'));
  let scaffold;
  try {
    scaffold = await import(scaffoldUrl);
  } catch (err) {
    console.error(
      'Could not load the scaffold module. Build BFrost first (npm run build:server).\n' +
        (err instanceof Error ? err.message : String(err)),
    );
    process.exit(1);
  }

  let spec;
  try {
    spec = scaffold.normalizeScaffoldSpec(opts);
  } catch (err) {
    console.error(`Invalid worker spec: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const dataHome = path.resolve(opts.home || process.env.BFROST_HOME || path.join(homedir(), '.bfrost'));
  const localRoot = path.join(dataHome, 'workers', 'local');
  const workerDir = path.join(localRoot, scaffold.workerSlug(spec.id));
  mkdirSync(localRoot, { recursive: true });
  mkdirSync(workerDir, { recursive: true });

  let written;
  try {
    written = await scaffold.writeWorkerScaffold(workerDir, spec);
  } catch (err) {
    console.error(`Could not scaffold worker: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log(`Created ${spec.role} worker "${spec.displayName}" (${spec.id})`);
  console.log(`  Location: ${workerDir}`);
  for (const file of written) console.log(`    + ${file}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Start BFrost:        bfrost' + (opts.home ? ` --home ${dataHome}` : ''));
  console.log('  2. Workers tab:         rescan, then enable the worker.');
  console.log(`  3. Jobs tab:            enable "${scaffold.workerSlug(spec.id)}-run" and click Run now.`);
}
