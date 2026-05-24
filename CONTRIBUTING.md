# Contributing

Thanks for considering a BFrost contribution. This document covers the developer loop, test expectations, worker authoring, and the hygiene rules that keep a local-first project safe to open-source.

## Before you start

BFrost is a **worker-first** platform. Before writing any code, read the contract:

> Every capability in BFrost is a worker. The core only knows how to install, configure, schedule, run, observe, and uninstall workers. Removing a worker removes the feature; adding one adds the feature — no core changes required.

If your change can ship as a new worker under `workers/local/<id>/` — it should. If it genuinely requires a core change, open a **Feature request** issue first so the design can be agreed before code lands.

---

## Local setup

```bash
git clone https://github.com/ccascio/BFrost.git
cd BFrost
npm install
cp .env.example .env        # fill in at minimum APP_DB_PATH
npm run build
npm start
```

The admin dashboard defaults to `http://127.0.0.1:3030`.

**Minimum `.env` to boot** (all other credentials are optional — workers that need them report "missing credential" in health rather than crashing the process):

```
APP_DB_PATH=./data/bfrost.db
ADMIN_PASSWORD=changeme
```

---

## Dev loop

### Backend changes

```bash
npm run dev:watch          # TypeScript watch — recompiles on every save
```

Changes take effect on the next request or scheduler tick. The server does not hot-reload; restart `npm start` (or kill and rerun `node dist/index.js`) after each compile cycle to pick up changes. For local worker changes, use the dashboard's **Rescan** button instead — it reloads changed local workers without restarting the server.

### Frontend changes

```bash
npm run dev:web            # Vite dev server with HMR at http://127.0.0.1:5173
```

Run this alongside `npm start` (backend). The Vite proxy forwards `/api` requests to the backend server, so the full stack is live with hot-reload in the browser.

### Both together

```bash
npm run dev                # runs unit tests, then starts backend + Vite together
```

This is the recommended default. It runs `npm test` first so you don't start with a broken build, then launches both processes under a single terminal.

### Single-file build

```bash
npm run build:server       # backend only (tsc)
npm run build:web          # frontend only (vite build)
```

Use `build:server` when you only touched backend TypeScript — it's faster than a full build and is what the test runner invokes internally.

---

## Running tests

```bash
npm test                   # rm -rf dist && tsc && node --test "dist/**/*.test.js"
```

There is no Jest. The test runner is Node's built-in `node --test` (Node 20+). All test files follow the `*.test.ts` → `*.test.js` (compiled) pattern.

**Run a single file** (after `npm run build:server`):

```bash
node --test dist/src/admin-api.test.js
```

**Filter by name** (prefix-matches against `describe`/`it` labels):

```bash
node --test dist/src/admin-api.test.js --test-name-pattern="manifest schema"
```

### What to test

| Area | When to add tests |
|------|--------------------|
| Registry / manifest | Any change to `WorkerManifest`, `WorkerJobManifest`, or the Zod schemas in `src/admin-api.ts` |
| Scheduler | Changes to cron parsing, job state machine, or run-history writes |
| Item Bus | New item types, consumer contract changes, metadata slot mutations |
| Admin API | New endpoints or changed request/response shapes |
| Worker storage | New `openWorkerKv` / `openWorkerDb` namespacing logic |
| Worker loader / builder | Changes to local worker discovery, compilation, or SDK injection |
| Migrations | Any new SQLite migration (`src/db/migrations/`) |

Worker-specific job logic generally doesn't need unit tests — cover it with a manual `npm run task -- --job <id>` run and a note in the PR. Reserve unit tests for platform contracts.

---

## Authoring a new worker

Workers are the primary extension point. You don't need to modify any core file.

### Quick start

1. Read [`docs/worker-authoring.md`](./docs/worker-authoring.md) — the canonical authoring guide covering manifest structure, SDK, job runner, channel/provider/tool adapters, and dashboard bundles.
2. Read [`docs/item-bus.md`](./docs/item-bus.md) if your worker produces or consumes Item Bus items.
3. Pick the right scaffold from `workers/examples/`:

   | Scaffold | Use when… |
   |----------|-----------|
   | `simple-job` | Basic cron job with no Item Bus involvement |
   | `research-style-job` | Job that calls an LLM and writes output |
   | `complete-capability` | Full manifest: jobs + tools + channel + provider |
   | `dashboard-view` | Worker with a custom React dashboard panel |

4. Copy your chosen scaffold to `workers/local/<your-id>/`.
5. Fill in `worker.json` (the manifest) and `src/index.ts` (the backend module).
6. Drop the folder, then open the dashboard → Workers tab → **Rescan**. Your worker appears immediately.
7. Enable it, configure credentials if needed, run a job, watch the events feed.

### With Claude Code

The `.claude/skills/bfrost-worker-author/` skill enforces the worker-first contract for you. When you're in the BFrost repo, just ask:

```
create a new BFrost worker that <describes what it does>
```

The skill will scaffold the manifest, backend module, and README; it will refuse to touch any core file and surface a contract-gap note if a core change is genuinely needed.

### Worker contract rules

- Manifest lives in `worker.json` at the root of the worker folder.
- Backend module exports a `BackendWorkerModule` default from `src/index.ts`.
- All storage goes through `openWorkerKv(workerId)` or `openWorkerDb(workerId)` — never raw SQLite or files in `data/`.
- Cross-worker communication goes through the Item Bus — never direct imports between worker modules.
- The worker must compile cleanly with `tsc --noEmit` and not introduce import cycles with core.

---

## Code style

- **TypeScript strict mode.** Run `npx tsc --noEmit` to check before pushing.
- **No ESLint config** in this repo — `tsc` is the only static gate.
- Prefer existing modules and patterns over new abstractions.
- Use Zod at all API boundaries (`src/admin-api.ts`). Adding a field to a manifest schema **requires** a matching update to the Zod schema and its test fixture — both fail loudly if you forget.
- Keep dashboard job controls schema-driven (declared via `dashboardFields` in the manifest) rather than hard-coded HTML in `App.tsx`.
- No worker ids, item types, model provider names, or channel names in `src/` outside `src/workers/`. The test for this: `grep -ri "news\|tweet\|publisher\|telegram\|openai\|anthropic" src web --exclude-dir=workers` should return only generic hits (variable names, comments, labels).

---

## Before you commit

Check that these are **not** staged:

- `.env` or any file containing secrets, tokens, or passwords
- `data/` — SQLite files, queue state, backups, generated notes, run history
- `logs/`
- `models/`
- Local worker scratch directories (`workers/local/`)
- Generated output (`dist/`, `web/dist/`) unless a maintainer explicitly asks

The `.gitignore` covers most of this, but double-check before a `git push` with:

```bash
git status --short | grep -v '^\?\?' | head -20
```

---

## PR checklist

The PR template (`.github/PULL_REQUEST_TEMPLATE.md`) contains the full checklist. The non-negotiables:

- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] No worker ids or provider names added to core files
- [ ] If a manifest field changed: Zod schema and test fixtures updated

---

## Community

- Bug reports → `.github/ISSUE_TEMPLATE/bug_report.md`
- Feature proposals → `.github/ISSUE_TEMPLATE/feature_request.md`
- Worker proposals → `.github/ISSUE_TEMPLATE/worker_proposal.md`
- Security vulnerabilities → see [`SECURITY.md`](./SECURITY.md) (private disclosure, not public issues)
- Code of conduct → [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
