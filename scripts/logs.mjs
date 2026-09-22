/**
 * Print the end of BFrost's log and keep following it without relying on the Unix
 * `tail` command. This works on Windows, macOS, and Linux and follows the new file
 * when RotatingLogWriter replaces the current one.
 *
 * Usage:
 *   npm run logs
 *   npm run logs -- --lines 80
 *   npm run logs -- --lines 80 --no-follow
 */
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { service } from './service-config.mjs';

const DEFAULT_LINES = 10;
const POLL_INTERVAL_MS = 250;
const READ_BUFFER_BYTES = 64 * 1024;

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: npm run logs -- [--lines <count>] [--no-follow]');
  process.exit(2);
}

function parseArgs(args) {
  let lines = DEFAULT_LINES;
  let follow = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--no-follow') {
      follow = false;
      continue;
    }
    if (arg === '--lines' || arg === '-n') {
      const value = args[index + 1];
      if (value === undefined) usage(`${arg} requires a non-negative integer.`);
      lines = Number(value);
      if (!Number.isSafeInteger(lines) || lines < 0) usage(`${arg} requires a non-negative integer.`);
      index += 1;
      continue;
    }
    usage(`Unknown option: ${arg}`);
  }

  return { lines, follow };
}

function identityOf(stat) {
  return `${stat.dev}:${stat.ino}`;
}

/** Return the byte offset of the last `lineCount` lines in a bounded log file. */
function tailOffset(data, lineCount) {
  if (lineCount === 0) return data.length;

  let breaks = 0;
  for (let index = data.length - 1; index >= 0; index -= 1) {
    if (data[index] !== 0x0a) continue;
    // A final newline terminates the last line; it does not introduce an empty one.
    if (index === data.length - 1) continue;
    breaks += 1;
    if (breaks === lineCount) return index + 1;
  }
  return 0;
}

function printInitialTail(file, lineCount) {
  try {
    const before = statSync(file);
    const data = readFileSync(file);
    process.stdout.write(data.subarray(tailOffset(data, lineCount)));
    // Start following at exactly the number of bytes printed/read. If the writer
    // appended between readFileSync and statSync, the next poll will pick those bytes
    // up instead of skipping them.
    return { identity: identityOf(before), offset: data.length };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    console.error(`Log file does not exist yet; waiting for ${file}`);
    return { identity: null, offset: 0 };
  }
}

function copyBytes(file, start, end) {
  const fd = openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  let position = start;
  try {
    while (position < end) {
      const requested = Math.min(buffer.length, end - position);
      const bytesRead = readSync(fd, buffer, 0, requested, position);
      if (bytesRead === 0) break;
      process.stdout.write(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    closeSync(fd);
  }
  return position;
}

function followFile(file, initial) {
  let { identity, offset } = initial;
  let reportedError = null;

  const poll = () => {
    try {
      const stat = statSync(file);
      const nextIdentity = identityOf(stat);

      // Rotation replaces the path with a new file. Truncation can happen without a
      // useful inode change on some Windows filesystems, so size is checked as well.
      if (identity !== null && (nextIdentity !== identity || stat.size < offset)) offset = 0;
      identity = nextIdentity;

      if (stat.size > offset) offset = copyBytes(file, offset, stat.size);
      reportedError = null;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        // Rotation briefly removes the path between rename and reopen. The next poll
        // will attach to the replacement and read it from the beginning.
        identity = null;
        offset = 0;
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message !== reportedError) console.error(`Could not follow ${file}: ${message}`);
      reportedError = message;
    }
  };

  setInterval(poll, POLL_INTERVAL_MS);

  // Leave cleanly on Ctrl+C or service shutdown on every supported terminal.
  process.once('SIGINT', () => process.exit(0));
  process.once('SIGTERM', () => process.exit(0));
}

const options = parseArgs(process.argv.slice(2));
const initial = printInitialTail(service.LOG_FILE, options.lines);
if (options.follow) followFile(service.LOG_FILE, initial);
