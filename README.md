<p align="center">
  <img src="assets/bfrost-banner.jpeg" alt="BFrost — worker-first local AI operations platform" />
</p>

# BFrost

**A worker-first local AI operations platform — every capability is a pluggable worker.**

<p align="center">
  <img src="assets/bfrost-demo.gif" alt="BFrost first run: clicking 'Try the live demo — no setup' runs a sample news → research pipeline on the Item Bus with no API key or model" width="820" />
</p>

<p align="center">
  <em>Clone, <code>npm start</code>, click <strong>“Try the live demo — no setup”</strong> — a sample news&nbsp;→&nbsp;research pipeline runs on the Item Bus in seconds, with no API key or model. Then wire up your own workers.</em>
</p>

## What is BFrost

BFrost is a local scheduler and orchestration runtime for AI-driven automations. Every capability — scheduled jobs, AI assistants, communication channels, model providers, publishing destinations — is a **worker**. The core only knows how to install, configure, schedule, run, observe, and uninstall workers; it knows nothing about any specific workflow. Add a worker to add a feature; remove it to remove the feature.

Everything runs on your own machine — model inference, scheduler state, queue state, and the dashboard. There is no hosted service, no remote loading, no usage tracking; workers load from directories you control and your data stays in a SQLite file you own. The bundled reference workers give you a news-harvesting → research-notes → multi-channel-publishing pipeline out of the box (Telegram two-way chat, Discord and email notifications, X / WordPress publishing, LM Studio / Ollama / OpenAI / Anthropic providers). They use the same contract you do, so you can swap, disable, or replace any of them without touching the core.

## Dashboard preview

BFrost ships with a local dashboard for the whole worker lifecycle: pick models, inspect worker health, review events, install capabilities, and keep the approval queue visible before anything risky runs.

<p align="center">
  <img src="assets/screenshots/dashboard-overview.jpeg" alt="BFrost dashboard overview showing model defaults, LM Studio runtime controls, installed worker status, and recent events" />
</p>

<p align="center">
  <em>The overview keeps model selection, runtime controls, worker health, and recent operational events in one place.</em>
</p>

<p align="center">
  <img src="assets/screenshots/chat-dashboard.jpeg" alt="BFrost dashboard chat showing natural-language assistant prompts, worker-specific prompt cards, and the message composer" />
</p>

<p align="center">
  <em>Dashboard chat lets you ask about jobs, queue items, models, and worker actions in plain language.</em>
</p>

<table>
  <tr>
    <td width="50%">
      <img src="assets/screenshots/workers-catalog.jpeg" alt="BFrost installed workers screen grouped by provider and channel capabilities" />
    </td>
    <td width="50%">
      <img src="assets/screenshots/worker-store.jpeg" alt="BFrost worker store showing searchable worker cards with trust and category badges" />
    </td>
  </tr>
  <tr>
    <td><strong>Installed capabilities.</strong> Workers are grouped by role, status, and lifecycle controls.</td>
    <td><strong>Worker Store.</strong> Browse core and community workers without changing the platform core.</td>
  </tr>
</table>

From the dashboard you can:

- run the guided first-run wizard (model → embeddings → channels → workers → first run → security)
- enable/disable workers and inspect their health, credentials, and dependencies
- configure, schedule, and manually trigger jobs, with one-click recipe presets and preview-before-save edits
- approve or reject queued worker actions with a diff preview and audit history
- track per-worker job metrics — success rate, p50/p95 run duration, last failure
- browse and install workers from the Worker Store, or side-load a worker zip
- create and restore guarded SQLite backups (integrity-checked, with a pre-restore safety copy)
- manage model providers, embeddings, LM Studio runtime actions, and Platform & Security settings

## Quickstart

Requires **Node.js 20+** and `sqlite3` — enough to run the zero-config demo.

```bash
npm install
cp .env.example .env
npm run build      # compile backend + dashboard (required before npm start)
npm start          # starts in the background; safe to re-run (stops any existing instance first)
```

Open <http://127.0.0.1:3030> and click **“Try the live demo — no setup”** to watch a sample news → research pipeline run on the Item Bus with no API key or model. Then wire up your own workers.

> **Windows:** several npm scripts (`test`, `dev`, …) use Unix shell syntax. Point npm at Git Bash once so they work from PowerShell or CMD (requires [Git for Windows](https://git-scm.com/download/win)):
> ```powershell
> npm config set script-shell "C:\Program Files\Git\bin\bash.exe"
> ```

## Requirements

- **Core:** Node.js 20+ and `sqlite3`. Enough for the zero-config demo.
- **Real work:** at least one model provider — a local OpenAI-compatible endpoint (LM Studio or Ollama) or a cloud API key (OpenAI / Anthropic).
- **Per-worker, as you enable them:**
  - Telegram bot token — `core.channels.telegram`
  - Google Custom Search credentials — `core.search.google`, `core.news`, `core.research`
  - X credentials — `core.publisher.x`
  - A WordPress site with Application Passwords — the [`wordpress-publisher`](./workers/examples/wordpress-publisher/README.md) example
  - `ffmpeg`, `whisper-cli`, and a Whisper model file — voice features

## Commands & running it

Always `npm run build` before the first start and after pulling new code. `npm start` runs the server as a **background process** (the terminal is free to close) and stops any existing instance first, so it is safe to re-run.

| Command | Description |
|---|---|
| `npm run build` | Compile backend + React dashboard |
| `npm run build:server` / `npm run build:web` | Compile one side only |
| `npm start` | Start in background (stops any existing instance first) |
| `npm stop` | Stop the running instance |
| `npm run logs` | Tail `data/bfrost.log` (macOS / Linux; on Windows use `Get-Content -Path data\bfrost.log -Wait`) |
| `npm run install-service` / `npm run uninstall-service` | Register / remove an OS service that auto-starts on login and restarts on crash |
| `npm run dev` | Run tests, then start backend + Vite dashboard in the foreground |
| `npm run dev:watch` / `npm run dev:web` | Backend TypeScript watch / Vite dev server only |
| `npm run task -- --job <id>` | Run a named job once and exit (e.g. `news-digest`, `tweet-post`) |

**Auto-start on login (recommended for regular use).** `npm run install-service` registers BFrost as an OS service — launchd `LaunchAgent` on macOS, systemd user service on Linux, PM2 or Windows Task Scheduler on Windows. Once installed, `npm start` / `npm stop` route through the service manager automatically.

**Developer workflow.** Use `npm run dev` while working on the code — it runs the test suite first, then starts the backend and Vite dashboard in the foreground (logs visible, Ctrl+C stops both).

## Environment notes

- `OLLAMA_BASE_URL` sets the OpenAI-compatible endpoint URL even when the runtime is LM Studio — point it at whichever local server exposes the compatible API.
- Most mutable state lives in the SQLite database at `APP_DB_PATH`; legacy JSON files under `data/` are imported on first use when no SQLite record exists yet.
- Before publishing or sharing a branch, make sure `data/`, `logs/`, `models/`, `.env`, SQLite files, generated research notes, and private worker scratch directories are not staged.

## Bundled reference workers

These workers ship with BFrost and double as worked examples. They use the same contract a contributor uses. Each has a one-page README in `src/workers/builtin/<id>/README.md` covering what it produces/consumes, which credentials it reads, and operational caveats.

- **`core.news`** — scheduled harvesting with source-quality scoring and near-duplicate detection. Produces `news.article` items.
- **`core.finance-news`** — scans the web for developments on a watchlist of tickers/companies, optionally AI-filters for relevance, and can alert your channel. Produces `finance.news` items. Informational only — not trading advice.
- **`core.finance-analyst`** — consumes `finance.news` items and attaches a structured, informational read of likely market impact (direction, magnitude, horizon, confidence, priced-in), optionally delivered to your channel. Not trading advice.
- **`core.publisher.x`** — consumes `news.article` items and posts to X with approval gating.
- **`core.research`** — scheduled Markdown research notes synthesised with a local model.
- **`core.memory`**, **`core.search.google`**, **`core.article-fetch`**, **`core.items.query`** — assistant-tool workers (memory, web search, article reader, bus/run-history inspector).
- **`core.channels.telegram`** — Telegram channel worker, two-way, with a guided BotFather setup flow.
- **`core.channels.discord`** — Discord channel worker for operator notifications (send-only in this version), with a guided Developer Portal walkthrough.
- **`core.channels.email`** — emails you when a job runs, fails, or needs attention, over SMTP with any provider (send-only in this version).
- **`core.providers.lmstudio`**, **`core.providers.openai`**, **`core.providers.anthropic`** — model provider workers. Local via LM Studio, or cloud via OpenAI / Anthropic API key.

## How it works

BFrost separates **private state** from **cross-worker sharing**:

- **Per-worker storage** (`openWorkerKv`, `openWorkerDb`) is private. Keys land under `worker.<id>.<key>`; tables land as `worker_<id>_<name>`. No other worker can read them.
- **The Item Bus** (`src/jobs/item-bus.ts`) is the contract for sharing across workers. A producer publishes items with a typed `itemType` and a JSON `payload`; any consumer can subscribe and write its own outcome into the item's namespaced `metadata`. The News → X Publisher pipeline runs on this bus, and adding a new publisher (WordPress, Mastodon, BlueSky, …) requires no change to existing workers — see [`workers/examples/wordpress-publisher/`](./workers/examples/wordpress-publisher/README.md) for a full consumer example in under 300 lines.

File writes and shell commands a worker requests are **approval-gated**: checked against the worker's declared scopes, queued in the dashboard's Actions tab with a diff preview, then executed and audited. (Network and credential scopes are still on the roadmap, and enabled worker code itself runs unsandboxed — only enable code you trust.)

### Repository layout

- `src/index.ts` — boots channels, providers, scheduler, and admin server.
- `src/workers/registry.ts` — small aggregator over worker manifests.
- `src/workers/builtin/<id>/` — bundled reference workers.
- `src/workers/local.ts` — local manifest discovery and compatibility validation.
- `src/workers/loader.ts` + `src/workers/build.ts` — load compiled JS / compile TS sources on install.
- `src/jobs/item-bus.ts` — typed producer/consumer queue shared across workers.
- `src/workers/storage.ts` + `src/workers/db.ts` — namespaced per-worker KV and SQLite tables.
- `src/admin-server.ts` — local HTTP API and static dashboard hosting.
- `web/` — React dashboard. Worker-specific UI lives in `web/src/workers/`.
- `workers/` — local worker examples and authoring docs.
- `data/` — local state and run artefacts.

## How BFrost compares

BFrost lives in the same neighborhood as projects like [OpenClaw](https://github.com/openclaw/openclaw), [OpenHands](https://github.com/All-Hands-AI/OpenHands), and other personal-AI / self-hosted-assistant efforts. The differences worth knowing before you pick:

- **Worker bus as the contract.** Workers communicate through a typed pub/sub Item Bus and namespaced storage — not through direct calls or shared globals. Adding a new publisher (X, WordPress, Mastodon, BlueSky) requires zero changes to existing workers; it just consumes the items it cares about and writes its outcome into its own metadata slice.
- **Tighter scope, smaller surface.** Single-user, SQLite-backed, no companion apps, no multi-agent routing, no Canvas. If you want a hackable scheduler + worker substrate you can read end-to-end in a weekend, this is built for that. If you want a multi-platform assistant with native apps, look at OpenClaw instead.
- **Editorial workflow built-in.** News ingestion → research notes → publishing ships in the box as reference workers. The same shape works for any "fetch → think → publish" pipeline you want to build.

Not a fit if: you need multi-user, you want a polished consumer UI, or you're not willing to run Node 20+ and a model endpoint on your own box.

## Authoring a worker

1. Read [`docs/worker-authoring.md`](./docs/worker-authoring.md) for the workflow.
2. Read [`docs/item-bus.md`](./docs/item-bus.md) if your worker produces or consumes work items.
3. Copy a scaffold from `workers/examples/` (`simple-job`, `research-style-job`, `complete-capability`, or `dashboard-view`).
4. Drop your worker under `workers/local/<id>/`, then **Rescan** in the dashboard's Workers tab.
5. Enable it, run it, watch the events feed.

### With Claude Code

Two worker skills ship with the repo under `.claude/skills/`:

- [`.claude/skills/bfrost-worker-author/`](./.claude/skills/bfrost-worker-author/SKILL.md) — scaffolds a new worker without touching the core. Ask Claude to "create a new BFrost worker".
- [`.claude/skills/bfrost-worker-validator/`](./.claude/skills/bfrost-worker-validator/SKILL.md) — reviews a worker against the worker-first contract, manifest/job/dashboard rules, and store-release readiness. Ask Claude to "validate my BFrost worker".

Claude Code loads skills from `.claude/skills/` automatically when you open the repo. Both skills enforce the worker-first contract — core files are off-limits, and a violation surfaces as an explicit contract gap rather than a silent core edit.

### With Codex (or any other AI coding assistant)

Codex does not load `.claude/skills/` automatically. To get the same guardrails, copy the relevant `SKILL.md` into a file your assistant reads at session start — for example:

- paste its contents into your Codex system prompt, or
- add it to your `AGENTS.md` / `CODEX.md` at the repo root (Codex picks up `AGENTS.md` automatically).

The skill text is plain Markdown with no Claude-specific syntax; it works as a plain instruction set for any assistant.

## Status — public preview (`v0.2.0`)

BFrost is published as a **public preview**. The worker-first contract is in place end-to-end: the core is decoupled from built-in worker names; tools, channels, and providers are all worker types; the shared Item Bus and per-worker storage are in place; local workers compile-on-load with a typed `bfrost` SDK; and the permissioned action runtime scope-checks, queues, approves, executes, and audits file and shell actions.

Still open before a `v1.0.0` tag:

- **Sandbox scopes for worker code** — network-domain and credential-scope allowlists are deferred, and enabled local worker code currently runs with full Node privileges, unsandboxed. Enable only code you trust, and keep destructive workers narrow.
- **Frontend smoke test** for the schema-rendered job form.
- **Hosted docs site, scripted demo, and an in-dashboard Worker Gallery.** Browsable documentation already lives at <https://bfrost.net/>, covering getting started, architecture, example workers, and authoring with Claude Code.

The full punch list lives in [`ROADMAP.md`](./ROADMAP.md). Issues, worker proposals, and PRs are welcome.

## Community

Join the [LLM Productivity Reddit community](https://www.reddit.com/r/LLM_Productivity/) to share what you are building with BFrost, ask questions, compare worker ideas, and participate in the broader local-AI productivity conversation.

## Documentation

- [`docs/worker-authoring.md`](./docs/worker-authoring.md) — consolidated worker authoring guide.
- [`docs/item-bus.md`](./docs/item-bus.md) — Item Bus and per-worker storage reference.
- [`workers/README.md`](./workers/README.md) — manifest contract reference.
- [`ROADMAP.md`](./ROADMAP.md) — evolution plan and current workstreams.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contributor setup and code style.
- [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — community guidelines.

## License

MIT. See [`LICENSE`](./LICENSE).
