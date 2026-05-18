/**
 * Settings loader for the WordPress publisher. Persists in the per-worker KV under
 * `worker.local.publisher.wordpress.settings`. Secrets are stored alongside the rest of
 * the worker's KV — that means they live inside the same SQLite the host is already
 * backing up. If you'd rather keep the application password in `.env`, set
 * WORDPRESS_APPLICATION_PASSWORD and leave the manifest field blank.
 */

import { openWorkerKv } from 'bfrost';

export const CONSUMER_ID = 'local.publisher.wordpress';

export interface WpSettings {
  baseUrl: string;
  username: string;
  applicationPassword: string;
  defaultStatus: string;
  categorySlugs: string[];
  tagSlugs: string[];
  prompt: string;
  modelAlias: string;
}

const DEFAULTS: WpSettings = {
  baseUrl: '',
  username: '',
  applicationPassword: '',
  defaultStatus: 'draft',
  categorySlugs: [],
  tagSlugs: [],
  prompt: '',
  modelAlias: '',
};

function envFallback(value: string, envVar: string): string {
  if (value && value.trim()) return value.trim();
  const fromEnv = process.env[envVar];
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

export async function loadWpSettings(): Promise<WpSettings> {
  const kv = openWorkerKv(CONSUMER_ID);
  const stored = (await kv.get<Partial<WpSettings>>('settings')) ?? {};
  const merged: WpSettings = { ...DEFAULTS, ...stored };
  return {
    ...merged,
    baseUrl: envFallback(merged.baseUrl, 'WORDPRESS_BASE_URL'),
    username: envFallback(merged.username, 'WORDPRESS_USERNAME'),
    applicationPassword: envFallback(merged.applicationPassword, 'WORDPRESS_APPLICATION_PASSWORD'),
  };
}

export async function saveWpSettings(partial: Partial<WpSettings>): Promise<WpSettings> {
  const kv = openWorkerKv(CONSUMER_ID);
  const stored = (await kv.get<Partial<WpSettings>>('settings')) ?? {};
  const next: WpSettings = { ...DEFAULTS, ...stored, ...partial };
  await kv.set('settings', next);
  return next;
}
