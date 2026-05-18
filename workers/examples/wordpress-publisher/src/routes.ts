import { BadRequestError, openWorkerKv, type AdminApiRoute } from 'bfrost';
import { CONSUMER_ID, loadWpSettings, saveWpSettings } from './settings.js';
import { refreshTaxonomies } from './job.js';
import { ping } from './wp-client.js';

interface SaveBody {
  baseUrl?: string;
  username?: string;
  applicationPassword?: string;
  defaultStatus?: string;
  categorySlugs?: string[];
  tagSlugs?: string[];
  prompt?: string;
  modelAlias?: string;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value;
}

function readSlugList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const slug of value) {
    if (typeof slug !== 'string') continue;
    const trimmed = slug.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

export const wordpressRoutes: AdminApiRoute[] = [
  {
    method: 'GET',
    path: '/api/workers/local.publisher.wordpress/settings',
    workerIds: [CONSUMER_ID],
    handle: async () => {
      const settings = await loadWpSettings();
      return {
        status: 200,
        body: {
          ...settings,
          applicationPassword: settings.applicationPassword ? '••••••••' : '',
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/local.publisher.wordpress/settings',
    workerIds: [CONSUMER_ID],
    handle: async (ctx) => {
      const raw = await new Promise<unknown>((resolve, reject) => {
        const chunks: Buffer[] = [];
        ctx.req.on('data', (chunk: Buffer) => chunks.push(chunk));
        ctx.req.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!text) return resolve({});
          try {
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new BadRequestError('Invalid JSON body.'));
          }
        });
        ctx.req.on('error', reject);
      });
      const body = raw as SaveBody;

      const patch: SaveBody = {};
      if (readString(body.baseUrl) !== undefined) patch.baseUrl = (body.baseUrl ?? '').replace(/\/+$/, '');
      if (readString(body.username) !== undefined) patch.username = body.username;
      // Only overwrite the stored password when the form sent a non-masked value.
      if (readString(body.applicationPassword) !== undefined && body.applicationPassword !== '••••••••') {
        patch.applicationPassword = body.applicationPassword;
      }
      if (readString(body.defaultStatus) !== undefined) patch.defaultStatus = body.defaultStatus;
      const cats = readSlugList(body.categorySlugs);
      if (cats !== undefined) patch.categorySlugs = cats;
      const tags = readSlugList(body.tagSlugs);
      if (tags !== undefined) patch.tagSlugs = tags;
      if (readString(body.prompt) !== undefined) patch.prompt = body.prompt;
      if (readString(body.modelAlias) !== undefined) patch.modelAlias = body.modelAlias;

      const saved = await saveWpSettings(patch);

      // Best-effort taxonomy refresh on save. Failures are surfaced in the response
      // but never block the save itself, so a wrong-password save can be corrected
      // without losing the field values.
      let taxonomies: { categories: number; tags: number } | null = null;
      let refreshError: string | undefined;
      try {
        taxonomies = await refreshTaxonomies();
      } catch (err) {
        refreshError = err instanceof Error ? err.message : String(err);
      }

      return {
        status: 200,
        body: {
          settings: { ...saved, applicationPassword: saved.applicationPassword ? '••••••••' : '' },
          taxonomies,
          refreshError,
        },
      };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/local.publisher.wordpress/refresh-taxonomies',
    workerIds: [CONSUMER_ID],
    handle: async () => {
      const result = await refreshTaxonomies();
      return { status: 200, body: result };
    },
  },
  {
    method: 'GET',
    path: '/api/workers/local.publisher.wordpress/taxonomies',
    workerIds: [CONSUMER_ID],
    handle: async () => {
      const kv = openWorkerKv(CONSUMER_ID);
      const [categories, tags, refreshedAt] = await Promise.all([
        kv.get('categories'),
        kv.get('tags'),
        kv.get<string>('taxonomies-refreshed-at'),
      ]);
      return { status: 200, body: { categories: categories ?? [], tags: tags ?? [], refreshedAt: refreshedAt ?? null } };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/local.publisher.wordpress/ping',
    workerIds: [CONSUMER_ID],
    handle: async () => {
      const settings = await loadWpSettings();
      if (!settings.baseUrl || !settings.username || !settings.applicationPassword) {
        throw new BadRequestError('Set base URL, username, and application password before pinging.');
      }
      const auth = {
        baseUrl: settings.baseUrl,
        username: settings.username,
        applicationPassword: settings.applicationPassword,
      };
      const me = await ping(auth);
      return { status: 200, body: me };
    },
  },
];
