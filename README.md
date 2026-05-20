<p align="center">
  <img src="assets/bfrost-banner.jpeg" alt="BFrost — worker-first local AI operations platform" />
</p>

# BFrost

**A local-first personal AI operations platform built on a worker-first contract.**

BFrost is a control room you run on your own machine. You talk to it through Telegram (more channels coming), it answers using a model you choose — a local one via LM Studio or Ollama, or a cloud one via your own OpenAI or Anthropic key — and it schedules background work for you: news harvesting, research notes, publishing to X or WordPress, anything else you add. Every capability — assistants, channels, scheduled jobs, model providers, publishing destinations — is a **worker**. The core knows how to install, configure, schedule, run, observe, and uninstall workers; it knows nothing about any specific workflow. Add a worker to add a feature. Remove it to remove the feature.

BFrost is local-first by design: model inference, scheduler state, queue state, and dashboard operations all run on your machine. There is no hosted service, no remote loading, no worker marketplace. Workers load from local directories you control, and your data stays in a SQLite file you own.

## How BFrost compares

BFrost lives in the same neighborhood as projects like [OpenClaw](https://github.com/openclaw/openclaw), [OpenHands](https://github.com/All-Hands-AI/OpenHands), and other personal-AI / self-hosted-assistant efforts. The differences worth knowing before you pick:

- **Worker bus as the contract.** Workers communicate through a typed pub/sub Item Bus and namespaced storage — not through direct calls or shared globals. Adding a new publisher (X, WordPress, Mastodon, BlueSky) requires zero changes to existing workers; it just consumes the items it cares about and writes its outcome into its own metadata slice. The `news → X` pipeline already runs on this bus, and `workers/examples/wordpress-publisher/` is a full consumer example in under 300 lines.
- **Tighter scope, smaller surface.** Single-user, SQLite-backed, no companion apps, no multi-agent routing, no Canvas. If you want a hackable scheduler + worker substrate you can read end-to-end in a weekend, this is built for that. If you want a multi-platform assistant with native apps, look at OpenClaw instead.
- **Editorial workflow built-in.** News ingestion → research notes → publishing ships in the box as reference workers. The same shape works for any "fetch → think → publish" pipeline you want to build.

Not a fit if: you need multi-user, you want a polished consumer UI, or you're not willing to run Node 20+ and a model endpoint on your own box.

## Status — public preview (`v0.2.0`)

BFrost is published as a **public preview**. The worker-first contract is in place end-to-end:

- Core decoupled from built-in worker names (Workstream 1 ✅).
- Tools, channels, and providers are worker types (Workstream 2 ✅).
- Shared Item Bus and per-worker storage (Workstream 3 ✅).
- Local worker execution runtime with TypeScript compile-on-load, lifecycle hooks, dashboard bundles, and a typed `bfrost` SDK (Workstream 4 ✅, minus the sandbox/permission model below).

What's new since `v0.1.0`:

- **Bring-your-own cloud key.** `core.providers.openai` and `core.providers.anthropic` ship as provider workers, with `listAvailableModels()` populating the model picker from the live API. No need to install a local model just to try BFrost.
- **Assistant can answer questions about its own state.** `core.items.query` exposes `queryItems` and `recentRuns` tools — asking "what's the latest news?" or "did research run today?" in chat now returns real data from the Item Bus and scheduler history.
- **Guided Telegram setup.** Four-step BotFather walkthrough, verify-before-save, and a "Send test message" check replace the bare token field.
- **Recipe presets for jobs.** News ships three one-click recipes (Tech weekday mornings, Daily world news, Weekend long-reads); other workers can declare their own.
- **Cross-platform memory cleanup.** macOS `purge`, Linux `drop_caches`, Windows no-op — with an in-dashboard panel that detects passwordless-sudo and surfaces the exact `sudoers.d` line to add.
- **Low-code accessibility track.** Plain-language `displayName` / `tagline` on built-in workers, friendlier empty states across the dashboard, cascading provider → model picker. See [`LOWCODE_ROADMAP.md`](./LOWCODE_ROADMAP.md) for what's coming.
- **Discord channel worker.** New `core.channels.discord` posts operator notifications (job summaries, queue alerts) to a Discord channel via a five-step guided setup (Developer Portal → paste-and-verify token → OAuth invite URL → channel ID → send test message). Send-only for now — Telegram remains the recommended two-way channel.
- **Built-ins auto-discover.** `src/workers/builtin/index.ts` walks the filesystem at boot instead of importing each worker by name, so the same "drop a folder, no central registration" pattern that has always worked for local workers now also works for the bundled ones.

What still gates a `v1.0.0` tag:

- **Permissioned action runtime** (Workstream 5). Workers can already produce items, run jobs, and surface UIs, but the formal approval queue + per-worker filesystem/network/credential scopes are not yet wired up. Use the existing approval gates on the queue, and keep destructive workers narrow until this lands.
- **Frontend smoke tests, per-worker metrics, accessibility pass, and guarded SQLite restore tooling** (Workstream 6).
- **Hosted docs site, scripted demo, Worker Gallery in the dashboard, and a `CONTRIBUTING.md` expansion** (Workstream 7). The browsable documentation at <https://convertprivately.com/bfrost/> already covers getting started, architecture, example workers, and authoring with Claude Code.

The full punch list lives in [`ROADMAP.md`](./ROADMAP.md). Issues, worker proposals, and PRs are welcome.

## What you get

- **Worker-first core.** `src/` outside `src/workers/` ships with zero domain knowledge. Even the bundled news, X publisher, and research automations are workers under `src/workers/builtin/`, shipped in the same shape a contributor would author.
- **Item Bus for cross-worker work.** A producer publishes typed items; one or more consumers subscribe. Adding "publish to Mastodon" is a new consumer worker, not a core change. See [`docs/item-bus.md`](./docs/item-bus.md).
- **Local-first.** Your data, models, credentials, and run history stay on your machine.
- **Approval-gated.** Risky actions (posting, file writes, shell commands) are designed to be reviewed before they run.
- **Inspectable.** Every job, queue item, event, and run is durable, attributable, and visible in the dashboard.
- **Extensible without forks.** New jobs, tools, channels, providers, and publishers ship as workers. Authoring a worker is a manifest, a job runner, a README, and a test. See [`docs/worker-authoring.md`](./docs/worker-authoring.md).

## Bundled reference workers

These workers ship with BFrost and double as worked examples. They use the same contract a contributor uses.

- **`core.news`** — scheduled harvesting with source-quality scoring and near-duplicate detection. Produces `news.article` items.
- **`core.publisher.x`** — consumes `news.article` items and posts to X with approval gating.
- **`core.research`** — scheduled Markdown research notes synthesised with a local model.
- **`core.memory`**, **`core.search.google`**, **`core.article-fetch`**, **`core.items.query`** — assistant-tool workers (memory, web search, article reader, bus/run-history inspector).
- **`core.channels.telegram`** — Telegram channel worker, two-way, with a guided BotFather setup flow.
- **`core.channels.discord`** — Discord channel worker for operator notifications (send-only in this version), with a guided Developer Portal walkthrough.
- **`core.providers.lmstudio`**, **`core.providers.openai`**, **`core.providers.anthropic`** — model provider workers. Local via LM Studio, or cloud via OpenAI / Anthropic API key.

Each has a one-page README in `src/workers/builtin/<id>/README.md` covering what it produces/consumes, which credentials it reads, and operational caveats.

## Architecture at a glance

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

## Requirements

### Base app

- Node.js 20+
- `sqlite3`
- a Telegram bot token (only for the Telegram channel worker)
- an OpenAI-compatible local model endpoint
- the LM Studio CLI binary available at the configured path

### Voice features

- `ffmpeg`
- `whisper-cli`
- a Whisper model file

### Optional integrations

- Google Custom Search credentials — for `core.search.google`, `core.news`, and `core.research`.
- X credentials — for `core.publisher.x`.
- A WordPress site with Application Passwords enabled — if you install the [`wordpress-publisher`](./workers/examples/wordpress-publisher/README.md) example to publish news items to your own WP site.
- Research topics configured from the dashboard — for `core.research`.

## Setup

```bash
npm install
cp .env.example .env
npm run build
npm start
```

Open the dashboard at `http://127.0.0.1:3030`.

## Scripts

- `npm run build` — compile the backend and build the React dashboard.
- `npm run build:server` / `npm run build:web` — compile one side only.
- `npm start` — run the bot, scheduler, and admin dashboard server.
- `npm run dev` — run unit tests, then start backend and Vite dashboard together.
- `npm run dev:watch` — watch TypeScript backend files.
- `npm run dev:web` — Vite dev mode for the dashboard.
- `npm run task -- --job <id>` — run a named job manually (e.g. `news-digest`, `personal-research`).

## Authoring a worker

1. Read [`docs/worker-authoring.md`](./docs/worker-authoring.md) for the workflow.
2. Read [`docs/item-bus.md`](./docs/item-bus.md) if your worker produces or consumes work items.
3. Copy a scaffold from `workers/examples/` (`simple-job`, `research-style-job`, `complete-capability`, or `dashboard-view`).
4. Drop your worker under `workers/local/<id>/`, then **Rescan** in the dashboard's Workers tab.
5. Enable it, run it, watch the events feed.

### With Claude Code

Two worker-authoring skills ship with the repo under `.claude/skills/`:

- [`.claude/skills/bfrost-worker-author/`](./.claude/skills/bfrost-worker-author/SKILL.md) — for BFrost installs. Ask Claude to "create a new BFrost worker".

Claude Code loads skills from `.claude/skills/` automatically when you open the repo. Both skills enforce the worker-first contract — core files are off-limits, and a violation surfaces as an explicit contract gap rather than a silent core edit.

### With Codex (or any other AI coding assistant)

Codex does not load `.claude/skills/` automatically. To get the same guardrails, copy the relevant `SKILL.md` into a file your assistant reads at session start — for example:

- paste its contents into your Codex system prompt, or
- add it to your `AGENTS.md` / `CODEX.md` at the repo root (Codex picks up `AGENTS.md` automatically).

The skill text is plain Markdown with no Claude-specific syntax; it works as a plain instruction set for any assistant.

## Sharing data across workers

The platform separates **private state** from **cross-worker sharing**:

- **Per-worker storage** (`openWorkerKv`, `openWorkerDb`) is private. Keys land under `worker.<id>.<key>`; tables land as `worker_<id>_<name>`. No other worker can read them.
- **The Item Bus** (`src/jobs/item-bus.ts`) is the contract for sharing across workers. A producer publishes items with a typed `itemType` and a JSON `payload`; any consumer can subscribe and write its own outcome into the item's namespaced `metadata`. The News → X Publisher pipeline runs on this bus, and adding a new publisher (WordPress, Mastodon, BlueSky, …) requires no change to existing workers — see [`workers/examples/wordpress-publisher/`](./workers/examples/wordpress-publisher/README.md) for a full consumer example.

Reach for the Item Bus when workers need to talk to each other; reach for worker storage when a worker needs to remember something privately.

## Dashboard

From the dashboard you can:

- enable/disable workers and inspect their health, credentials, and dependencies
- configure and monitor scheduled jobs
- trigger jobs manually
- inspect queue pressure and recent digest runs
- inspect recent operational events
- manage LM Studio runtime actions
- switch the default model
- review configuration and local dependency health

## Environment notes

`OLLAMA_BASE_URL` configures the OpenAI-compatible endpoint URL even when the runtime is LM Studio. Point it at whichever local server exposes the compatible API.

Most mutable local state is stored in the SQLite database configured by `APP_DB_PATH`. Legacy JSON files under `data/` are imported on first use when the corresponding SQLite record does not exist yet.

Before publishing or sharing a branch, check that `data/`, `logs/`, `models/`, `.env`, SQLite files, generated research notes, and private worker scratch directories are not staged.

## Documentation

- [`docs/worker-authoring.md`](./docs/worker-authoring.md) — consolidated worker authoring guide.
- [`docs/item-bus.md`](./docs/item-bus.md) — Item Bus and per-worker storage reference.
- [`workers/README.md`](./workers/README.md) — manifest contract reference.
- [`ROADMAP.md`](./ROADMAP.md) — evolution plan and current workstreams.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contributor setup and code style.
- [`SECURITY.md`](./SECURITY.md), [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) — project policies.

## License

MIT. See [`LICENSE`](./LICENSE).
