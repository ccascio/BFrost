---
name: bfrost-worker-validator
description: Validate or review BFrost workers after they are generated. Use when asked to check, audit, validate, review, QA, or certify a BFrost worker/package against the worker-first contract, bfrost-worker-author skill, manifest/job/dashboard rules, low-code UX expectations, package/local consistency, and store release readiness. Produces prioritized findings and concrete fix suggestions.
---

# BFrost worker validator

Use this skill to review an existing BFrost worker, not to design a new one. The goal is to answer: **does this worker follow the BFrost worker-authoring contract, and what exactly must be fixed?**

## Inputs

Accept a worker id, path, package folder, git diff, or repo. If the user is vague:

- BFrost-Workers package: `packages/<id>/`
- BFrost-Workers registry entry: `workers/<id>.json`
- Installed local copy: `../BFrost/workers/local/<id>/` or `workers/local/<id>/`
- Codex authoring skill: `BFrost/.Codex/skills/bfrost-worker-author/SKILL.md`
- Codex authoring skill: `~/.codex/skills/bfrost-worker-author/SKILL.md`

Read the relevant authoring skill before judging rules that may have changed.

## Review Stance

Default to code-review style. Do not edit files unless the user explicitly asks for fixes. Findings come first, ordered by severity, with file/line references and actionable fixes.

Severity labels:

- **Blocker**: violates worker-first contract, will fail validation/build/install, can crash the host dashboard, leaks secrets, or points store metadata at a missing/wrong bundle.
- **Major**: wrong settings placement, missing low-code configuration fields, Item Bus misuse, package/local mismatch, missing permissions, missing dashboard for a scheduled/output-producing worker, or dashboard UX that blocks non-developers.
- **Minor**: docs/help wording, polish, examples, naming, or non-blocking consistency issues.

## Workflow

1. **Locate scope**
   - Run `git status -sb` in each involved repo.
   - Identify worker ids, package folders, registry entries, installed local copies, and any touched core files.
   - If reviewing BFrost-Workers packages, compare package and installed local copy when both exist:
     `diff -rq -x dist packages/<id> ../BFrost/workers/local/<id>`.

2. **Check worker-first boundaries**
   - New capabilities must live under worker folders.
   - BFrost core files must not gain worker-specific ids, item types, channel names, provider names, job names, or UI branches.
   - Allowed generic host hardening is OK only when it is not worker-specific.

3. **Validate manifests**
   - Local `worker.json` has `manifestVersion`, `bfrostApiVersion`, stable `id`, `name`, `version`, `description`.
   - TypeScript workers set `language`, `backendSource`, `backendEntrypoint`; dashboard workers set `dashboardSource`, `dashboardEntrypoint`.
   - Any worker with `jobs.length > 0`, produced/consumed Item Bus output, file output, external side effects, or operator-facing run history must declare a dashboard route and ship a dashboard bundle/source (local: `dashboardSource` + `dashboardEntrypoint`; built-in: `dashboard.routes` + dashboard view under `web/src/workers/builtin/<id>/dashboard.tsx` or equivalent runtime bundle).
   - Runtime manifest in `src/index.ts` repeats required fields, has `builtIn: false`, and uses `jobs: []` when no jobs exist.
   - No secrets in manifests. Credentials are env/config/secret-reference only.
   - Permissions match behavior: network, filesystem, local process, storage.

4. **Validate Jobs vs Config placement**
   - Scheduled run inputs belong in `jobs[].paramsSchema`, `defaultParams`, and `dashboardFields`; they render in Jobs.
   - Worker-wide settings belong in `dashboard.settings`; they render in Config.
   - Do not duplicate the same field in both places.
   - Worker dashboards may show status, output, errors, and a standard Run now shortcut, but not custom cron/enable/model/prompt/job-parameter controls.
   - `ownedSettings` uses `scope: "job"` + `dashboardTarget: "jobs"` for job params, or `scope: "worker"` + `dashboardTarget: "config"` for worker-wide config.

5. **Validate dashboard robustness and low-code UX**
   - Scheduled workers and output-producing workers must have a dashboard. Treat absence as a Major finding because low-code users need a place to inspect cron output, recent items/files/actions, failures, and what happened after "Run now".
   - The dashboard should show the latest run summary/status, recent output produced or consumed by this worker, errors/skips, relevant approvals/actions, and a read-only view of current job/config context. It may include a standard Run now shortcut.
   - Dashboard registers with `window.bfrost.registerDashboardView`.
   - `surfaceIds` match declared `dashboard.routes[].id` or `dashboard.settings[].id`.
   - Include `count: () => undefined` if there is no badge count.
   - Treat `ctx.dashboard`, `workerData[workerId]`, helpers, arrays, and callbacks as optional; use optional chaining and `Array.isArray`.
   - Missing params/worker data must render an empty/configure state, not crash.
   - Include a folded guide below the operational content using `details.panel.tab-page.worker-help-footer`.
   - Guide should say: what it does, where to configure it, inputs/outputs, one copyable example, and the likely FAQ/troubleshooting case.

6. **Validate Item Bus and storage**
   - Producers publish stable `itemType`, human title/shortDesc/url, and generic payload.
   - Consumers filter Item Bus items and write only to `metadata[ownWorkerId]`.
   - Workers use `openWorkerKv` / `openWorkerDb`; no raw shared DB access.
   - No worker writes another worker's metadata namespace or adds worker-specific queue columns.

7. **Validate package/store readiness**
   - BFrost-Workers registry entry exists in `workers/<id>.json`.
   - `capabilities.jobs/tools/channels/providers/itemProduces/itemConsumes` match the worker.
   - Registry permissions match the worker's behavior.
   - `bundleSha256` and `bundleSizeBytes` match `npm run package:workers -- <id>`.
   - `bundleUrl` and `releaseUrl` point to an existing release asset if already published.
   - Run `npm run regenerate && npm run check` in BFrost-Workers after registry edits.

8. **Validate installed/local behavior**
   - If the worker should be visible in BFrost now, ensure it is installed/mirrored in `workers/local/<id>`.
   - Backend manifest/job changes require restart or disable/enable.
   - Dashboard bundles should return 200:
     `curl -s -o /tmp/<id>-dashboard.js -w '%{http_code}\n' http://127.0.0.1:3030/api/workers/<id>/dashboard.js`
   - Jobs panel should see fields:
     `curl -s http://127.0.0.1:3030/api/dashboard | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s); console.log(d.cron?.jobs?.find(j=>j.id=="<job-id>")?.dashboardFields?.map(f=>f.key) ?? [])})'`

9. **Validate docs**
   - Worker README states what it does, produced/consumed item types, credentials/env vars, settings location (Jobs vs Config), permissions, examples, and caveats.
   - Low-code users should know what to click next without reading source.

## Useful Commands

Use these selectively:

```bash
rg -n "dashboardFields|dashboard\\.settings|ownedSettings|registerDashboardView|count:|worker-help-footer" packages/<id> workers/local/<id>
rg -n "producerWorkerId|itemType|metadata\\[|setConsumerMetadata|openWorkerKv|openWorkerDb" packages/<id>/src
npm run package:workers -- <id>
npm run regenerate && npm run check
npm run build
npm test
```

## Output Format

Use this shape:

```markdown
Findings
- Blocker: [file:line] Rule violated. Impact. Suggested fix.
- Major: [file:line] Rule violated. Impact. Suggested fix.
- Minor: [file:line] Polish issue. Suggested fix.

Passes
- Short list of important checks that passed.

Validation
- Commands run and results.
- Commands not run and why.

Fix Plan
- Concrete ordered edits if findings exist.
```

If there are no findings, say so directly and mention any residual risk or unrun checks.
