import { z } from 'zod';
import { generateText } from 'ai';
import type { AdminApiRoute, BackendWorkerModule, WorkerJobManifest, WorkerManifest } from 'bfrost';
import {
  BadRequestError,
  findModel,
  getChatModel,
  getJobPrompt,
  isModelProviderConfigured,
  openWorkerKv,
  publishItem,
  recordEventSafe,
} from 'bfrost';

const WORKER_ID = 'pr-review-digest';
const JOB_ID = 'pr-review-digest';
const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'history';
const LLM_TIMEOUT_MS = 120_000;
const GITHUB_API_DEFAULT = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 20_000;

const DEFAULT_PROMPT =
  'You are an engineering lead preparing a pull request review digest. ' +
  'For each PR in the structured data provided, report: title, author, ' +
  'how long it has been open, review status, CI status, and merge conflicts. ' +
  'Sort by oldest first. ' +
  'Mark as urgent any PR open longer than the staleDaysThreshold or with failing CI. ' +
  'If totalOpenPRs is 0, confirm briefly that there are no open PRs. ' +
  'Do not invent facts — use only the data provided.';

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

interface GitHubPR {
  number: number;
  title: string;
  user: { login: string };
  created_at: string;
  html_url: string;
  head: { sha: string; ref: string };
  base: { ref: string };
  draft: boolean;
  mergeable: boolean | null;
  mergeable_state: string | null;
}

interface GitHubReview {
  user: { login: string };
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submitted_at: string;
}

interface GitHubCheckRun {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'skipped'
    | 'timed_out'
    | 'action_required'
    | null;
}

interface GitHubCombinedStatus {
  state: 'pending' | 'success' | 'failure' | 'error';
  statuses: Array<{ state: string; context: string }>;
}

type ReviewStatus = 'approved' | 'changes_requested' | 'awaiting_review';
type CIStatus = 'passing' | 'failing' | 'pending' | 'unknown';
type MergeStatus = 'clean' | 'dirty' | 'blocked' | 'behind' | 'unknown';

export interface EnrichedPR {
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  draft: boolean;
  createdAt: string;
  ageDays: number;
  headBranch: string;
  baseBranch: string;
  reviewStatus: ReviewStatus;
  reviewers: Array<{ user: string; state: string }>;
  ciStatus: CIStatus;
  failingChecks: string[];
  mergeStatus: MergeStatus;
  isStale: boolean;
  hasFailingCI: boolean;
  needsAttention: boolean;
}

// ---------------------------------------------------------------------------
// Settings & job params
// ---------------------------------------------------------------------------

const SettingsSchema = z.object({
  repositories: z.string().default(''),
  githubApiBase: z.string().default(GITHUB_API_DEFAULT),
  bearerTokenEnv: z.string().default('GITHUB_TOKEN'),
  contextNotes: z.string().default(''),
  publishItems: z.boolean().default(true),
}).strict();

type AutomationSettings = z.infer<typeof SettingsSchema>;

const JobParamsSchema = z.object({
  staleDaysThreshold: z.number().int().min(1).max(30).catch(3),
  maxPRsPerRepo: z.number().int().min(1).max(100).catch(50),
  priorityThreshold: z.enum(['low', 'medium', 'high', 'urgent']).catch('medium'),
}).strict();

type JobParams = z.infer<typeof JobParamsSchema>;

// ---------------------------------------------------------------------------
// LLM output schema
// ---------------------------------------------------------------------------

type Priority = 'low' | 'medium' | 'high' | 'urgent';

interface DigestItem {
  title: string;
  priority: Priority;
  category: string;
  summary: string;
  action: string;
  source?: string;
}

const DigestItemSchema = z.object({
  title: z.string().min(1).max(200),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  category: z.string().min(1).max(80).default('PR review'),
  summary: z.string().min(1).max(800),
  action: z.string().min(1).max(500),
  source: z.string().optional(),
});

const LlmResultSchema = z.object({
  summary: z.string().min(1).max(1200),
  urgentCount: z.number().int().min(0).default(0),
  items: z.array(DigestItemSchema).default([]),
});

type LlmResult = z.infer<typeof LlmResultSchema>;

interface RunSummary {
  ranAt: string;
  repoCount: number;
  totalPRs: number;
  stalePRs: number;
  failingCIPRs: number;
  urgentCount: number;
  publishedCount: number;
  llmUsed: boolean;
  status: 'ok' | 'setup-needed' | 'partial' | 'error';
  summary: string;
  items: DigestItem[];
  prs: EnrichedPR[];
  errors: Array<{ repo: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

async function loadSettings(): Promise<AutomationSettings> {
  const stored = await openWorkerKv(WORKER_ID).get<Partial<AutomationSettings>>(SETTINGS_KEY);
  return SettingsSchema.parse(stored ?? {});
}

async function saveSettings(settings: AutomationSettings): Promise<AutomationSettings> {
  const parsed = SettingsSchema.parse(settings);
  await openWorkerKv(WORKER_ID).set(SETTINGS_KEY, parsed);
  return parsed;
}

function parsedRepos(settings: AutomationSettings): string[] {
  return settings.repositories.split('\n').map((r) => r.trim()).filter(Boolean);
}

function githubToken(settings: AutomationSettings): string {
  for (const envName of settings.bearerTokenEnv.split(',').map((s) => s.trim()).filter(Boolean)) {
    const val = process.env[envName]?.trim();
    if (val) return val;
  }
  return '';
}

function hasToken(settings: AutomationSettings): boolean {
  return Boolean(githubToken(settings));
}

// ---------------------------------------------------------------------------
// GitHub API client
// ---------------------------------------------------------------------------

async function githubFetch<T>(
  path: string,
  token: string,
  base = GITHUB_API_DEFAULT,
): Promise<T> {
  const url = `${base.replace(/\/$/, '')}${path}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status} for ${path}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

async function fetchOpenPRs(
  repo: string,
  settings: AutomationSettings,
  maxPRs: number,
): Promise<GitHubPR[]> {
  const token = githubToken(settings);
  const base = settings.githubApiBase;
  const prs: GitHubPR[] = [];
  let page = 1;
  const perPage = Math.min(maxPRs, 100);

  while (prs.length < maxPRs) {
    const batch = await githubFetch<GitHubPR[]>(
      `/repos/${repo}/pulls?state=open&per_page=${perPage}&page=${page}&sort=created&direction=asc`,
      token,
      base,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    prs.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }

  return prs.slice(0, maxPRs);
}

async function fetchReviews(
  repo: string,
  prNumber: number,
  settings: AutomationSettings,
): Promise<GitHubReview[]> {
  try {
    const token = githubToken(settings);
    const reviews = await githubFetch<GitHubReview[]>(
      `/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`,
      token,
      settings.githubApiBase,
    );
    return Array.isArray(reviews) ? reviews : [];
  } catch {
    return [];
  }
}

async function fetchCheckRuns(
  repo: string,
  sha: string,
  settings: AutomationSettings,
): Promise<GitHubCheckRun[]> {
  try {
    const token = githubToken(settings);
    const data = await githubFetch<{ check_runs: GitHubCheckRun[] }>(
      `/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
      token,
      settings.githubApiBase,
    );
    return Array.isArray(data?.check_runs) ? data.check_runs : [];
  } catch {
    return [];
  }
}

async function fetchCombinedStatus(
  repo: string,
  sha: string,
  settings: AutomationSettings,
): Promise<GitHubCombinedStatus | null> {
  try {
    const token = githubToken(settings);
    return await githubFetch<GitHubCombinedStatus>(
      `/repos/${repo}/commits/${sha}/status`,
      token,
      settings.githubApiBase,
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------

function deriveReviewStatus(reviews: GitHubReview[]): {
  status: ReviewStatus;
  reviewers: Array<{ user: string; state: string }>;
} {
  // Take the latest non-comment review per reviewer.
  const latestByReviewer = new Map<string, GitHubReview>();
  for (const r of reviews) {
    if (r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    const existing = latestByReviewer.get(r.user.login);
    if (!existing || r.submitted_at > existing.submitted_at) {
      latestByReviewer.set(r.user.login, r);
    }
  }

  const reviewers = Array.from(latestByReviewer.values()).map((r) => ({
    user: r.user.login,
    state: r.state,
  }));
  const states = reviewers.map((r) => r.state);

  let status: ReviewStatus = 'awaiting_review';
  if (states.some((s) => s === 'CHANGES_REQUESTED')) {
    status = 'changes_requested';
  } else if (states.length > 0 && states.every((s) => s === 'APPROVED')) {
    status = 'approved';
  }

  return { status, reviewers };
}

function deriveCIStatus(
  checkRuns: GitHubCheckRun[],
  combined: GitHubCombinedStatus | null,
): { status: CIStatus; failingChecks: string[] } {
  const failingChecks: string[] = [];

  for (const run of checkRuns) {
    if (
      run.status === 'completed' &&
      run.conclusion &&
      ['failure', 'timed_out', 'action_required'].includes(run.conclusion)
    ) {
      failingChecks.push(run.name);
    }
  }

  if (combined) {
    for (const s of combined.statuses ?? []) {
      if (['failure', 'error'].includes(s.state)) {
        if (!failingChecks.includes(s.context)) failingChecks.push(s.context);
      }
    }
  }

  if (failingChecks.length > 0) return { status: 'failing', failingChecks };

  const hasPending =
    checkRuns.some((r) => r.status !== 'completed') ||
    combined?.state === 'pending';

  if (hasPending) return { status: 'pending', failingChecks };
  if (checkRuns.length === 0 && (!combined || combined.statuses.length === 0)) {
    return { status: 'unknown', failingChecks };
  }
  return { status: 'passing', failingChecks };
}

function deriveMergeStatus(pr: GitHubPR): MergeStatus {
  const state = pr.mergeable_state;
  if (!state) return 'unknown';
  if (state === 'clean') return 'clean';
  if (state === 'dirty') return 'dirty';
  if (state === 'blocked') return 'blocked';
  if (state === 'behind') return 'behind';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Main data collection
// ---------------------------------------------------------------------------

async function enrichPR(
  repo: string,
  pr: GitHubPR,
  settings: AutomationSettings,
  staleDaysThreshold: number,
): Promise<EnrichedPR> {
  const [reviews, checkRuns, combined] = await Promise.all([
    fetchReviews(repo, pr.number, settings),
    fetchCheckRuns(repo, pr.head.sha, settings),
    fetchCombinedStatus(repo, pr.head.sha, settings),
  ]);

  const { status: reviewStatus, reviewers } = deriveReviewStatus(reviews);
  const { status: ciStatus, failingChecks } = deriveCIStatus(checkRuns, combined);
  const mergeStatus = deriveMergeStatus(pr);

  const ageDays = Math.floor(
    (Date.now() - new Date(pr.created_at).getTime()) / (1000 * 60 * 60 * 24),
  );
  const isStale = ageDays >= staleDaysThreshold;
  const hasFailingCI = ciStatus === 'failing';

  return {
    repo,
    number: pr.number,
    title: pr.title,
    author: pr.user.login,
    url: pr.html_url,
    draft: pr.draft,
    createdAt: pr.created_at,
    ageDays,
    headBranch: pr.head.ref,
    baseBranch: pr.base.ref,
    reviewStatus,
    reviewers,
    ciStatus,
    failingChecks,
    mergeStatus,
    isStale,
    hasFailingCI,
    needsAttention: isStale || hasFailingCI,
  };
}

async function fetchAllPRData(
  settings: AutomationSettings,
  params: JobParams,
): Promise<{
  prs: EnrichedPR[];
  errors: Array<{ repo: string; message: string }>;
}> {
  const repos = parsedRepos(settings);
  const allPRs: EnrichedPR[] = [];
  const errors: Array<{ repo: string; message: string }> = [];

  for (const repo of repos) {
    try {
      const rawPRs = await fetchOpenPRs(repo, settings, params.maxPRsPerRepo);

      // Enrich PRs concurrently (cap at 5 in-flight at once to respect rate limits).
      const enriched: EnrichedPR[] = [];
      const BATCH = 5;
      for (let i = 0; i < rawPRs.length; i += BATCH) {
        const batch = rawPRs.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map((pr) => enrichPR(repo, pr, settings, params.staleDaysThreshold)),
        );
        for (const result of results) {
          if (result.status === 'fulfilled') {
            enriched.push(result.value);
          } else {
            errors.push({ repo, message: String(result.reason) });
          }
        }
      }

      allPRs.push(...enriched);
    } catch (err) {
      errors.push({ repo, message: err instanceof Error ? err.message : String(err) });
    }
  }

  // Sort: oldest first.
  allPRs.sort((a, b) => a.ageDays - b.ageDays || a.number - b.number);

  return { prs: allPRs, errors };
}

// ---------------------------------------------------------------------------
// LLM analysis
// ---------------------------------------------------------------------------

function buildLlmPayload(
  prs: EnrichedPR[],
  settings: AutomationSettings,
  params: JobParams,
  errors: Array<{ repo: string; message: string }>,
) {
  return {
    staleDaysThreshold: params.staleDaysThreshold,
    repositories: parsedRepos(settings),
    totalOpenPRs: prs.length,
    stalePRs: prs.filter((p) => p.isStale).length,
    failingCIPRs: prs.filter((p) => p.hasFailingCI).length,
    operatorNotes: settings.contextNotes || null,
    fetchErrors: errors.length ? errors : null,
    prs: prs.map((pr) => ({
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      author: pr.author,
      ageDays: pr.ageDays,
      url: pr.url,
      draft: pr.draft,
      reviewStatus: pr.reviewStatus,
      reviewers: pr.reviewers,
      ciStatus: pr.ciStatus,
      failingChecks: pr.failingChecks.length ? pr.failingChecks : undefined,
      mergeStatus: pr.mergeStatus,
      isStale: pr.isStale,
      hasFailingCI: pr.hasFailingCI,
    })),
  };
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object in LLM output');
  return JSON.parse(text.slice(start, end + 1));
}

function fallbackResult(prs: EnrichedPR[]): LlmResult {
  if (prs.length === 0) {
    return { summary: 'No open pull requests found.', urgentCount: 0, items: [] };
  }
  const urgent = prs.filter((p) => p.needsAttention);
  const items: DigestItem[] = prs.map((pr) => ({
    title: `#${pr.number} ${pr.title}`,
    priority: pr.needsAttention ? (pr.hasFailingCI ? 'urgent' : 'high') : 'medium',
    category: pr.repo,
    summary: [
      `Author: ${pr.author}`,
      `Open ${pr.ageDays}d`,
      `Review: ${pr.reviewStatus.replace(/_/g, ' ')}`,
      `CI: ${pr.ciStatus}`,
      `Merge: ${pr.mergeStatus}`,
      pr.failingChecks.length ? `Failing: ${pr.failingChecks.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    action: pr.hasFailingCI
      ? 'Fix failing CI checks before merging.'
      : pr.reviewStatus === 'changes_requested'
        ? 'Address reviewer feedback.'
        : pr.isStale
          ? 'Review or close this stale PR.'
          : 'Awaiting review.',
    source: pr.url,
  }));
  return {
    summary: `${prs.length} open PR${prs.length === 1 ? '' : 's'} — ${urgent.length} need${urgent.length === 1 ? 's' : ''} attention.`,
    urgentCount: urgent.length,
    items,
  };
}

async function analyzeWithLlm(
  modelId: string,
  prs: EnrichedPR[],
  settings: AutomationSettings,
  params: JobParams,
  errors: Array<{ repo: string; message: string }>,
): Promise<{ result: LlmResult; llmUsed: boolean }> {
  const model = findModel(modelId);
  if (!model || !isModelProviderConfigured(model)) {
    return { result: fallbackResult(prs), llmUsed: false };
  }

  const system = await getJobPrompt(JOB_ID, DEFAULT_PROMPT);
  const payload = buildLlmPayload(prs, settings, params, errors);
  const prompt = [
    '/no_think',
    'Return only JSON: { "summary": "...", "urgentCount": 0, "items": [{ "title": "...", "priority": "low|medium|high|urgent", "category": "...", "summary": "...", "action": "...", "source": "..." }] }',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');

  const { text } = await generateText({
    model: getChatModel(model),
    system,
    prompt,
    abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  try {
    const parsed = LlmResultSchema.parse(extractJsonObject(text));
    const filtered = parsed.items
      .filter((item) => priorityRank(item.priority) >= priorityRank(params.priorityThreshold as Priority))
      .slice(0, 50);
    return {
      result: { summary: parsed.summary, urgentCount: parsed.urgentCount, items: filtered },
      llmUsed: true,
    };
  } catch {
    return { result: fallbackResult(prs), llmUsed: false };
  }
}

function priorityRank(p: Priority): number {
  return { low: 0, medium: 1, high: 2, urgent: 3 }[p] ?? 1;
}

// ---------------------------------------------------------------------------
// Job runner
// ---------------------------------------------------------------------------

async function runAutomation(
  modelId: string,
  params: JobParams,
): Promise<{ summary: string; itemCount: number }> {
  const settings = await loadSettings();
  const repos = parsedRepos(settings);

  if (repos.length === 0 && !settings.contextNotes.trim()) {
    return { summary: 'PR Review Digest: configure at least one repository slug (OWNER/REPO) in the Config tab.', itemCount: 0 };
  }

  const { prs, errors } = await fetchAllPRData(settings, params);
  const { result, llmUsed } = await analyzeWithLlm(modelId, prs, settings, params, errors);

  const stalePRs = prs.filter((p) => p.isStale).length;
  const failingCIPRs = prs.filter((p) => p.hasFailingCI).length;
  const now = new Date().toISOString();
  const status: RunSummary['status'] =
    repos.length === 0 && !settings.contextNotes.trim()
      ? 'setup-needed'
      : errors.length > 0 && prs.length === 0
        ? 'error'
        : errors.length > 0
          ? 'partial'
          : 'ok';

  let publishedCount = 0;
  if (settings.publishItems && result.items.length > 0) {
    await publishItem({
      producerWorkerId: WORKER_ID,
      itemType: 'dev.pr-review-digest',
      tags: ['github', 'pull-requests', 'review', status],
      title: 'PR review digest',
      shortDesc: result.summary,
      payload: {
        summary: result.summary,
        urgentCount: result.urgentCount,
        items: result.items,
        prs,
        status,
        repoCount: repos.length,
        totalPRs: prs.length,
        stalePRs,
        failingCIPRs,
        errors,
        generatedAt: now,
      },
      selectionReason: 'PR Review Digest generated this report from GitHub.',
    });
    publishedCount = 1;
  }

  const run: RunSummary = {
    ranAt: now,
    repoCount: repos.length,
    totalPRs: prs.length,
    stalePRs,
    failingCIPRs,
    urgentCount: result.urgentCount,
    publishedCount,
    llmUsed,
    status,
    summary: result.summary,
    items: result.items,
    prs,
    errors,
  };

  const kv = openWorkerKv(WORKER_ID);
  await kv.set('last-run', run);
  const history = ((await kv.get<RunSummary[]>(HISTORY_KEY)) ?? []).filter(Boolean).slice(0, 19);
  await kv.set(HISTORY_KEY, [run, ...history]);

  await recordEventSafe({
    category: 'worker',
    action: status === 'ok' ? `${WORKER_ID}_completed` : `${WORKER_ID}_${status}`,
    severity: status === 'ok' ? 'info' : 'warning',
    summary: result.summary,
    metadata: { workerId: WORKER_ID, jobId: JOB_ID, status, totalPRs: prs.length, urgentCount: result.urgentCount, errors },
  });

  return { summary: result.summary, itemCount: publishedCount };
}

// ---------------------------------------------------------------------------
// Worker module
// ---------------------------------------------------------------------------

const job: WorkerJobManifest = {
  id: JOB_ID,
  workerId: WORKER_ID,
  label: 'PR review digest',
  description: 'Fetches open PRs across configured repositories and reports review status, CI, and merge conflicts.',
  defaultEnabled: true,
  defaultCron: '0 20 * * 1-5',
  defaultModelAlias: '',
  approvalRequiredDefault: false,
  approvalRequiredEditable: false,
  defaultPrompt: DEFAULT_PROMPT,
  prompt: { editable: true, helpText: 'Tune how the worker evaluates PR data and writes the digest.' },
  paramsSchema: JobParamsSchema,
  defaultParams: { staleDaysThreshold: 3, maxPRsPerRepo: 50, priorityThreshold: 'medium' },
  dashboardFields: [
    {
      key: 'staleDaysThreshold',
      label: 'Stale after (days)',
      type: 'number',
      defaultValue: 3,
      min: 1,
      max: 30,
      helpText: 'PRs open longer than this are highlighted as stale.',
    },
    {
      key: 'maxPRsPerRepo',
      label: 'Max PRs per repo',
      type: 'number',
      defaultValue: 50,
      min: 1,
      max: 100,
      helpText: 'Maximum number of open PRs to fetch per repository.',
    },
    {
      key: 'priorityThreshold',
      label: 'Priority threshold',
      type: 'select',
      defaultValue: 'medium',
      options: [
        { value: 'low', label: 'Low and above' },
        { value: 'medium', label: 'Medium and above' },
        { value: 'high', label: 'High and above' },
        { value: 'urgent', label: 'Urgent only' },
      ],
      helpText: 'Filter lower-priority items out of the final digest.',
    },
  ],
  presets: [
    {
      id: 'daily-standup',
      label: 'Daily standup',
      description: 'Quick daily digest highlighting urgent items only.',
      cron: '0 9 * * 1-5',
      params: { staleDaysThreshold: 2, maxPRsPerRepo: 30, priorityThreshold: 'high' },
    },
    {
      id: 'weekly-sweep',
      label: 'Weekly sweep',
      description: 'Broader weekly review including all open PRs.',
      cron: '0 17 * * 5',
      params: { staleDaysThreshold: 5, maxPRsPerRepo: 100, priorityThreshold: 'low' },
    },
  ],
  run: async (modelId: string, params?: Record<string, unknown>) =>
    runAutomation(modelId, JobParamsSchema.parse(params ?? {})),
};

const manifest: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  bfrostEngineRange: '>=0.3.0',
  id: WORKER_ID,
  name: 'PR Review Digest',
  displayName: 'PR Review Digest',
  version: '0.2.0',
  description: 'Fetches open PRs across configured repositories and reports review status, CI, and merge conflicts.',
  tagline: 'Per-PR review status, CI results, and merge conflicts — sorted oldest-first, stale PRs highlighted.',
  owner: '@ccascio',
  builtIn: false,
  kind: 'feature',
  jobs: [job],
  chatPrompts: [
    {
      label: 'Latest report',
      description: 'Show the most recent PR digest.',
      prompt: 'Show me the latest PR Review Digest and any PRs that need immediate attention.',
    },
    {
      label: 'Setup help',
      description: 'Help connecting repositories.',
      prompt: 'Help me configure PR Review Digest — what do I put in the repositories field and where does the token go?',
    },
  ],
  ownedSettings: [
    {
      key: `${WORKER_ID}-config`,
      label: 'PR Review Digest repositories',
      description: 'GitHub repository slugs (OWNER/REPO) and credentials.',
      scope: 'worker',
      storageKey: `worker.${WORKER_ID}.settings`,
      dashboardTarget: 'config',
    },
    {
      key: `${WORKER_ID}-job`,
      label: 'PR review digest schedule',
      description: 'Cron, model, prompt, and run parameters.',
      scope: 'job',
      storageKey: `admin.settings.jobs.${JOB_ID}`,
      dashboardTarget: 'jobs',
    },
  ],
  dashboard: {
    settings: [
      {
        id: `${WORKER_ID}-config`,
        label: 'PR Review Digest repositories',
        description: 'GitHub repositories to scan and the token environment variable.',
        tab: 'config',
        path: `/api/workers/${WORKER_ID}/settings`,
        fields: [
          {
            key: 'repositories',
            label: 'Repositories',
            type: 'textarea' as const,
            defaultValue: '',
            rows: 6,
            placeholder: 'owner/repo\nowner/another-repo',
            helpText: 'One OWNER/REPO slug per line. The worker fetches all open PRs from each repository.',
            seedPath: `${WORKER_ID}.settings.repositories`,
          },
          {
            key: 'githubApiBase',
            label: 'GitHub API base URL',
            type: 'text' as const,
            defaultValue: GITHUB_API_DEFAULT,
            placeholder: GITHUB_API_DEFAULT,
            helpText: 'Leave as-is for github.com. Change to your GitHub Enterprise API URL if needed.',
            seedPath: `${WORKER_ID}.settings.githubApiBase`,
          },
          {
            key: 'bearerTokenEnv',
            label: 'Token env var name',
            type: 'text' as const,
            defaultValue: 'GITHUB_TOKEN',
            placeholder: 'GITHUB_TOKEN',
            helpText: 'Name of the environment variable holding your GitHub token (not the token itself). Add GITHUB_TOKEN=... to your .env file.',
            seedPath: `${WORKER_ID}.settings.bearerTokenEnv`,
          },
          {
            key: 'contextNotes',
            label: 'Context notes',
            type: 'textarea' as const,
            defaultValue: '',
            rows: 4,
            placeholder: 'Focus on PRs waiting on me. Ignore bot PRs from dependabot.',
            helpText: 'Optional instructions added to every LLM prompt run.',
            seedPath: `${WORKER_ID}.settings.contextNotes`,
          },
          {
            key: 'publishItems',
            label: 'Publish digest to Item Bus',
            type: 'boolean' as const,
            defaultValue: true,
            helpText: 'Each run publishes one dev.pr-review-digest item to the queue.',
          },
        ],
      },
    ],
    routes: [
      {
        id: `${WORKER_ID}-dashboard`,
        label: 'PRs',
        description: 'Open pull requests with review status, CI, and merge conflicts.',
        tab: 'worker',
        path: `/api/workers/${WORKER_ID}/dashboard`,
      },
    ],
  },
};

const routes: AdminApiRoute[] = [
  {
    method: 'GET',
    path: `/api/workers/${WORKER_ID}/settings`,
    workerIds: [WORKER_ID],
    handle: async () => ({ status: 200, body: await loadSettings() }),
  },
  {
    method: 'POST',
    path: `/api/workers/${WORKER_ID}/settings`,
    workerIds: [WORKER_ID],
    handle: async (ctx) => {
      const body = await ctx.readJsonBody(ctx.req, SettingsSchema);
      for (const repo of parsedRepos(body)) {
        if (!/^[^/]+\/[^/]+$/.test(repo)) {
          throw new BadRequestError(
            `Invalid repository format: "${repo}". Use OWNER/REPO (e.g. octocat/hello-world).`,
          );
        }
      }
      if (body.githubApiBase) {
        try {
          new URL(body.githubApiBase);
        } catch {
          throw new BadRequestError('GitHub API base URL is not a valid URL.');
        }
      }
      return { status: 200, body: await saveSettings(body) };
    },
  },
];

const module: BackendWorkerModule = {
  manifest,
  apiRoutes: routes,
  async loadDashboardData() {
    const kv = openWorkerKv(WORKER_ID);
    const [settings, lastRun, history] = await Promise.all([
      loadSettings(),
      kv.get<RunSummary>('last-run'),
      kv.get<RunSummary[]>(HISTORY_KEY),
    ]);
    return {
      settings,
      repoCount: parsedRepos(settings).length,
      tokenConfigured: hasToken(settings),
      lastRun: lastRun ?? null,
      history: Array.isArray(history) ? history.slice(0, 10) : [],
    };
  },
};

export default module;
