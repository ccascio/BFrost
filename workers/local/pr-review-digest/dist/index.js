"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);
var import_zod = require("zod");
var import_ai = require("ai");
var import_bfrost = require("bfrost");
var WORKER_ID = "pr-review-digest";
var JOB_ID = "pr-review-digest";
var SETTINGS_KEY = "settings";
var HISTORY_KEY = "history";
var LLM_TIMEOUT_MS = 12e4;
var GITHUB_API_DEFAULT = "https://api.github.com";
var FETCH_TIMEOUT_MS = 2e4;
var DEFAULT_PROMPT = "You are an engineering lead preparing a pull request review digest. For each PR in the structured data provided, report: title, author, how long it has been open, review status, CI status, and merge conflicts. Sort by oldest first. Mark as urgent any PR open longer than the staleDaysThreshold or with failing CI. If totalOpenPRs is 0, confirm briefly that there are no open PRs. Do not invent facts \u2014 use only the data provided.";
var SettingsSchema = import_zod.z.object({
  repositories: import_zod.z.string().default(""),
  githubApiBase: import_zod.z.string().default(GITHUB_API_DEFAULT),
  bearerTokenEnv: import_zod.z.string().default("GITHUB_TOKEN"),
  contextNotes: import_zod.z.string().default(""),
  publishItems: import_zod.z.boolean().default(true)
}).strict();
var JobParamsSchema = import_zod.z.object({
  staleDaysThreshold: import_zod.z.number().int().min(1).max(30).catch(3),
  maxPRsPerRepo: import_zod.z.number().int().min(1).max(100).catch(50),
  priorityThreshold: import_zod.z.enum(["low", "medium", "high", "urgent"]).catch("medium")
}).strict();
var DigestItemSchema = import_zod.z.object({
  title: import_zod.z.string().min(1).max(200),
  priority: import_zod.z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  category: import_zod.z.string().min(1).max(80).default("PR review"),
  summary: import_zod.z.string().min(1).max(800),
  action: import_zod.z.string().min(1).max(500),
  source: import_zod.z.string().optional()
});
var LlmResultSchema = import_zod.z.object({
  summary: import_zod.z.string().min(1).max(1200),
  urgentCount: import_zod.z.number().int().min(0).default(0),
  items: import_zod.z.array(DigestItemSchema).default([])
});
async function loadSettings() {
  const stored = await (0, import_bfrost.openWorkerKv)(WORKER_ID).get(SETTINGS_KEY);
  return SettingsSchema.parse(stored ?? {});
}
async function saveSettings(settings) {
  const parsed = SettingsSchema.parse(settings);
  await (0, import_bfrost.openWorkerKv)(WORKER_ID).set(SETTINGS_KEY, parsed);
  return parsed;
}
function parsedRepos(settings) {
  return settings.repositories.split("\n").map((r) => r.trim()).filter(Boolean);
}
function githubToken(settings) {
  for (const envName of settings.bearerTokenEnv.split(",").map((s) => s.trim()).filter(Boolean)) {
    const val = process.env[envName]?.trim();
    if (val) return val;
  }
  return "";
}
function hasToken(settings) {
  return Boolean(githubToken(settings));
}
async function githubFetch(path, token, base = GITHUB_API_DEFAULT) {
  const url = `${base.replace(/\/$/, "")}${path}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}
async function fetchOpenPRs(repo, settings, maxPRs) {
  const token = githubToken(settings);
  const base = settings.githubApiBase;
  const prs = [];
  let page = 1;
  const perPage = Math.min(maxPRs, 100);
  while (prs.length < maxPRs) {
    const batch = await githubFetch(
      `/repos/${repo}/pulls?state=open&per_page=${perPage}&page=${page}&sort=created&direction=asc`,
      token,
      base
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    prs.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return prs.slice(0, maxPRs);
}
async function fetchReviews(repo, prNumber, settings) {
  try {
    const token = githubToken(settings);
    const reviews = await githubFetch(
      `/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`,
      token,
      settings.githubApiBase
    );
    return Array.isArray(reviews) ? reviews : [];
  } catch {
    return [];
  }
}
async function fetchCheckRuns(repo, sha, settings) {
  try {
    const token = githubToken(settings);
    const data = await githubFetch(
      `/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
      token,
      settings.githubApiBase
    );
    return Array.isArray(data?.check_runs) ? data.check_runs : [];
  } catch {
    return [];
  }
}
async function fetchCombinedStatus(repo, sha, settings) {
  try {
    const token = githubToken(settings);
    return await githubFetch(
      `/repos/${repo}/commits/${sha}/status`,
      token,
      settings.githubApiBase
    );
  } catch {
    return null;
  }
}
function deriveReviewStatus(reviews) {
  const latestByReviewer = /* @__PURE__ */ new Map();
  for (const r of reviews) {
    if (r.state === "COMMENTED" || r.state === "PENDING") continue;
    const existing = latestByReviewer.get(r.user.login);
    if (!existing || r.submitted_at > existing.submitted_at) {
      latestByReviewer.set(r.user.login, r);
    }
  }
  const reviewers = Array.from(latestByReviewer.values()).map((r) => ({
    user: r.user.login,
    state: r.state
  }));
  const states = reviewers.map((r) => r.state);
  let status = "awaiting_review";
  if (states.some((s) => s === "CHANGES_REQUESTED")) {
    status = "changes_requested";
  } else if (states.length > 0 && states.every((s) => s === "APPROVED")) {
    status = "approved";
  }
  return { status, reviewers };
}
function deriveCIStatus(checkRuns, combined) {
  const failingChecks = [];
  for (const run of checkRuns) {
    if (run.status === "completed" && run.conclusion && ["failure", "timed_out", "action_required"].includes(run.conclusion)) {
      failingChecks.push(run.name);
    }
  }
  if (combined) {
    for (const s of combined.statuses ?? []) {
      if (["failure", "error"].includes(s.state)) {
        if (!failingChecks.includes(s.context)) failingChecks.push(s.context);
      }
    }
  }
  if (failingChecks.length > 0) return { status: "failing", failingChecks };
  const hasPending = checkRuns.some((r) => r.status !== "completed") || combined?.state === "pending";
  if (hasPending) return { status: "pending", failingChecks };
  if (checkRuns.length === 0 && (!combined || combined.statuses.length === 0)) {
    return { status: "unknown", failingChecks };
  }
  return { status: "passing", failingChecks };
}
function deriveMergeStatus(pr) {
  const state = pr.mergeable_state;
  if (!state) return "unknown";
  if (state === "clean") return "clean";
  if (state === "dirty") return "dirty";
  if (state === "blocked") return "blocked";
  if (state === "behind") return "behind";
  return "unknown";
}
async function enrichPR(repo, pr, settings, staleDaysThreshold) {
  const [reviews, checkRuns, combined] = await Promise.all([
    fetchReviews(repo, pr.number, settings),
    fetchCheckRuns(repo, pr.head.sha, settings),
    fetchCombinedStatus(repo, pr.head.sha, settings)
  ]);
  const { status: reviewStatus, reviewers } = deriveReviewStatus(reviews);
  const { status: ciStatus, failingChecks } = deriveCIStatus(checkRuns, combined);
  const mergeStatus = deriveMergeStatus(pr);
  const ageDays = Math.floor(
    (Date.now() - new Date(pr.created_at).getTime()) / (1e3 * 60 * 60 * 24)
  );
  const isStale = ageDays >= staleDaysThreshold;
  const hasFailingCI = ciStatus === "failing";
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
    needsAttention: isStale || hasFailingCI
  };
}
async function fetchAllPRData(settings, params) {
  const repos = parsedRepos(settings);
  const allPRs = [];
  const errors = [];
  for (const repo of repos) {
    try {
      const rawPRs = await fetchOpenPRs(repo, settings, params.maxPRsPerRepo);
      const enriched = [];
      const BATCH = 5;
      for (let i = 0; i < rawPRs.length; i += BATCH) {
        const batch = rawPRs.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map((pr) => enrichPR(repo, pr, settings, params.staleDaysThreshold))
        );
        for (const result of results) {
          if (result.status === "fulfilled") {
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
  allPRs.sort((a, b) => a.ageDays - b.ageDays || a.number - b.number);
  return { prs: allPRs, errors };
}
function buildLlmPayload(prs, settings, params, errors) {
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
      failingChecks: pr.failingChecks.length ? pr.failingChecks : void 0,
      mergeStatus: pr.mergeStatus,
      isStale: pr.isStale,
      hasFailingCI: pr.hasFailingCI
    }))
  };
}
function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in LLM output");
  return JSON.parse(text.slice(start, end + 1));
}
function fallbackResult(prs) {
  if (prs.length === 0) {
    return { summary: "No open pull requests found.", urgentCount: 0, items: [] };
  }
  const urgent = prs.filter((p) => p.needsAttention);
  const items = prs.map((pr) => ({
    title: `#${pr.number} ${pr.title}`,
    priority: pr.needsAttention ? pr.hasFailingCI ? "urgent" : "high" : "medium",
    category: pr.repo,
    summary: [
      `Author: ${pr.author}`,
      `Open ${pr.ageDays}d`,
      `Review: ${pr.reviewStatus.replace(/_/g, " ")}`,
      `CI: ${pr.ciStatus}`,
      `Merge: ${pr.mergeStatus}`,
      pr.failingChecks.length ? `Failing: ${pr.failingChecks.join(", ")}` : null
    ].filter(Boolean).join(" \xB7 "),
    action: pr.hasFailingCI ? "Fix failing CI checks before merging." : pr.reviewStatus === "changes_requested" ? "Address reviewer feedback." : pr.isStale ? "Review or close this stale PR." : "Awaiting review.",
    source: pr.url
  }));
  return {
    summary: `${prs.length} open PR${prs.length === 1 ? "" : "s"} \u2014 ${urgent.length} need${urgent.length === 1 ? "s" : ""} attention.`,
    urgentCount: urgent.length,
    items
  };
}
async function analyzeWithLlm(modelId, prs, settings, params, errors) {
  const model = (0, import_bfrost.findModel)(modelId);
  if (!model || !(0, import_bfrost.isModelProviderConfigured)(model)) {
    return { result: fallbackResult(prs), llmUsed: false };
  }
  const system = await (0, import_bfrost.getJobPrompt)(JOB_ID, DEFAULT_PROMPT);
  const payload = buildLlmPayload(prs, settings, params, errors);
  const prompt = [
    "/no_think",
    'Return only JSON: { "summary": "...", "urgentCount": 0, "items": [{ "title": "...", "priority": "low|medium|high|urgent", "category": "...", "summary": "...", "action": "...", "source": "..." }] }',
    "",
    JSON.stringify(payload, null, 2)
  ].join("\n");
  const { text } = await (0, import_ai.generateText)({
    model: (0, import_bfrost.getChatModel)(model),
    system,
    prompt,
    abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS)
  });
  try {
    const parsed = LlmResultSchema.parse(extractJsonObject(text));
    const filtered = parsed.items.filter((item) => priorityRank(item.priority) >= priorityRank(params.priorityThreshold)).slice(0, 50);
    return {
      result: { summary: parsed.summary, urgentCount: parsed.urgentCount, items: filtered },
      llmUsed: true
    };
  } catch {
    return { result: fallbackResult(prs), llmUsed: false };
  }
}
function priorityRank(p) {
  return { low: 0, medium: 1, high: 2, urgent: 3 }[p] ?? 1;
}
async function runAutomation(modelId, params) {
  const settings = await loadSettings();
  const repos = parsedRepos(settings);
  if (repos.length === 0 && !settings.contextNotes.trim()) {
    return { summary: "PR Review Digest: configure at least one repository slug (OWNER/REPO) in the Config tab.", itemCount: 0 };
  }
  const { prs, errors } = await fetchAllPRData(settings, params);
  const { result, llmUsed } = await analyzeWithLlm(modelId, prs, settings, params, errors);
  const stalePRs = prs.filter((p) => p.isStale).length;
  const failingCIPRs = prs.filter((p) => p.hasFailingCI).length;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const status = repos.length === 0 && !settings.contextNotes.trim() ? "setup-needed" : errors.length > 0 && prs.length === 0 ? "error" : errors.length > 0 ? "partial" : "ok";
  let publishedCount = 0;
  if (settings.publishItems && result.items.length > 0) {
    await (0, import_bfrost.publishItem)({
      producerWorkerId: WORKER_ID,
      itemType: "dev.pr-review-digest",
      tags: ["github", "pull-requests", "review", status],
      title: "PR review digest",
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
        generatedAt: now
      },
      selectionReason: "PR Review Digest generated this report from GitHub."
    });
    publishedCount = 1;
  }
  const run = {
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
    errors
  };
  const kv = (0, import_bfrost.openWorkerKv)(WORKER_ID);
  await kv.set("last-run", run);
  const history = (await kv.get(HISTORY_KEY) ?? []).filter(Boolean).slice(0, 19);
  await kv.set(HISTORY_KEY, [run, ...history]);
  await (0, import_bfrost.recordEventSafe)({
    category: "worker",
    action: status === "ok" ? `${WORKER_ID}_completed` : `${WORKER_ID}_${status}`,
    severity: status === "ok" ? "info" : "warning",
    summary: result.summary,
    metadata: { workerId: WORKER_ID, jobId: JOB_ID, status, totalPRs: prs.length, urgentCount: result.urgentCount, errors }
  });
  return { summary: result.summary, itemCount: publishedCount };
}
var job = {
  id: JOB_ID,
  workerId: WORKER_ID,
  label: "PR review digest",
  description: "Fetches open PRs across configured repositories and reports review status, CI, and merge conflicts.",
  defaultEnabled: true,
  defaultCron: "0 20 * * 1-5",
  defaultModelAlias: "",
  approvalRequiredDefault: false,
  approvalRequiredEditable: false,
  defaultPrompt: DEFAULT_PROMPT,
  prompt: { editable: true, helpText: "Tune how the worker evaluates PR data and writes the digest." },
  paramsSchema: JobParamsSchema,
  defaultParams: { staleDaysThreshold: 3, maxPRsPerRepo: 50, priorityThreshold: "medium" },
  dashboardFields: [
    {
      key: "staleDaysThreshold",
      label: "Stale after (days)",
      type: "number",
      defaultValue: 3,
      min: 1,
      max: 30,
      helpText: "PRs open longer than this are highlighted as stale."
    },
    {
      key: "maxPRsPerRepo",
      label: "Max PRs per repo",
      type: "number",
      defaultValue: 50,
      min: 1,
      max: 100,
      helpText: "Maximum number of open PRs to fetch per repository."
    },
    {
      key: "priorityThreshold",
      label: "Priority threshold",
      type: "select",
      defaultValue: "medium",
      options: [
        { value: "low", label: "Low and above" },
        { value: "medium", label: "Medium and above" },
        { value: "high", label: "High and above" },
        { value: "urgent", label: "Urgent only" }
      ],
      helpText: "Filter lower-priority items out of the final digest."
    }
  ],
  presets: [
    {
      id: "daily-standup",
      label: "Daily standup",
      description: "Quick daily digest highlighting urgent items only.",
      cron: "0 9 * * 1-5",
      params: { staleDaysThreshold: 2, maxPRsPerRepo: 30, priorityThreshold: "high" }
    },
    {
      id: "weekly-sweep",
      label: "Weekly sweep",
      description: "Broader weekly review including all open PRs.",
      cron: "0 17 * * 5",
      params: { staleDaysThreshold: 5, maxPRsPerRepo: 100, priorityThreshold: "low" }
    }
  ],
  run: async (modelId, params) => runAutomation(modelId, JobParamsSchema.parse(params ?? {}))
};
var manifest = {
  manifestVersion: 1,
  bfrostApiVersion: "0.1",
  bfrostEngineRange: ">=0.3.0",
  id: WORKER_ID,
  name: "PR Review Digest",
  displayName: "PR Review Digest",
  version: "0.2.0",
  description: "Fetches open PRs across configured repositories and reports review status, CI, and merge conflicts.",
  tagline: "Per-PR review status, CI results, and merge conflicts \u2014 sorted oldest-first, stale PRs highlighted.",
  owner: "@ccascio",
  builtIn: false,
  kind: "feature",
  jobs: [job],
  chatPrompts: [
    {
      label: "Latest report",
      description: "Show the most recent PR digest.",
      prompt: "Show me the latest PR Review Digest and any PRs that need immediate attention."
    },
    {
      label: "Setup help",
      description: "Help connecting repositories.",
      prompt: "Help me configure PR Review Digest \u2014 what do I put in the repositories field and where does the token go?"
    }
  ],
  ownedSettings: [
    {
      key: `${WORKER_ID}-config`,
      label: "PR Review Digest repositories",
      description: "GitHub repository slugs (OWNER/REPO) and credentials.",
      scope: "worker",
      storageKey: `worker.${WORKER_ID}.settings`,
      dashboardTarget: "config"
    },
    {
      key: `${WORKER_ID}-job`,
      label: "PR review digest schedule",
      description: "Cron, model, prompt, and run parameters.",
      scope: "job",
      storageKey: `admin.settings.jobs.${JOB_ID}`,
      dashboardTarget: "jobs"
    }
  ],
  dashboard: {
    settings: [
      {
        id: `${WORKER_ID}-config`,
        label: "PR Review Digest repositories",
        description: "GitHub repositories to scan and the token environment variable.",
        tab: "config",
        path: `/api/workers/${WORKER_ID}/settings`,
        fields: [
          {
            key: "repositories",
            label: "Repositories",
            type: "textarea",
            defaultValue: "",
            rows: 6,
            placeholder: "owner/repo\nowner/another-repo",
            helpText: "One OWNER/REPO slug per line. The worker fetches all open PRs from each repository.",
            seedPath: `${WORKER_ID}.settings.repositories`
          },
          {
            key: "githubApiBase",
            label: "GitHub API base URL",
            type: "text",
            defaultValue: GITHUB_API_DEFAULT,
            placeholder: GITHUB_API_DEFAULT,
            helpText: "Leave as-is for github.com. Change to your GitHub Enterprise API URL if needed.",
            seedPath: `${WORKER_ID}.settings.githubApiBase`
          },
          {
            key: "bearerTokenEnv",
            label: "Token env var name",
            type: "text",
            defaultValue: "GITHUB_TOKEN",
            placeholder: "GITHUB_TOKEN",
            helpText: "Name of the environment variable holding your GitHub token (not the token itself). Add GITHUB_TOKEN=... to your .env file.",
            seedPath: `${WORKER_ID}.settings.bearerTokenEnv`
          },
          {
            key: "contextNotes",
            label: "Context notes",
            type: "textarea",
            defaultValue: "",
            rows: 4,
            placeholder: "Focus on PRs waiting on me. Ignore bot PRs from dependabot.",
            helpText: "Optional instructions added to every LLM prompt run.",
            seedPath: `${WORKER_ID}.settings.contextNotes`
          },
          {
            key: "publishItems",
            label: "Publish digest to Item Bus",
            type: "boolean",
            defaultValue: true,
            helpText: "Each run publishes one dev.pr-review-digest item to the queue."
          }
        ]
      }
    ],
    routes: [
      {
        id: `${WORKER_ID}-dashboard`,
        label: "PRs",
        description: "Open pull requests with review status, CI, and merge conflicts.",
        tab: "worker",
        path: `/api/workers/${WORKER_ID}/dashboard`
      }
    ]
  }
};
var routes = [
  {
    method: "GET",
    path: `/api/workers/${WORKER_ID}/settings`,
    workerIds: [WORKER_ID],
    handle: async () => ({ status: 200, body: await loadSettings() })
  },
  {
    method: "POST",
    path: `/api/workers/${WORKER_ID}/settings`,
    workerIds: [WORKER_ID],
    handle: async (ctx) => {
      const body = await ctx.readJsonBody(ctx.req, SettingsSchema);
      for (const repo of parsedRepos(body)) {
        if (!/^[^/]+\/[^/]+$/.test(repo)) {
          throw new import_bfrost.BadRequestError(
            `Invalid repository format: "${repo}". Use OWNER/REPO (e.g. octocat/hello-world).`
          );
        }
      }
      if (body.githubApiBase) {
        try {
          new URL(body.githubApiBase);
        } catch {
          throw new import_bfrost.BadRequestError("GitHub API base URL is not a valid URL.");
        }
      }
      return { status: 200, body: await saveSettings(body) };
    }
  }
];
var module2 = {
  manifest,
  apiRoutes: routes,
  async loadDashboardData() {
    const kv = (0, import_bfrost.openWorkerKv)(WORKER_ID);
    const [settings, lastRun, history] = await Promise.all([
      loadSettings(),
      kv.get("last-run"),
      kv.get(HISTORY_KEY)
    ]);
    return {
      settings,
      repoCount: parsedRepos(settings).length,
      tokenConfigured: hasToken(settings),
      lastRun: lastRun ?? null,
      history: Array.isArray(history) ? history.slice(0, 10) : []
    };
  }
};
var index_default = module2;
