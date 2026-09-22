/**
 * Start the LM Studio local API and load every model BFrost needs at startup.
 *
 * Windows is the only supported platform for this helper. It is deliberately
 * idempotent: starting an already-running server and requesting an already-loaded
 * model are both safe.
 *
 * Configuration (from .env):
 *   LMSTUDIO_APP             optional absolute path to LM Studio.exe
 *   LMSTUDIO_BIN             optional absolute path to lms.exe
 *   LMSTUDIO_PORT            optional API port (falls back to OLLAMA_BASE_URL, then 1234)
 *   EMBEDDING_PROVIDER       local/lmstudio means EMBEDDING_MODEL is loaded
 *   EMBEDDING_MODEL          model required by Memory/Documents
 *   LMSTUDIO_STARTUP_MODELS  optional comma-separated extra chat/model identifiers
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

if (process.platform !== 'win32') {
  console.log('[LM Studio] Windows-only helper: nothing to do on this platform.');
  process.exit(0);
}

dotenv.config({ path: path.join(process.cwd(), '.env'), quiet: true });

function resolveLmStudioApp() {
  const candidates = [
    process.env.LMSTUDIO_APP?.trim(),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'LM Studio', 'LM Studio.exe')
      : null,
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'LM Studio', 'LM Studio.exe')
      : null,
    process.env['ProgramFiles(x86)']
      ? path.join(process.env['ProgramFiles(x86)'], 'LM Studio', 'LM Studio.exe')
      : null,
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  throw new Error(
    `LM Studio.exe not found. Set LMSTUDIO_APP in .env. Checked: ${candidates.join(', ')}`,
  );
}

function resolveLmsBin() {
  const candidates = [
    process.env.LMSTUDIO_BIN?.trim(),
    path.join(os.homedir(), '.lmstudio', 'bin', 'lms.exe'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'LM Studio', 'resources', 'app', '.webpack', 'lms.exe')
      : null,
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  throw new Error(
    `lms.exe not found. Set LMSTUDIO_BIN in .env. Checked: ${candidates.join(', ')}`,
  );
}

function configuredPort() {
  const explicit = Number(process.env.LMSTUDIO_PORT);
  if (Number.isInteger(explicit) && explicit > 0 && explicit <= 65535) return explicit;
  try {
    const baseUrl = new URL(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:1234/v1');
    const fromUrl = Number(baseUrl.port);
    if (Number.isInteger(fromUrl) && fromUrl > 0 && fromUrl <= 65535) return fromUrl;
  } catch {
    // The actionable validation error below is clearer than URL's parser error.
  }
  return 1234;
}

function requiredModels() {
  const models = new Map();
  const embeddingProvider = (process.env.EMBEDDING_PROVIDER || 'local').trim().toLowerCase();
  const embeddingModel = (process.env.EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5').trim();
  if ((embeddingProvider === 'local' || embeddingProvider === 'lmstudio') && embeddingModel) {
    models.set(embeddingModel, 'embedding');
  }
  for (const model of (process.env.LMSTUDIO_STARTUP_MODELS || '').split(',')) {
    const normalized = model.trim();
    if (normalized) models.set(normalized, models.get(normalized) || 'extra');
  }
  return models;
}

function runLms(lmsBin, args, timeout = undefined) {
  try {
    return execFileSync(lmsBin, args, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
    throw new Error([`lms ${args.join(' ')} failed.`, stderr || stdout].filter(Boolean).join(' '));
  }
}

function daemonIsRunning(lmsBin) {
  try {
    const status = runLms(lmsBin, ['daemon', 'status'], 2_000);
    return !status.toLowerCase().includes('not running');
  } catch {
    return false;
  }
}

async function ensureLmStudioApp(lmsBin, timeoutMs = 60_000) {
  const app = resolveLmStudioApp();
  console.log(`[LM Studio] Launching ${path.basename(app)}...`);
  // Route the GUI launch through Explorer so it opens in the interactive user's
  // desktop even when `npm start` itself is running from a background launcher.
  const child = spawn('explorer.exe', [app], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  // The desktop app normally starts its daemon. Give it a short head start so it
  // can also update its bundled CLI before a daemon process locks that file.
  const appDeadline = Date.now() + Math.min(timeoutMs, 10_000);
  while (Date.now() < appDeadline) {
    if (daemonIsRunning(lmsBin)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Some non-interactive Windows launchers cannot keep Electron alive. The
  // official daemon command is a foreground process, so detach it explicitly.
  console.log('[LM Studio] Desktop daemon not ready; starting the LM Studio daemon directly...');
  const daemon = spawn(lmsBin, ['daemon', 'up'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  daemon.unref();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (daemonIsRunning(lmsBin)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('LM Studio application started, but its local service did not become ready.');
}

async function waitForApi(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`LM Studio API did not become ready on port ${port}: ${lastError?.message || 'timeout'}`);
}

async function verifyEmbedding(port, model) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: 'BFrost startup check' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Embedding verification failed for ${model} (HTTP ${response.status}): ${detail}`);
  }
  const payload = await response.json();
  const dimensions = Array.isArray(payload?.data?.[0]?.embedding) ? payload.data[0].embedding.length : 0;
  if (dimensions === 0) throw new Error(`Embedding verification returned no vector for ${model}.`);
  return dimensions;
}

try {
  const lmsBin = resolveLmsBin();
  const port = configuredPort();
  const models = requiredModels();

  await ensureLmStudioApp(lmsBin);
  console.log(`[LM Studio] Starting local API on 127.0.0.1:${port}...`);
  runLms(lmsBin, ['server', 'start', '--port', String(port), '--bind', '127.0.0.1']);
  await waitForApi(port);

  for (const [model, kind] of models) {
    const loaded = runLms(lmsBin, ['ps']);
    if (loaded.includes(model)) {
      console.log(`[LM Studio] ${model} is already loaded.`);
    } else {
      console.log(`[LM Studio] Loading ${model}...`);
      runLms(lmsBin, ['load', model, '--identifier', model, '--yes']);
    }
    if (kind === 'embedding') {
      const dimensions = await verifyEmbedding(port, model);
      console.log(`[LM Studio] Embedding API verified (${dimensions} dimensions).`);
    }
  }

  if (models.size === 0) {
    console.log('[LM Studio] Server ready; no startup models are configured.');
  } else {
    console.log(`[LM Studio] Ready with ${models.size} required model(s).`);
  }
} catch (error) {
  console.error(`[LM Studio] Startup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
