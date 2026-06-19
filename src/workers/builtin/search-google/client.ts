import https from 'https';
import { config } from '../../../config';
import { openWorkerKv } from '../../storage';

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export interface SearchOptions {
  num?: number;
  dateRestrict?: string;
  sort?: string;
}

const CREDS_KV_KEY = 'credentials';

interface StoredGoogleCredentials {
  googleApiKey?: string;
  googleSearchEngineId?: string;
}

const kv = openWorkerKv('core.search.google');

/**
 * Resolve Google credentials. The configuration panel is the source of truth; values
 * written from the dashboard land in the worker KV via `setStoredGoogleCredentials`.
 * `.env` (via `config.*`) is only consulted as a first-boot fallback so the user can
 * still bootstrap credentials before the dashboard has run.
 */
export async function resolveGoogleCredentials(): Promise<{ apiKey: string; engineId: string }> {
  const stored = (await kv.get<StoredGoogleCredentials>(CREDS_KV_KEY)) ?? {};
  return {
    apiKey: stored.googleApiKey?.trim() || config.googleApiKey,
    engineId: stored.googleSearchEngineId?.trim() || config.googleSearchEngineId,
  };
}

export async function setStoredGoogleCredentials(values: StoredGoogleCredentials): Promise<void> {
  const current = (await kv.get<StoredGoogleCredentials>(CREDS_KV_KEY)) ?? {};
  const next: StoredGoogleCredentials = { ...current };
  if (values.googleApiKey !== undefined) next.googleApiKey = values.googleApiKey;
  if (values.googleSearchEngineId !== undefined) next.googleSearchEngineId = values.googleSearchEngineId;
  await kv.set(CREDS_KV_KEY, next);
}

const SEARCH_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [2_000, 6_000]; // two retries: ~2 s then ~6 s
const RETRYABLE_CODES = new Set(['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN']);

function isRetryable(err: unknown): boolean {
  return err instanceof Error && RETRYABLE_CODES.has((err as NodeJS.ErrnoException).code ?? '');
}

function searchGoogleOnce(apiKey: string, engineId: string, query: string, opts: SearchOptions): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      key: apiKey,
      cx: engineId,
      q: query,
      num: String(opts.num ?? 5),
    });
    if (opts.dateRestrict) params.set('dateRestrict', opts.dateRestrict);
    if (opts.sort) params.set('sort', opts.sort);

    const url = `https://www.googleapis.com/customsearch/v1?${params}`;

    const req = https.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Google CSE HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          const data = JSON.parse(body);
          const results: SearchResult[] = (data.items || []).map((item: any) => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
          }));
          resolve(results);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });

    req.setTimeout(SEARCH_TIMEOUT_MS, () => {
      req.destroy(Object.assign(new Error('Google CSE request timed out'), { code: 'ETIMEDOUT' }));
    });

    req.on('error', reject);
  });
}

export async function searchGoogle(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const { apiKey, engineId } = await resolveGoogleCredentials();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await searchGoogleOnce(apiKey, engineId, query, opts);
    } catch (err) {
      lastErr = err;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isRetryable(err)) break;
      console.warn(`[searchGoogle] Transient error (attempt ${attempt + 1}), retrying in ${delay}ms:`, (err as Error).message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
