import { promises as fs } from 'fs';
import path from 'path';
import cron from 'node-cron';
import { config, findModel, setActiveLocalProviderId, setPrimaryChannelId } from './config';
import { JobName, knownJobs } from './job-runner';
import { getWorkerJob, jobLabels as registryJobLabels } from './workers/registry';
import { loadKvJson, saveKvJson } from './sqlite';

const ADMIN_SETTINGS_STORE_KEY = 'admin.settings';

export interface CronJobSettings {
  enabled: boolean;
  cron: string;
  modelAlias: string;
  approvalRequired: boolean;
  prompt: string;
  params?: Record<string, unknown>;
}

export interface PlatformSettings {
  /** Worker-provider id selected as the active local runtime. */
  activeLocalProviderId: string;
  /** Worker-channel id selected as the primary recipient for operator notifications. */
  primaryChannelId: string;
  /** Whether recent schedules missed while offline/asleep should run automatically. */
  automaticMissedRunRecovery: boolean;
}

export interface AdminSettings {
  timezone: string;
  jobs: Record<JobName, CronJobSettings>;
  platform: PlatformSettings;
}

export interface PlatformSettingsUpdate {
  activeLocalProviderId?: string;
  primaryChannelId?: string;
  automaticMissedRunRecovery?: boolean;
}

export interface CronJobUpdate {
  enabled?: boolean;
  cron?: string;
  modelAlias?: string;
  approvalRequired?: boolean;
  prompt?: string;
  params?: Record<string, unknown>;
}

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export function adminSettingsPath(): string {
  return path.join(config.adminStoreDir, 'settings.json');
}

export function schedulerStatePath(): string {
  return path.join(config.adminStoreDir, 'scheduler-state.json');
}

export async function loadAdminSettings(): Promise<AdminSettings> {
  const stored = await loadKvJson<Partial<AdminSettings>>(ADMIN_SETTINGS_STORE_KEY);
  if (stored !== null) {
    const settings = normalizeSettings(stored);
    await saveAdminSettings(settings);
    return settings;
  }

  try {
    const raw = await fs.readFile(adminSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AdminSettings>;
    const settings = normalizeSettings(parsed);
    await saveAdminSettings(settings);
    return settings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[Admin] Failed to read settings.json; using defaults:', err);
    }
    return normalizeSettings({});
  }
}

export async function saveAdminSettings(settings: AdminSettings): Promise<void> {
  await saveKvJson(ADMIN_SETTINGS_STORE_KEY, settings);
}

export async function updateAdminJob(name: JobName, patch: CronJobUpdate): Promise<AdminSettings> {
  const settings = await loadAdminSettings();
  const current = settings.jobs[name];
  const next: CronJobSettings = {
    enabled: patch.enabled ?? current.enabled,
    cron: patch.cron?.trim() ?? current.cron,
    modelAlias: patch.modelAlias?.trim() ?? current.modelAlias,
    approvalRequired: patch.approvalRequired ?? current.approvalRequired,
    prompt: patch.prompt ?? current.prompt,
    params: patch.params !== undefined ? patch.params : current.params,
  };

  validateJobSettings(name, next);
  next.params = getWorkerJob(name).paramsSchema.parse(next.params ?? {}) as Record<string, unknown>;

  settings.jobs[name] = next;
  await saveAdminSettings(settings);
  return settings;
}

function normalizeSettings(input: Partial<AdminSettings>): AdminSettings {
  const timezone =
    typeof input.timezone === 'string' && input.timezone.trim() ? input.timezone.trim() : DEFAULT_TIMEZONE;

  const jobs = {} as Record<JobName, CronJobSettings>;
  for (const jobName of knownJobs()) {
    const manifest = getWorkerJob(jobName);
    const candidate = input.jobs?.[jobName];
    jobs[jobName] = {
      enabled: typeof candidate?.enabled === 'boolean' ? candidate.enabled : manifest.defaultEnabled,
      cron: typeof candidate?.cron === 'string' && candidate.cron.trim() ? candidate.cron.trim() : manifest.defaultCron,
      modelAlias: normalizeModelAlias(
        typeof candidate?.modelAlias === 'string' ? candidate.modelAlias : manifest.defaultModelAlias,
      ),
      approvalRequired:
        typeof candidate?.approvalRequired === 'boolean'
          ? candidate.approvalRequired
          : manifest.approvalRequiredDefault,
      prompt:
        typeof candidate?.prompt === 'string' && candidate.prompt.trim()
          ? candidate.prompt
          : manifest.defaultPrompt,
      params: candidate?.params && typeof candidate.params === 'object'
        ? (() => {
            const result = manifest.paramsSchema.safeParse(candidate.params);
            if (!result.success) {
              console.warn(`[Admin] Stored params for job "${jobName}" are incompatible with the current schema (likely a schema change); resetting to defaults.`);
              return manifest.defaultParams;
            }
            return result.data as Record<string, unknown>;
          })()
        : manifest.defaultParams,
    };
    validateJobSettings(jobName, jobs[jobName]);
  }

  if (input.jobs && typeof input.jobs === 'object') {
    for (const [jobName, candidate] of Object.entries(input.jobs)) {
      if (knownJobs().includes(jobName)) {
        continue;
      }
      const normalized = normalizeUnknownJobSettings(jobName, candidate);
      if (normalized) {
        jobs[jobName] = normalized;
      }
    }
  }

  const platform: PlatformSettings = {
    activeLocalProviderId:
      typeof input.platform?.activeLocalProviderId === 'string' && input.platform.activeLocalProviderId.trim()
        ? input.platform.activeLocalProviderId.trim()
        : config.activeLocalProviderId,
    primaryChannelId:
      typeof input.platform?.primaryChannelId === 'string' && input.platform.primaryChannelId.trim()
        ? input.platform.primaryChannelId.trim()
        : config.primaryChannelId,
    automaticMissedRunRecovery: input.platform?.automaticMissedRunRecovery === true,
  };

  return { timezone, jobs, platform };
}

function normalizeModelAlias(value: string | undefined): string {
  const modelAlias = value?.trim() ?? '';
  if (!modelAlias) return '';
  return findModel(modelAlias) ? modelAlias : '';
}

/**
 * Apply persisted platform settings to the in-memory config. Call at boot after loading
 * admin settings so subsequent reads of `config.activeLocalProviderId` / `primaryChannelId`
 * reflect the persisted choice.
 */
export function applyPlatformSettingsToConfig(settings: PlatformSettings): void {
  setActiveLocalProviderId(settings.activeLocalProviderId);
  setPrimaryChannelId(settings.primaryChannelId);
}

export async function updatePlatformSettings(patch: PlatformSettingsUpdate): Promise<AdminSettings> {
  const settings = await loadAdminSettings();
  const next: PlatformSettings = {
    activeLocalProviderId: patch.activeLocalProviderId?.trim() || settings.platform.activeLocalProviderId,
    primaryChannelId: patch.primaryChannelId?.trim() || settings.platform.primaryChannelId,
    automaticMissedRunRecovery: patch.automaticMissedRunRecovery ?? settings.platform.automaticMissedRunRecovery,
  };
  settings.platform = next;
  await saveAdminSettings(settings);
  applyPlatformSettingsToConfig(next);
  return settings;
}

function validateJobSettings(name: JobName, value: CronJobSettings): void {
  if (!cron.validate(value.cron)) {
    throw new Error(`Invalid cron expression for ${name}: ${value.cron}`);
  }
  if (value.modelAlias && !findModel(value.modelAlias)) {
    throw new Error(`Unknown model alias for ${name}: ${value.modelAlias}`);
  }
  if (value.prompt.length > 12000) {
    throw new Error(`Prompt for ${name} is too long. Keep it under 12000 characters.`);
  }
  getWorkerJob(name).paramsSchema.parse(value.params ?? {});
}

function normalizeUnknownJobSettings(name: string, value: unknown): CronJobSettings | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<CronJobSettings>;
  const fallbackCron = '0 0 * * *';
  const cronValue = typeof candidate.cron === 'string' && cron.validate(candidate.cron)
    ? candidate.cron.trim()
    : fallbackCron;

  return {
    enabled: false,
    cron: cronValue,
    modelAlias: normalizeModelAlias(candidate.modelAlias),
    approvalRequired: typeof candidate.approvalRequired === 'boolean' ? candidate.approvalRequired : false,
    prompt: typeof candidate.prompt === 'string' ? candidate.prompt.slice(0, 12000) : '',
    params: candidate.params && typeof candidate.params === 'object'
      ? candidate.params as Record<string, unknown>
      : undefined,
  };
}

export function jobLabels(): Record<JobName, string> {
  return registryJobLabels();
}
