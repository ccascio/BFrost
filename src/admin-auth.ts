// Admin auth: the session store + cookie/password helpers. Single owner of the
// sessions Map — imported by handleRequest (admin-server) and the core-settings
// route. Extracted from admin-server.ts (CODE_ROADMAP 1.1).
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

export const sessions = new Map<string, number>();
export const SESSION_COOKIE = 'bfrost_admin_session';

export function isAdminAuthEnabled(): boolean {
  return config.adminPassword.trim().length > 0;
}

export function isAuthenticated(req: IncomingMessage): boolean {
  pruneExpiredSessions();
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return false;
  }

  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }

  return true;
}

export function isPasswordValid(value: string): boolean {
  const expected = Buffer.from(config.adminPassword);
  const received = Buffer.from(value);
  if (expected.length === 0 || expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}

export function createSession(res: ServerResponse): void {
  pruneExpiredSessions();
  const token = randomBytes(24).toString('hex');
  const ttlMs = Math.max(config.adminSessionTtlHours, 1) * 60 * 60 * 1000;
  sessions.set(token, Date.now() + ttlMs);
  appendCookie(res, buildSessionCookie(token, ttlMs));
}

export function destroySession(req: IncomingMessage, res: ServerResponse): void {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (token) {
    sessions.delete(token);
  }
  appendCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function buildSessionCookie(token: string, ttlMs: number): string {
  const maxAge = Math.floor(ttlMs / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function appendCookie(res: ServerResponse, cookie: string): void {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }

  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookie]);
    return;
  }

  res.setHeader('Set-Cookie', [String(current), cookie]);
}

export function parseCookies(header: string): Record<string, string> {
  const entries = header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) {
        return [part, ''] as const;
      }
      return [part.slice(0, eq), decodeURIComponent(part.slice(eq + 1))] as const;
    });

  return Object.fromEntries(entries);
}

export function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [token, expiresAt] of sessions.entries()) {
    if (expiresAt <= now) {
      sessions.delete(token);
    }
  }
}
