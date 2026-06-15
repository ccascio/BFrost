import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import http, { IncomingMessage, Server, ServerResponse } from 'http';
import { randomBytes, timingSafeEqual } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import {
  config,
  availableModels,
  getDefaultModel,
  setCloudApiKeys,
  setDefaultModel,
  setEmbeddingSettings,
  setAdminPassword,
  setLocalWorkerCodeEnabled,
  setAdminSessionTtlHours,
  setJobLlmTimeoutMs,
} from './config';
import { refreshActiveLocalProviderModels, refreshCloudProviderModels } from './model-discovery';
import { upsertEnvValue } from './env-file';
import {
  collectRecipes,
  getActiveLocalProvider,
  getRegisteredProvider,
  listRegisteredApiRoutes,
  listRegisteredChannels,
  listRegisteredProviders,
} from './workers/registry';
import { updatePlatformSettings } from './admin-config';
import { HttpRouter } from './http/router';
import { readJsonBody, readRawBody, sendJson } from './http/responses';
import { registerCoreRoutes } from './admin-routes';
import { buildDashboardState } from './admin-dashboard-state';
import { isAdminAuthEnabled, isAuthenticated, isPasswordValid, createSession, destroySession } from './admin-auth';
import type { ProviderAdapter } from './workers/module';

import { getSchedulerSnapshot, reloadSchedulerSchedules, triggerJobNow, updateSchedulerJob } from './scheduler';
import { isJobName, pinAndLoadModel, unpinAndUnloadModel } from './job-runner';
import { getPinnedModelId } from './local-model-pin';
import { listWorkers, setHiddenBuiltInIds } from './workers/registry';
import { builtInWorkers } from './workers/builtin';
import { discoverLocalWorkerResult, discoverLocalWorkers, type DiscoveredLocalWorker } from './workers/local';
import { compileLocalWorkerDashboard } from './workers/build';
import {
  normalizeScaffoldSpec,
  specFromModelOutput,
  writeWorkerScaffold,
  workerSlug,
  type WorkerScaffoldSpec,
} from './workers/scaffold';
import {
  forgetWorker,
  isWorkerEnabled,
  loadWorkerState,
  rememberSeenWorkers,
  setWorkerEnabled,
  setWorkerHidden,
  type WorkerStateStore,
} from './workers/state';
import { activateLocalWorker, deactivateLocalWorker } from './workers/bootstrap';
import { WorkerLoadError } from './workers/loader';
import type { WorkerManifest } from './workers/types';
import { getAppHealthSnapshot } from './health';
import type { AppHealthSnapshot, HealthStatus } from './health';
import { listRecentEventsSafe, recordEventSafe } from './event-log';
import { loadQueueSnapshot, updateDashboardQueueItem } from './jobs/queue-service';
import { loadRegisteredWorkerDashboardData } from './workers/dashboard-data';
import {
  AdminLoginBodySchema,
  AutoBackupSettingsSchema,
  BackupsSectionSchema,
  ChatMessageBodySchema,
  GenerateWorkerBodySchema,
  ChatThreadUpdateBodySchema,
  ProjectCreateBodySchema,
  ProjectRenameBodySchema,
  CloudApiKeysBodySchema,
  CoreSettingsBodySchema,
  EmbeddingSettingsBodySchema,
  FactoryResetBodySchema,
  PlatformSettingsBodySchema,
  CronJobUpdateBodySchema,
  CronRunsSectionSchema,
  DashboardStateSchema,
  DefaultModelBodySchema,
  EventsSectionSchema,
  LmStudioActionBodySchema,
  LmStudioModelsSectionSchema,
  LocalEmbeddingModelsSectionSchema,
  type LocalEmbeddingModelsSection,
  StoreInstallBodySchema,
  WorkerDataSectionSchema,
  WorkerUpdateBodySchema,
  QueueItemActionBodySchema,
  QueueSectionSchema,
  ActionDecisionBodySchema,
  JobMetricsResponseSchema,
  RecipeApplyBodySchema,
  type BackupsSection,
  type CronRunsSection,
  type DashboardState,
  type EventsSection,
  type LmStudioModelsSection,
  type WorkerDataSection,
  type QueueSection,
  type JobMetricsResponse,
} from './admin-api';
import {
  listPendingActionRequests,
  listActionRequests,
  approveActionRequest,
  rejectActionRequest,
} from './actions';
import { BadRequestError } from './admin-route';
import { listSchedulerRuns } from './scheduler-runs';
import {
  createAppBackup,
  getAutoBackupSettings,
  listAppBackups,
  restartAutoBackup,
  saveAutoBackupSettings,
  scheduleRestoreOnNextBoot,
  cancelPendingRestore,
} from './app-backup';
import { processChannelMessage } from './channel';
import { getFullHistory } from './conversation';
import {
  listThreads,
  getThread,
  renameThread,
  assignThreadProject,
  clearProjectFromThreads,
  deleteThread,
} from './chat-threads';
import {
  listProjects,
  getProject,
  createProject,
  renameProject,
  deleteProject,
} from './projects';
import { createHash } from 'crypto';
import { loadKvJson, saveKvJson } from './sqlite';
import { openWorkerKv } from './workers/storage';
import { generateText } from 'ai';
import { getChatModel } from './llm';
import { publishItem } from './jobs/item-bus';

let server: Server | null = null;


export async function startAdminServer(): Promise<void> {
  if (server) {
    return;
  }

  server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(config.adminPort, config.adminHost, () => {
      server!.off('error', reject);
      console.log(`[Admin] Dashboard available at http://${config.adminHost}:${config.adminPort}`);
      resolve();
    });
  });
}

export async function stopAdminServer(): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  server = null;
}


async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const authEnabled = isAdminAuthEnabled();

    if (url.pathname === '/api/auth/session' && req.method === 'GET') {
      return sendJson(res, 200, {
        authenticated: authEnabled ? isAuthenticated(req) : true,
        authEnabled,
      });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!authEnabled) {
        return sendJson(res, 200, { authenticated: true, authEnabled: false });
      }

      const body = await readJsonBody(req, AdminLoginBodySchema);

      if (!isPasswordValid(body.password)) {
        return sendJson(res, 401, { error: 'Invalid password' });
      }

      createSession(res);
      return sendJson(res, 200, { authenticated: true, authEnabled: true });
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      destroySession(req, res);
      return sendJson(res, 200, { authenticated: false, authEnabled });
    }

    if (authEnabled && url.pathname.startsWith('/api/') && !isAuthenticated(req)) {
      return sendJson(res, 401, { error: 'Authentication required', authRequired: true });
    }

    // Declarative dispatch: core routes, then worker apiRoutes (same matcher),
    // then the static/404 fallback. See registerCoreRoutes / dispatchWorkerRoutes.
    if (await getCoreRouter().dispatch(req, res, url)) return;
    if (await dispatchWorkerRoutes(req, res, url)) return;
    if (req.method === 'GET') {
      return serveStatic(url.pathname, res);
    }
    return sendJson(res, 404, { error: 'Not found' });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof BadRequestError) {
      return sendJson(res, err.statusCode, { error: message });
    }
    console.error('[Admin] Request failed:', err);
    return sendJson(res, 500, { error: message });
  }
}

// --- Declarative routing (CODE_ROADMAP.md Phase 1.1) -------------------------
// Core endpoints register into `registerCoreRoutes`; worker `apiRoutes` flow
// through the *same* HttpRouter via `dispatchWorkerRoutes`. The core no longer
// hard-codes a request dispatch ladder — it owns a mechanism that both core and
// worker capabilities contribute to identically.

let coreRouter: HttpRouter | null = null;
function getCoreRouter(): HttpRouter {
  if (!coreRouter) {
    coreRouter = new HttpRouter();
    registerCoreRoutes(coreRouter);
  }
  return coreRouter;
}

// Worker apiRoutes are dynamic (registered/removed as workers toggle), so they
// are matched per-request against the current registry — but through the same
// router matcher as core routes, not a bespoke lookup.
async function dispatchWorkerRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const routes = listRegisteredApiRoutes();
  if (routes.length === 0) return false;
  const router = new HttpRouter();
  for (const route of routes) {
    router.add(route.method, route.path, async (rq, rs, ctx) => {
      const response = await route.handle({
        req: rq,
        url: ctx.url,
        readJsonBody,
        getDashboardState: buildDashboardState,
      });
      sendJson(rs, response.status, response.body);
    });
  }
  return router.dispatch(req, res, url);
}




// The dashboard build lives next to the working directory in a repo checkout, but
// next to the compiled module when BFrost runs from an installed npm package
// (where cwd is the user's data home, e.g. ~/.bfrost).
let cachedFrontendDir: string | undefined;
function frontendDistDir(): string {
  if (!cachedFrontendDir) {
    const candidates = [
      path.join(process.cwd(), 'web/dist'),
      path.resolve(__dirname, '..', 'web', 'dist'),
    ];
    cachedFrontendDir =
      candidates.find((dir) => existsSync(path.join(dir, 'index.html'))) ?? candidates[0];
  }
  return cachedFrontendDir;
}

async function serveStatic(requestPath: string, res: ServerResponse): Promise<void> {
  const frontendDir = frontendDistDir();
  const assetPath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const normalized = path.normalize(assetPath);
  const resolved = path.resolve(frontendDir, normalized);

  if (!resolved.startsWith(path.resolve(frontendDir))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isFile()) {
      const body = await fs.readFile(resolved);
      res.writeHead(200, {
        'Content-Type': contentTypeFor(resolved),
        'Content-Length': body.length,
      });
      res.end(body);
      return;
    }
  } catch {
    // Fall through to index.html.
  }

  try {
    const indexHtml = await fs.readFile(path.join(frontendDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend not found. Run "npm run build" to generate the React dashboard.');
  }
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

