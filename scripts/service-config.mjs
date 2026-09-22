/**
 * Per-project OS-service identity, shared by daemon/start, stop, install-service,
 * uninstall-service, and logs.
 *
 * Everything is derived from `package.json`'s `name`, so a fork (e.g. BFrost vs BFrost)
 * gets its own launchd label, systemd unit, PM2/Task name, and log path instead of
 * fighting over a single shared service. Renaming the package renames the service.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const SLUG =
  String(pkg.name || 'app')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'app';
const DISPLAY = SLUG.charAt(0).toUpperCase() + SLUG.slice(1);

const NODE = process.execPath;
const ENTRY = path.join(ROOT, 'dist', 'index.js');
const REGISTRY = path.join(ROOT, 'dist', 'workers', 'registry.js');
const RUNNER = path.join(ROOT, 'scripts', 'run-server.mjs');

// The server binds ADMIN_PORT (see src/config.ts); the service tooling must match it so
// stop/restart target the right process. A legacy <SLUG>_PORT env is honoured as a fallback.
const PORT = Number(process.env.ADMIN_PORT ?? process.env[`${SLUG.toUpperCase()}_PORT`] ?? 3030);

const LABEL = `net.${SLUG}.server`;
const LOG_FILE =
  process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Logs', DISPLAY, `${SLUG}.log`)
    : path.join(ROOT, 'data', `${SLUG}.log`);
const PLIST_PATH = path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const SYSTEMD_UNIT = SLUG;
const SYSTEMD_PATH = path.join(homedir(), '.config', 'systemd', 'user', `${SLUG}.service`);
const PM2_NAME = SLUG;
const WIN_TASK = DISPLAY;
const WIN_WRAPPER = path.join(ROOT, 'scripts', `_${SLUG}-service.cmd`);

export const service = {
  ROOT,
  SLUG,
  DISPLAY,
  NODE,
  ENTRY,
  REGISTRY,
  RUNNER,
  PORT,
  LABEL,
  LOG_FILE,
  PLIST_PATH,
  SYSTEMD_UNIT,
  SYSTEMD_PATH,
  PM2_NAME,
  WIN_TASK,
  WIN_WRAPPER,
};

export default service;
