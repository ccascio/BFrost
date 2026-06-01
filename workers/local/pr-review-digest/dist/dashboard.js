"use strict";
(() => {
  // dashboard.tsx
  function formatDate(value) {
    if (!value) return "n/a";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }
  function toneForPriority(priority) {
    if (priority === "urgent") return "bad";
    if (priority === "high") return "warning";
    if (priority === "medium") return "info";
    return "muted";
  }
  function toneForStatus(status) {
    if (status === "ok") return "good";
    if (status === "setup-needed") return "warning";
    if (status === "error") return "bad";
    if (status === "partial") return "warning";
    return "muted";
  }
  function toneForReview(status) {
    if (status === "approved") return "good";
    if (status === "changes_requested") return "bad";
    return "muted";
  }
  function toneForCI(status) {
    if (status === "passing") return "good";
    if (status === "failing") return "bad";
    if (status === "pending") return "warning";
    return "muted";
  }
  function toneForMerge(status) {
    if (status === "clean") return "good";
    if (status === "dirty") return "bad";
    if (status === "blocked" || status === "behind") return "warning";
    return "muted";
  }
  function labelForReview(status) {
    return status.replace(/_/g, " ");
  }
  function WorkerDashboard(ctx) {
    const StatusPill = ctx.StatusPill ?? ((props) => /* @__PURE__ */ React.createElement("span", null, props.children));
    const Detail = ctx.Detail ?? ((props) => /* @__PURE__ */ React.createElement("div", { className: "detail" }, /* @__PURE__ */ React.createElement("span", null, props.label), /* @__PURE__ */ React.createElement("strong", null, props.value)));
    const slice = ctx.dashboard?.workerData?.["pr-review-digest"] ?? {};
    const settings = slice.settings ?? {};
    const repoCount = Number(slice.repoCount ?? 0);
    const tokenConfigured = Boolean(slice.tokenConfigured);
    const lastRun = slice.lastRun ?? null;
    const history = Array.isArray(slice.history) ? slice.history : [];
    const prs = Array.isArray(lastRun?.prs) ? lastRun.prs : [];
    const items = Array.isArray(lastRun?.items) ? lastRun.items : [];
    const errors = Array.isArray(lastRun?.errors) ? lastRun.errors : [];
    const job = ctx.dashboard?.cron?.jobs?.find(
      (entry) => entry.name === "pr-review-digest" || entry.id === "pr-review-digest"
    );
    const isReady = repoCount > 0;
    const stalePRs = Number(lastRun?.stalePRs ?? 0);
    const failingCIPRs = Number(lastRun?.failingCIPRs ?? 0);
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("section", { className: "grid top-grid tab-page" }, /* @__PURE__ */ React.createElement("article", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "panel-kicker" }, "PR Review Digest"), /* @__PURE__ */ React.createElement("h2", null, isReady ? `${repoCount} repo${repoCount === 1 ? "" : "s"} configured` : "Configure repositories")), /* @__PURE__ */ React.createElement(StatusPill, { tone: isReady ? "good" : "warning" }, isReady ? tokenConfigured ? "token set" : "no token" : "setup needed")), /* @__PURE__ */ React.createElement("div", { className: "detail-body" }, /* @__PURE__ */ React.createElement("div", { className: "detail-grid" }, /* @__PURE__ */ React.createElement(Detail, { label: "Job", value: job?.enabled ? "enabled" : "disabled" }), /* @__PURE__ */ React.createElement(Detail, { label: "Cron", value: job?.cron ?? "0 20 * * 1-5" }), /* @__PURE__ */ React.createElement(Detail, { label: "Token", value: tokenConfigured ? "configured" : "not detected" }), /* @__PURE__ */ React.createElement(Detail, { label: "Publishes", value: "dev.pr-review-digest" }), /* @__PURE__ */ React.createElement(Detail, { label: "Last status", value: lastRun?.status ?? "n/a" }), /* @__PURE__ */ React.createElement(Detail, { label: "Urgent", value: String(lastRun?.urgentCount ?? 0) }))), /* @__PURE__ */ React.createElement("div", { className: "panel-actions" }, /* @__PURE__ */ React.createElement(
      "button",
      {
        type: "button",
        disabled: ctx.busyKey === "run-pr-review-digest" || job?.running,
        onClick: () => ctx.triggerRun?.("run-pr-review-digest", "/api/cron-jobs/pr-review-digest/run", "PR review digest started.")
      },
      job?.running ? "Running..." : "Run now"
    ))), /* @__PURE__ */ React.createElement("article", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "panel-kicker" }, "Last run"), /* @__PURE__ */ React.createElement("h2", null, lastRun ? formatDate(lastRun.ranAt) : "No run yet")), /* @__PURE__ */ React.createElement(StatusPill, { tone: toneForStatus(lastRun?.status) }, lastRun?.status ?? "idle")), lastRun ? /* @__PURE__ */ React.createElement("div", { className: "detail-body" }, /* @__PURE__ */ React.createElement("p", null, lastRun.summary), /* @__PURE__ */ React.createElement("div", { className: "detail-grid" }, /* @__PURE__ */ React.createElement(Detail, { label: "Open PRs", value: String(lastRun.totalPRs ?? 0) }), /* @__PURE__ */ React.createElement(Detail, { label: "Stale", value: String(stalePRs) }), /* @__PURE__ */ React.createElement(Detail, { label: "Failing CI", value: String(failingCIPRs) }), /* @__PURE__ */ React.createElement(Detail, { label: "AI", value: lastRun.llmUsed ? "used" : "fallback" })), errors.length > 0 && /* @__PURE__ */ React.createElement("div", { className: "timeline", style: { marginTop: "0.75rem" } }, errors.map((error) => /* @__PURE__ */ React.createElement("div", { className: "timeline-event warning", key: String(error.repo) + String(error.message) }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, error.repo), /* @__PURE__ */ React.createElement("span", null, error.message)), /* @__PURE__ */ React.createElement(StatusPill, { tone: "warning" }, "error"))))) : /* @__PURE__ */ React.createElement("p", { className: "empty-state" }, "Run the job once or wait for the next schedule."))), /* @__PURE__ */ React.createElement("section", { className: "panel tab-page" }, /* @__PURE__ */ React.createElement("div", { className: "panel-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "panel-kicker" }, "Open pull requests"), /* @__PURE__ */ React.createElement("h2", null, "PR list")), /* @__PURE__ */ React.createElement(StatusPill, { tone: prs.length === 0 ? "muted" : "info" }, prs.length, " open")), prs.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "empty-state" }, isReady ? "No open pull requests found, or the job has not run yet." : "Configure repositories in the Config tab, then run the job.") : /* @__PURE__ */ React.createElement("div", { className: "stack-list compact" }, prs.map((pr) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: "summary-row",
        key: `${pr.repo}#${pr.number}`,
        style: pr.needsAttention ? { borderLeft: "3px solid var(--color-bad, #e53e3e)", paddingLeft: "0.5rem" } : void 0
      },
      /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("strong", null, /* @__PURE__ */ React.createElement("a", { href: pr.url, target: "_blank", rel: "noopener noreferrer" }, pr.repo, "#", pr.number, " \u2014 ", pr.title)), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.25rem" } }, /* @__PURE__ */ React.createElement("span", null, "\u{1F464} ", pr.author), /* @__PURE__ */ React.createElement("span", null, "\u{1F550} ", pr.ageDays, "d open"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement(StatusPill, { tone: toneForReview(pr.reviewStatus) }, labelForReview(pr.reviewStatus))), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement(StatusPill, { tone: toneForCI(pr.ciStatus) }, "CI: ", pr.ciStatus)), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement(StatusPill, { tone: toneForMerge(pr.mergeStatus) }, "merge: ", pr.mergeStatus)), pr.draft && /* @__PURE__ */ React.createElement(StatusPill, { tone: "muted" }, "draft")), pr.failingChecks?.length > 0 && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--color-bad, #e53e3e)", fontSize: "0.8rem" } }, "Failing: ", pr.failingChecks.join(", ")), pr.reviewers?.length > 0 && /* @__PURE__ */ React.createElement("span", { style: { fontSize: "0.8rem", color: "var(--text-muted, #666)" } }, "Reviewers: ", pr.reviewers.map((r) => `${r.user} (${r.state.toLowerCase()})`).join(", ")))
    )))), /* @__PURE__ */ React.createElement("section", { className: "panel tab-page" }, /* @__PURE__ */ React.createElement("div", { className: "panel-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "panel-kicker" }, "Digest"), /* @__PURE__ */ React.createElement("h2", null, "LLM analysis")), /* @__PURE__ */ React.createElement(StatusPill, { tone: "muted" }, items.length, " items")), /* @__PURE__ */ React.createElement("div", { className: "stack-list compact" }, items.map((item, index) => /* @__PURE__ */ React.createElement("div", { className: "summary-row", key: String(item.title) + index }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, item.title), /* @__PURE__ */ React.createElement("span", null, item.summary), /* @__PURE__ */ React.createElement("span", null, item.action)), /* @__PURE__ */ React.createElement(StatusPill, { tone: toneForPriority(item.priority) }, item.priority))), items.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-state" }, "No digest items yet. Run the job to generate the AI analysis."))), /* @__PURE__ */ React.createElement("section", { className: "panel tab-page" }, /* @__PURE__ */ React.createElement("div", { className: "panel-head" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "panel-kicker" }, "History"), /* @__PURE__ */ React.createElement("h2", null, "Recent runs")), /* @__PURE__ */ React.createElement(StatusPill, { tone: "muted" }, history.length, " runs")), /* @__PURE__ */ React.createElement("div", { className: "timeline" }, history.map((run) => /* @__PURE__ */ React.createElement(
      "div",
      {
        className: run.status === "ok" ? "timeline-event" : "timeline-event warning",
        key: run.ranAt
      },
      /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("strong", null, formatDate(run.ranAt)), /* @__PURE__ */ React.createElement("span", null, run.summary), run.totalPRs != null && /* @__PURE__ */ React.createElement("span", { style: { fontSize: "0.8rem", color: "var(--text-muted, #666)" } }, run.totalPRs, " PRs \xB7 ", run.stalePRs ?? 0, " stale \xB7 ", run.failingCIPRs ?? 0, " failing CI")),
      /* @__PURE__ */ React.createElement(StatusPill, { tone: toneForStatus(run.status) }, run.status)
    )), history.length === 0 && /* @__PURE__ */ React.createElement("p", { className: "empty-state" }, "No run history yet."))), /* @__PURE__ */ React.createElement("details", { className: "panel tab-page worker-help-footer" }, /* @__PURE__ */ React.createElement("summary", null, "About PR Review Digest"), /* @__PURE__ */ React.createElement("div", { className: "detail-body" }, /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, "What it does")), /* @__PURE__ */ React.createElement("p", null, "Fetches all open PRs from configured GitHub repositories. For each PR it calls the GitHub API for reviews and CI check-runs, then passes structured data to an LLM to produce the digest."), /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, "What each PR report covers")), /* @__PURE__ */ React.createElement("ul", null, /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("strong", null, "Title + author"), " \u2014 from the PR metadata"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("strong", null, "Age"), " \u2014 computed from ", /* @__PURE__ */ React.createElement("code", null, "created_at")), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("strong", null, "Review status"), " \u2014 approved / changes requested / awaiting review (latest review per reviewer)"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("strong", null, "CI status"), " \u2014 passing / failing / pending / unknown (from check-runs + combined status)"), /* @__PURE__ */ React.createElement("li", null, /* @__PURE__ */ React.createElement("strong", null, "Merge conflicts"), " \u2014 clean / dirty / blocked / behind (from ", /* @__PURE__ */ React.createElement("code", null, "mergeable_state"), ")")), /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, "Setup")), /* @__PURE__ */ React.createElement("ul", null, /* @__PURE__ */ React.createElement("li", null, "Add ", /* @__PURE__ */ React.createElement("code", null, "GITHUB_TOKEN=github_pat_..."), " to your ", /* @__PURE__ */ React.createElement("code", null, ".env"), " file and restart BFrost."), /* @__PURE__ */ React.createElement("li", null, "Enter repository slugs (", /* @__PURE__ */ React.createElement("code", null, "owner/repo"), ") in the Config tab, one per line."), /* @__PURE__ */ React.createElement("li", null, "For GitHub Enterprise, change the API base URL to your instance.")))));
  }
  window.bfrost.registerDashboardView({
    workerId: "pr-review-digest",
    kind: "worker-dashboard",
    surfaceIds: ["pr-review-digest-dashboard"],
    menu: { icon: "git-pull-request", group: "Workers", order: 60, label: "PRs" },
    count: (ctx) => {
      const prs = ctx.dashboard?.workerData?.["pr-review-digest"]?.lastRun?.prs ?? [];
      return Array.isArray(prs) ? prs.filter((pr) => pr.needsAttention).length : void 0;
    },
    render: (ctx) => /* @__PURE__ */ React.createElement(WorkerDashboard, { ...ctx }),
    queueItemDetail: (item) => {
      if (item?.producerWorkerId !== "pr-review-digest" && item?.itemType !== "dev.pr-review-digest") return null;
      const payload = item.payload ?? {};
      const prs = Array.isArray(payload.prs) ? payload.prs : [];
      const urgent = prs.filter((pr) => pr.needsAttention);
      return /* @__PURE__ */ React.createElement("div", { className: "detail-section" }, /* @__PURE__ */ React.createElement("p", { className: "panel-kicker" }, "PR Review Digest"), /* @__PURE__ */ React.createElement("p", null, payload.summary ?? item.shortDesc), /* @__PURE__ */ React.createElement("div", { className: "detail-grid" }, /* @__PURE__ */ React.createElement("div", { className: "detail" }, /* @__PURE__ */ React.createElement("span", null, "Open PRs"), /* @__PURE__ */ React.createElement("strong", null, payload.totalPRs ?? prs.length)), /* @__PURE__ */ React.createElement("div", { className: "detail" }, /* @__PURE__ */ React.createElement("span", null, "Stale"), /* @__PURE__ */ React.createElement("strong", null, payload.stalePRs ?? 0)), /* @__PURE__ */ React.createElement("div", { className: "detail" }, /* @__PURE__ */ React.createElement("span", null, "Failing CI"), /* @__PURE__ */ React.createElement("strong", null, payload.failingCIPRs ?? 0)), /* @__PURE__ */ React.createElement("div", { className: "detail" }, /* @__PURE__ */ React.createElement("span", null, "Needs attention"), /* @__PURE__ */ React.createElement("strong", null, urgent.length))));
    }
  });
})();
