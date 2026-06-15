/**
 * Deterministic local-worker scaffolder.
 *
 * Turns a validated {@link WorkerScaffoldSpec} into the complete file set for a runnable local
 * worker — `worker.json`, `src/index.ts`, `dashboard.tsx`, `README.md`. Two callers share it so
 * their output never drifts:
 *   - the `bfrost new worker` CLI, which imports the compiled `dist/workers/scaffold.js` directly, and
 *   - the describe-a-worker endpoint, which fills a spec from an LLM and writes it under `workers/local/`.
 *
 * Design rule — keep this module import-light. It depends only on `node:fs` / `node:path` so the CLI
 * can load it without booting the server. No `config`, no db, no registry, no admin imports. The TS the
 * templates emit is never type-checked here (it lives in strings); it is compiled by esbuild and
 * validated by the loader/registry at install time, so the templates target the exact runtime shapes in
 * `src/workers/types.ts` and the `bfrost` SDK surface.
 *
 * The generated worker is intentionally a constrained v1: a single scheduled job that either produces an
 * Item Bus item (producer) or consumes one and writes an outcome (consumer). That is enough for the
 * "describe → worker running" moment; richer workers are authored by hand via the bfrost-worker-author skill.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type WorkerScaffoldRole = 'producer' | 'consumer';

export interface WorkerScaffoldSpec {
  /** Stable worker id, e.g. `local.standup-notes`. Must match /^[a-z0-9][a-z0-9._-]*$/. */
  id: string;
  /** Short technical name used in logs. */
  name: string;
  /** Plain-language name shown in user-facing surfaces. */
  displayName: string;
  /** One short paragraph: what the worker does. */
  description: string;
  /** One-sentence pitch for a non-developer. */
  tagline: string;
  /** Does the worker publish items to the bus, or consume them? */
  role: WorkerScaffoldRole;
  /** Item Bus item type the worker produces or subscribes to, e.g. `local.standup-notes.note`. */
  itemType: string;
  /** Cron expression for the scheduled job. */
  cron: string;
  /** The system prompt that steers the model on each run. */
  prompt: string;
}

export interface ScaffoldFile {
  /** Path relative to the worker directory. */
  relPath: string;
  contents: string;
}

export interface NormalizeResult {
  spec: WorkerScaffoldSpec;
}

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Coerce an arbitrary string into a valid, `local.`-prefixed worker id. */
export function toWorkerId(raw: string): string {
  let slug = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^local\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!slug) slug = 'worker';
  return `local.${slug}`;
}

/** The id without its `local.` prefix — used for folder names, route ids, and event names. */
export function workerSlug(id: string): string {
  return id.replace(/^local\./, '');
}

/**
 * Validate and fill in a partial spec, throwing on anything that cannot be made valid.
 * Callers (CLI and endpoint) pass loosely-typed input; this is the single gate before writing files.
 */
export function normalizeScaffoldSpec(input: Partial<WorkerScaffoldSpec>): WorkerScaffoldSpec {
  const role: WorkerScaffoldRole = input.role === 'consumer' ? 'consumer' : 'producer';
  const id = toWorkerId(input.id || input.name || 'worker');
  if (!ID_RE.test(id)) {
    throw new Error(`Could not derive a valid worker id from "${input.id ?? input.name ?? ''}".`);
  }
  const slug = workerSlug(id);
  const name = oneLine(input.name) || titleCase(slug);
  const displayName = oneLine(input.displayName) || name;
  const description = oneLine(input.description) || `${displayName} — a local BFrost worker.`;
  const tagline = oneLine(input.tagline) || description;
  const itemType = normalizeItemType(input.itemType, slug);
  const cron = oneLine(input.cron) || '0 9 * * *';
  const prompt = (input.prompt && String(input.prompt).trim())
    || `You are ${displayName}. ${description}`;

  return { id, name, displayName, description, tagline, role, itemType, cron, prompt };
}

function normalizeItemType(raw: string | undefined, slug: string): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  // A producer needs a namespaced type it owns; default to the worker's own namespace.
  // A consumer may subscribe to any existing type, so honour whatever was provided.
  if (cleaned) return cleaned;
  return `local.${slug}.item`;
}

function oneLine(value: string | undefined): string {
  // Collapse whitespace and strip sequences that would break the generated TypeScript when a
  // text field is interpolated into a template literal (`), a substitution (${), or a block
  // comment (*/). These fields are model-fed, so treat them as untrusted.
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[`]/g, "'")
    .replace(/\$\{/g, '(')
    .replace(/\*\//g, '*')
    .trim();
}

/**
 * Pull the first JSON object out of a model response that may be fenced in ```json … ``` or
 * wrapped in prose. Throws when no balanced object is present so the caller can retry/fail cleanly.
 */
export function extractJsonObject(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in model output.');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Turn a raw model response into a validated worker spec: extract the JSON object, ensure it is a
 * plain object (a bare string/array/garbage is rejected rather than silently defaulted), and
 * normalize it. Pure — used by the describe-a-worker endpoint and unit-tested without a model.
 */
export function specFromModelOutput(raw: string): WorkerScaffoldSpec {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model output was not a JSON object.');
  }
  return normalizeScaffoldSpec(parsed as Partial<WorkerScaffoldSpec>);
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Produce the full set of files for a worker, keyed by path relative to the worker directory. */
export function buildScaffoldFiles(spec: WorkerScaffoldSpec): ScaffoldFile[] {
  return [
    { relPath: 'worker.json', contents: renderWorkerJson(spec) },
    { relPath: path.join('src', 'index.ts'), contents: renderBackend(spec) },
    { relPath: 'dashboard.tsx', contents: renderDashboard(spec) },
    { relPath: 'README.md', contents: renderReadme(spec) },
  ];
}

/**
 * Write a freshly-scaffolded worker into `targetDir`. Refuses to write into a non-empty directory
 * so it can never clobber an existing worker. Returns the list of files written (relative paths).
 */
export async function writeWorkerScaffold(targetDir: string, spec: WorkerScaffoldSpec): Promise<string[]> {
  const resolved = path.resolve(targetDir);
  try {
    const existing = await fs.readdir(resolved);
    if (existing.length > 0) {
      throw new Error(`Target directory is not empty: ${resolved}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const files = buildScaffoldFiles(spec);
  for (const file of files) {
    const dest = path.join(resolved, file.relPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file.contents, 'utf8');
  }
  return files.map((file) => file.relPath);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function routeId(spec: WorkerScaffoldSpec): string {
  return `${workerSlug(spec.id)}-tab`;
}

function jobId(spec: WorkerScaffoldSpec): string {
  return `${workerSlug(spec.id)}-run`;
}

function renderWorkerJson(spec: WorkerScaffoldSpec): string {
  const manifest = {
    manifestVersion: 1,
    bfrostApiVersion: '0.1',
    id: spec.id,
    name: spec.name,
    displayName: spec.displayName,
    version: '0.1.0',
    description: spec.description,
    tagline: spec.tagline,
    owner: 'Created with BFrost',
    language: 'typescript',
    backendSource: 'src/index.ts',
    backendEntrypoint: 'dist/index.js',
    dashboardSource: 'dashboard.tsx',
    dashboardEntrypoint: 'dist/dashboard.js',
    dashboard: {
      routes: [
        {
          id: routeId(spec),
          label: spec.displayName,
          description: 'Latest runs and produced output.',
          tab: routeId(spec),
        },
      ],
    },
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

/** Shared manifest + module footer for both roles. */
function renderManifestFooter(spec: WorkerScaffoldSpec): string {
  return `
const manifest: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: WORKER_ID,
  name: ${JSON.stringify(spec.name)},
  displayName: ${JSON.stringify(spec.displayName)},
  version: '0.1.0',
  description: ${JSON.stringify(spec.description)},
  tagline: ${JSON.stringify(spec.tagline)},
  builtIn: false,
  jobs: [
    {
      id: JOB_ID,
      workerId: WORKER_ID,
      label: ${JSON.stringify(spec.displayName + ' run')},
      description: ${JSON.stringify(spec.description)},
      defaultEnabled: false,
      defaultCron: ${JSON.stringify(spec.cron)},
      defaultModelAlias: '',
      approvalRequiredDefault: false,
      approvalRequiredEditable: true,
      defaultPrompt: SYSTEM_PROMPT,
      prompt: {
        editable: true,
        helpText: 'This prompt steers what the job does on each run.',
      },
      paramsSchema: z.object({}).passthrough(),
      defaultParams: {},
      dashboardFields: [],
      run: async (modelId) => runJob(modelId),
    },
  ],
  dashboard: {
    routes: [
      {
        id: ${JSON.stringify(routeId(spec))},
        label: ${JSON.stringify(spec.displayName)},
        description: 'Latest runs and produced output.',
        tab: ${JSON.stringify(routeId(spec))},
      },
    ],
  },
};

const workerModule: BackendWorkerModule = {
  manifest,
  async loadDashboardData() {
    const kv = openWorkerKv(WORKER_ID);
    const runs = (await kv.get<RunRecord[]>('runs')) ?? [];
    return { runs };
  },
};

export default workerModule;
`;
}

function renderBackend(spec: WorkerScaffoldSpec): string {
  return spec.role === 'consumer' ? renderConsumerBackend(spec) : renderProducerBackend(spec);
}

function renderProducerBackend(spec: WorkerScaffoldSpec): string {
  const slug = workerSlug(spec.id);
  return `/**
 * ${spec.displayName} — a local BFrost producer worker scaffolded from a description.
 *
 * On each scheduled run it asks the configured model to produce content using SYSTEM_PROMPT,
 * then publishes the result to the Item Bus as a "${spec.itemType}" item so other workers
 * (or you, in the dashboard) can pick it up.
 */
import { z } from 'zod';
import { generateText } from 'ai';
import {
  findModel,
  getDefaultModel,
  getChatModel,
  openWorkerKv,
  publishItem,
  recordEventSafe,
  type BackendWorkerModule,
  type WorkerManifest,
} from 'bfrost';

const WORKER_ID = ${JSON.stringify(spec.id)};
const JOB_ID = ${JSON.stringify(jobId(spec))};
const ITEM_TYPE = ${JSON.stringify(spec.itemType)};
const SYSTEM_PROMPT = ${JSON.stringify(spec.prompt)};

interface RunRecord {
  at: string;
  status: 'ok' | 'failed';
  summary: string;
}

async function recordRun(record: RunRecord): Promise<void> {
  const kv = openWorkerKv(WORKER_ID);
  const runs = (await kv.get<RunRecord[]>('runs')) ?? [];
  runs.unshift(record);
  await kv.set('runs', runs.slice(0, 20));
}

async function runJob(modelId: string): Promise<{ summary: string; itemCount?: number }> {
  const model = findModel(modelId) ?? getDefaultModel();
  if (!model) {
    const summary = 'No model provider configured — add one in the Models tab, then run again.';
    await recordRun({ at: new Date().toISOString(), status: 'failed', summary });
    return { summary, itemCount: 0 };
  }
  try {
    const result = await generateText({
      model: getChatModel(model) as Parameters<typeof generateText>[0]['model'],
      system: SYSTEM_PROMPT,
      // /no_think keeps local reasoning models (Qwen3 etc.) from returning an empty body.
      prompt: '/no_think\\nProduce one item now.',
    });
    const text = result.text?.trim();
    if (!text) throw new Error('Model returned an empty response.');
    const title = (text.split('\\n').find((line) => line.trim()) ?? text).trim().slice(0, 120);
    const item = await publishItem({
      producerWorkerId: WORKER_ID,
      itemType: ITEM_TYPE,
      title,
      shortDesc: title,
      url: \`bfrost://\${WORKER_ID}/\${Date.now()}\`,
      payload: { text },
    });
    const summary = \`Published 1 ${spec.itemType} item: "\${title}".\`;
    await recordRun({ at: new Date().toISOString(), status: 'ok', summary });
    await recordEventSafe({
      type: '${slug}.published',
      message: summary,
      metadata: { workerId: WORKER_ID, itemId: item.id },
    });
    return { summary, itemCount: 1 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRun({ at: new Date().toISOString(), status: 'failed', summary: message });
    return { summary: message, itemCount: 0 };
  }
}
${renderManifestFooter(spec)}`;
}

function renderConsumerBackend(spec: WorkerScaffoldSpec): string {
  const slug = workerSlug(spec.id);
  return `/**
 * ${spec.displayName} — a local BFrost consumer worker scaffolded from a description.
 *
 * On each scheduled run it picks the oldest unhandled "${spec.itemType}" item from the Item Bus,
 * asks the configured model to act on it using SYSTEM_PROMPT, and records the outcome under this
 * worker's own metadata namespace (it never writes into another worker's slot).
 */
import { z } from 'zod';
import { generateText } from 'ai';
import {
  applyConsumerFailure,
  applyConsumerSuccess,
  findModel,
  getDefaultModel,
  getChatModel,
  listItemsForConsumer,
  loadQueue,
  openWorkerKv,
  recordEventSafe,
  saveQueue,
  withQueueLock,
  type BackendWorkerModule,
  type QueueItem,
  type WorkerManifest,
} from 'bfrost';

const WORKER_ID = ${JSON.stringify(spec.id)};
const JOB_ID = ${JSON.stringify(jobId(spec))};
const ITEM_TYPE = ${JSON.stringify(spec.itemType)};
const SYSTEM_PROMPT = ${JSON.stringify(spec.prompt)};

interface RunRecord {
  at: string;
  status: 'ok' | 'noop' | 'failed';
  summary: string;
}

async function recordRun(record: RunRecord): Promise<void> {
  const kv = openWorkerKv(WORKER_ID);
  const runs = (await kv.get<RunRecord[]>('runs')) ?? [];
  runs.unshift(record);
  await kv.set('runs', runs.slice(0, 20));
}

function itemContext(item: QueueItem): string {
  return [
    \`Title: \${item.title}\`,
    \`Summary: \${item.shortDesc}\`,
    \`URL: \${item.url}\`,
  ].join('\\n');
}

async function runJob(modelId: string): Promise<{ summary: string; itemCount?: number }> {
  const model = findModel(modelId) ?? getDefaultModel();
  if (!model) {
    const summary = 'No model provider configured — add one in the Models tab, then run again.';
    await recordRun({ at: new Date().toISOString(), status: 'failed', summary });
    return { summary, itemCount: 0 };
  }

  return withQueueLock(async () => {
    const candidates = await listItemsForConsumer(WORKER_ID, {
      itemType: ITEM_TYPE,
      states: ['queued', 'approved'],
      excludeAlreadyHandled: true,
    });
    const target = candidates[0];
    if (!target) {
      const summary = \`No unhandled ${spec.itemType} items to process.\`;
      await recordRun({ at: new Date().toISOString(), status: 'noop', summary });
      return { summary, itemCount: 0 };
    }

    try {
      const result = await generateText({
        model: getChatModel(model) as Parameters<typeof generateText>[0]['model'],
        system: SYSTEM_PROMPT,
        prompt: '/no_think\\n' + itemContext(target),
      });
      const output = result.text?.trim();
      if (!output) throw new Error('Model returned an empty response.');

      const queue = await loadQueue();
      const live = queue.find((it) => it.id === target.id);
      if (live) {
        applyConsumerSuccess(live, WORKER_ID, {
          metadata: { output, processedAt: new Date().toISOString() },
        });
        await saveQueue(queue);
      }

      const summary = \`Processed "\${target.title}".\`;
      await recordRun({ at: new Date().toISOString(), status: 'ok', summary });
      await recordEventSafe({
        type: '${slug}.processed',
        message: summary,
        metadata: { workerId: WORKER_ID, itemId: target.id },
      });
      return { summary, itemCount: 1 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const queue = await loadQueue();
      const live = queue.find((it) => it.id === target.id);
      if (live) {
        applyConsumerFailure(live, WORKER_ID, { errorMessage: message, maxAttempts: 3 });
        await saveQueue(queue);
      }
      await recordRun({ at: new Date().toISOString(), status: 'failed', summary: message });
      return { summary: message, itemCount: 0 };
    }
  });
}
${renderManifestFooter(spec)}`;
}

function renderDashboard(spec: WorkerScaffoldSpec): string {
  return `/**
 * ${spec.displayName} dashboard — runtime-loaded by BFrost. The host page provides React via
 * window.bfrost, so never bundle a duplicate React here. Reads only this worker's slice of the
 * dashboard payload (dashboard.workerData[WORKER_ID]) and tolerates missing data.
 */
const WORKER_ID = ${JSON.stringify(spec.id)};
const ROUTE_ID = ${JSON.stringify(routeId(spec))};

interface RunRecord {
  at?: string;
  status?: string;
  summary?: string;
}

function statusTone(status: string | undefined): 'good' | 'warning' | 'error' | 'muted' {
  if (status === 'ok') return 'good';
  if (status === 'failed') return 'error';
  if (status === 'noop') return 'muted';
  return 'warning';
}

function ${pascal(spec)}View(props: { ctx?: any }) {
  const ui = window.bfrost.ui;
  const ctx = props?.ctx ?? {};
  const slice = ctx?.dashboard?.workerData?.[WORKER_ID] ?? {};
  const runs: RunRecord[] = Array.isArray(slice.runs) ? slice.runs : [];

  return (
    <section className={ui.classes.panel}>
      <div className={ui.classes.panelHead}>
        <div>
          <p className={ui.classes.panelKicker}>${escapeJsx(spec.role === 'consumer' ? 'Consumer' : 'Producer')}</p>
          <h2>${escapeJsx(spec.displayName)}</h2>
        </div>
        <span className={ui.statusTone(runs.length ? statusTone(runs[0]?.status) : 'muted')}>
          {runs.length ? (runs[0]?.status ?? 'unknown') : 'no runs yet'}
        </span>
      </div>
      <div className={ui.classes.detailBody}>
        <p>${escapeJsx(spec.tagline)}</p>
        {runs.length === 0 ? (
          <p>No runs yet. Open the Jobs tab, enable this worker's job, and click <strong>Run now</strong> to see output here.</p>
        ) : (
          <ul>
            {runs.map((run, i) => (
              <li key={i}>
                <span className={ui.statusTone(statusTone(run.status))}>{run.status ?? '—'}</span>{' '}
                <span>{run.summary ?? ''}</span>{' '}
                <small>{run.at ?? ''}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

window.bfrost.registerDashboardView({
  workerId: WORKER_ID,
  kind: 'feature',
  surfaceIds: [ROUTE_ID],
  count: () => undefined,
  render: (ctx: any) => <${pascal(spec)}View ctx={ctx} />,
});

declare global {
  interface Window {
    bfrost: {
      registerDashboardView: (view: any) => void;
      ui: {
        classes: Record<string, string>;
        statusTone: (tone: 'good' | 'warning' | 'info' | 'muted' | 'error') => string;
      };
      [key: string]: any;
    };
  }
}
export {};
`;
}

function renderReadme(spec: WorkerScaffoldSpec): string {
  const verb = spec.role === 'consumer' ? 'consumes' : 'produces';
  return `# ${spec.displayName}

> ${spec.tagline}

${spec.description}

Scaffolded by BFrost. This is a local worker — it lives entirely under this directory and the core never references it by name.

## What it does

- **Role:** ${spec.role}
- **Item Bus:** ${verb} \`${spec.itemType}\` items.
- **Schedule:** runs on \`${spec.cron}\` once its job is enabled (jobs ship disabled by default).
- **Model:** uses your default model provider. The job prompt is editable in the **Jobs** tab.

## Configure & run

1. Open the **Workers** tab, find **${spec.displayName}**, and enable it.
2. Open the **Jobs** tab, enable the \`${jobId(spec)}\` job (and adjust its cron/prompt if you like).
3. Click **Run now** to trigger it immediately. Results appear on this worker's dashboard tab and in the event log.

## Files

- \`worker.json\` — manifest and entrypoints.
- \`src/index.ts\` — the backend module (manifest + job).
- \`dashboard.tsx\` — the dashboard tab (latest runs).

## Customise

Edit \`src/index.ts\` and save — if hot reload is enabled, BFrost recompiles and re-registers the worker without a restart. Otherwise disable/re-enable the worker (or restart) to pick up backend changes.
`;
}

function pascal(spec: WorkerScaffoldSpec): string {
  const base = workerSlug(spec.id)
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return /^[A-Za-z]/.test(base) ? base : `Worker${base}`;
}

function escapeJsx(value: string): string {
  return value.replace(/[<>{}]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '{': '&#123;', '}': '&#125;' }[ch]!));
}
