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

export async function searchGoogle(query: string, opts: SearchOptions = {}): Promise<SearchResult[]> {
  const { apiKey, engineId } = await resolveGoogleCredentials();
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

    https.get(url, (res) => {
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
    }).on('error', reject);
  });
}
