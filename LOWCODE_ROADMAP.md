# BFrost Low-Code Roadmap

## Objective

Make BFrost usable by someone who has never opened a terminal. The technical roadmap in [`ROADMAP.md`](./ROADMAP.md) brings the worker-first contract to `v1.0.0`; this roadmap is the parallel track that turns the platform into something a non-developer can install, configure, and operate end-to-end.

The product promise this roadmap must be able to defend:

> A user with no coding background can download BFrost, follow a guided installer, connect their channels and accounts through forms (no `.env`, no JSON), enable the workers they want from a catalog, and run the result — all from a single dashboard, in plain language.

The worker contract stays exactly as it is. What changes is the **surface** that wraps it: installer, onboarding, channel connect-flows, worker catalog, and the in-product copy.

---

## Guiding Principles

1. **No file editing in the happy path.** Anything a first-time user must configure is configurable from the dashboard. `.env`, `data/*.json`, and `npm` are last-resort escape hatches, not the documented flow.
2. **Plain language everywhere.** Field labels, error messages, and empty states explain what the thing is and what happens next — not what it's called in the code.
3. **Defaults that work.** Out of the box, BFrost runs with safe defaults. Disabling a worker is one click; nothing is on by default that needs a credential the user hasn't entered.
4. **Show the work.** Every action the user takes (install, configure, enable, run) produces a visible result the same screen — confirmations, previews, last-run summaries — so the user trusts that something happened.
5. **One concept per screen.** Each onboarding step asks for one thing. No screen mixes "install a model" with "connect Telegram" with "enable news harvesting."

---

## Workstreams

### Workstream A — Desktop Installer And First-Run Wizard

**Goal:** a downloadable installer that gets a non-developer from "I just heard about this" to "the dashboard is open and a worker just ran" without a terminal.

- [ ] **Packaged distribution.** Ship signed installers for macOS (`.dmg`), Windows (`.exe`), and Linux (AppImage / `.deb`). The installer bundles Node, the `sqlite3` native module, and `ffmpeg` so the user never installs a runtime by hand. Investigate Tauri or Electron as the shell — Tauri preferred for size.
- [x] **First-run wizard (in-app, not in the installer).** When the dashboard opens for the first time it runs a guided setup with these steps, each skippable: (1) Welcome, (2) Model provider (Local / OpenAI / Anthropic inline key entry), (3) Channels (enable channel workers), (4) Workers (enable feature workers), (5) Credentials review (unhealthy workers → navigate to Config), (6) First run (trigger a job). State is KV-persisted via `POST /api/wizard/state`. _(Done 2026-05-26 — `web/src/Wizard.tsx`, two API routes in `src/admin-server.ts`)_
- [x] **Resumable wizard.** The user can quit at any step and the dashboard reopens on the same step. _(Done 2026-05-26 — `wizard.state` KV key persisted on each step advance; loaded on open)_
- [x] **Re-run from settings.** A persistent "Getting started" checklist in the System tab shows 4 setup steps (model, channel, worker, first run) with live completion status and direct "Go →" navigation buttons. _(Done 2026-05-23 — IIFE-rendered getting-started section in System tab using live dashboard state)_
- [x] **Telemetry-free.** A "Zero telemetry" panel in the System tab explicitly states that no data leaves the machine; lists exactly what outbound connections are made and why. _(Done 2026-05-23)_

**Exit criteria:** A tester who has never used the terminal can go from downloading the installer to seeing a news digest in their dashboard in under 15 minutes, without reading any documentation outside the app.

### Workstream B — Channel Connect Flows (Telegram, WhatsApp, Email, more)

**Goal:** connecting a channel is a guided form with screenshots, not a `.env` instruction list.

- [x] **Generalised "connect a channel" UX.** Channel workers register a `kind: 'channel-connect'` `WorkerDashboardViewDefinition` covering their credential surface IDs. `renderWorkerConfigurationSurface` in `App.tsx` looks up the view generically — no worker ids hard-coded there. Existing `TelegramConnectPanel` and `DiscordConnectPanel` components moved from `App.tsx` into their worker dashboard bundles (`web/src/workers/builtin/channels-telegram/dashboard.tsx` and `web/src/workers/builtin/channels-discord/dashboard.tsx`). Adding a new channel (WhatsApp, Email) requires only creating the worker and registering a `channel-connect` view; no `App.tsx` edits needed.
- [x] **Telegram revamp.** Four-step `TelegramConnectPanel`: BotFather walkthrough, paste-and-verify-via-`getMe`, allowed-user-ID setup (with link to `@userinfobot`), Send test message. Backed by `GET /api/workers/telegram/status` + `POST /api/workers/telegram/verify-token` + `POST /api/workers/telegram/test-message`. Replaces the schema-driven form for `core.channels.telegram` only.
- [ ] **WhatsApp worker (`core.channels.whatsapp`).** Decide between two paths and ship one:
  - **WhatsApp Cloud API** (Meta's official Business API). Pros: durable, allowed for automation. Cons: requires a Meta developer account, phone-number registration, and Business verification for production. Connect flow walks through the developer console; we store the token and phone-number-id.
  - **WhatsApp Web bridge** (e.g. `whatsapp-web.js` / `Baileys`). Pros: works with a personal number, QR-code login. Cons: against ToS for some use cases, can be rate-limited or banned. Worker ships with a clear warning.
  - Recommend shipping Cloud API as the documented default, and Web bridge behind an "advanced / personal use" toggle.
- [x] **Email worker (`core.channels.email`).** SMTP-out + IMAP-in (inbox verifier). Connect flow auto-detects Gmail, Fastmail, iCloud, and Outlook and pre-fills all server settings; falls back to a manual form. Includes "Send test email" (SMTP) and "Fetch latest inbox message" (IMAP) verifiers. Send-only in this version — inbound two-way routing deferred (see `src/workers/builtin/channels-email/README.md`). _(Done 2026-05-28 — `src/workers/builtin/channels-email/`, `web/src/workers/builtin/channels-email/dashboard.tsx`)_
- [x] **Discord worker (`core.channels.discord`).** Send-only operator notifications: `notifyOperator(text)` posts to a channel via the Discord HTTP API; chunked at 2k chars. Five-step `DiscordConnectPanel` (Developer Portal → paste-and-verify token via `users/@me` → OAuth invite URL generated from the verified bot's client id → paste channel ID → send test message), with friendly 403/404 hints when the bot lacks permission or the channel can't be found. Two-way receive (gateway WebSocket via discord.js) is not implemented; Telegram remains the two-way channel.
- [ ] **Signal worker (stretch).** Via `signal-cli`; only viable on Linux/macOS, gated behind an "advanced" badge.
- [x] **Channel-agnostic UX in the dashboard.** A dedicated "Channels" tab (between Overview and Jobs in the sidebar) lists every `kind: 'channel'` worker as a collapsible card. Each card shows the display name, tagline, and a Connected/Setup-needed status pill derived from the worker's health state. Clicking a card expands the worker's registered `channel-connect` dashboard view inline (Telegram's four-step panel, Discord's five-step panel, etc.). Adding a new channel requires no changes here — the card appears automatically once the worker is installed. A `channels` SVG icon (radio/broadcast arcs) was added to the icon set. No backend changes were required.

**Exit criteria:** A non-developer can connect Telegram **and** WhatsApp from the dashboard in under 5 minutes each, without reading external documentation.

### Workstream C — Built-In Workers: Operate Without Knowing They Exist

**Goal:** every bundled worker has a dashboard surface a non-developer can use to get value, without ever needing to read the manifest, edit JSON, or write a prompt.

- [x] **Plain-language naming.** Every built-in worker carries a `displayName` / `tagline` on its manifest (`core.news` → "Daily News Digest", `core.publisher.x` → "Post to X", `core.research` → "Research Notes", …); the dashboard reads those for user-facing surfaces and falls back to the technical `name`/`description`.
- [x] **Guided settings forms.** Source-rule string-list fields (`allowHosts`, `blockHosts`, `preferredHosts`, `lowQualityHosts`) now carry `placeholder` and `suggestions` (one-click chips). `WorkerJobPromptManifest` gains an optional `examples` array; the advanced-prompt editor renders them as clickable chips that load the example into the textarea. The research worker ships three example prompts (Default analyst, Executive brief, Deep dive) with a plain-language `helpText`. The "expert" raw textarea stays one toggle away for power users.
- [x] **Recipe-style presets.** `WorkerJobManifest.presets` ships in the manifest type; the News worker offers three one-click recipes (Tech weekday mornings, Daily world news, Weekend long-reads). Applying a preset fills cron + params in the draft; nothing saves until the user clicks Save. Any other job can declare its own.
- [x] **Preview before save (schedule edits).** The schedule editor ("Save schedule" button in the Jobs tab) now shows an inline review panel before committing: lists every changed field (Enabled, Schedule, Model, Require approval) with old → new values in a strikethrough / green-highlight table. The primary button is disabled until there are actual changes; clicking it reveals a "Confirm save" / "Cancel" pair. Dismissing with Cancel returns to editing without side effects. _(Done 2026-05-26 — `confirmSaveJobName` state + IIFE preview panel in `renderJobOperations`, `.schedule-preview-box` CSS)_ Source-rule and prompt-edit previews ("what this would produce on the last run") are deferred to a later workstream.
- [x] **First-class undo.** Settings panels show "Discard changes" alongside Save when the form is dirty. Clicking it clears the draft and restores the last saved values from the server — no data loss possible. Applies to: job schedule editor, job config/params editor, and worker configuration surface forms. _(Done 2026-05-24 — three "Discard changes" buttons in `renderJobOperations`, `renderJobConfiguration`, and `renderWorkerConfigurationSurface`)_
- [ ] **Reduce App.tsx complexity.** The Overview, Queue, and Workers tabs read entirely from worker-declared surfaces (continuing Workstream 1/3 work in `ROADMAP.md`). No worker-specific HTML/JSX in `web/src/App.tsx`. This is a hard prerequisite for the catalog (Workstream D) and the recipe presets above. _(Partial 2026-05-24 — LM Studio runtime-controls panel + MemoryCleanupPanel (~240 lines) moved to `web/src/workers/builtin/providers-lmstudio/dashboard.tsx`; `providerLabel()` now resolves from the worker registry instead of hardcoded strings; chat welcome examples and getting-started checklist text de-coupled from specific worker names. Remaining: `dashboard.lmStudio` API field and cloud API keys form (intentionally kept in core — see user decision).)_
- [x] **Friendlier empty states.** Overview's "Recent events", Events tab, Job runs timeline, Backups, and Workers tab all show actionable empty states with "Open X" buttons; the chat welcome lists four concrete example prompts including the bus-query ones now powered by `core.items.query`.

**Exit criteria:** A non-developer can change the news digest schedule, add a source, preview the next run, and revert a mistake without ever opening a code editor or reading the worker's README.

### Workstream D — Store Integration (bfrost.net) And One-Click Install

**Goal:** the in-dashboard "Store" tab is a native client of `api.bfrost.net` — exactly like WordPress's plugin browser. Workers feel like apps: browsable from inside BFrost, install-on-click, no terminal required. The public catalog at [bfrost.net/store](https://bfrost.net/store) and the in-app tab share the same backend (`api.bfrost.net/v1`). No separate catalog is built inside the app.

> **Architecture decision (2026-05-23):** The store at `bfrost.net` is live and the Cloudflare Workers API at `api.bfrost.net/v1` is deployed. The app's catalog tab will be a **native API client** — not an iframe, not an embedded browser. The app calls the same API endpoints the website uses (`GET /v1/workers`, `GET /v1/workers/:id`, `GET /v1/updates`).

- [x] **Store tab in the dashboard.** A "Store" entry in the sidebar. Calls `GET https://api.bfrost.net/v1/workers` to populate a card grid. Each card shows: display name, tagline, author, trust badge, install count, and a click-through to the detail panel. Typing in the search box calls the API with `?q=`. _(Done 2026-05-23 — `web/src/App.tsx` Store tab + icons.tsx 'store' icon + styles.css card grid)_
- [x] **Worker detail panel.** Clicking a card opens a detail panel showing: tagline, author/version/license/trust meta, permission list, capability summary, Install button (or 'Installed' badge), and a 'View on bfrost.net' link. _(Done 2026-05-23 — `fetchStoreDetail()` hitting `GET /v1/workers/:id`)_
- [x] **Install from store.** The **Install** button downloads the tarball from `bundleUrl`, verifies the `bundleSha256` hash, extracts with `tar -xzf`, moves to `workers/local/<id>/`, and rescans. No `npm install`. No terminal. _(Done 2026-05-23 — `POST /api/store/install` in `admin-server.ts` + `installWorkerFromStore()`)_ **Note:** The permission consent dialog is deferred until the `permissions` runtime (ROADMAP.md Workstream 5) lands — the store detail panel shows declared permissions as a read-only list today.
- [ ] **`bfrost://install?id=&version=` deep-link handler.** Registers a custom URL scheme so the website's **Install** button can launch the app directly. The handler shows the same permission consent dialog before downloading. _(macOS-only initially — see `ROADMAP.md` Non-goals for Windows/Linux status.)_
- [x] **Update notifications.** On startup (and every 24 h), the app calls `GET https://api.bfrost.net/v1/updates?ids=...&versions=...` with the installed worker list. If any worker has a newer version, a badge appears on the Store tab sidebar entry and an update pill in the Workers tab row. _(Done 2026-05-23 — `fetchStoreUpdates()` + `storeUpdates` Map + `coreMenuCount` store case + `renderWorkerRow` update pill)_
- [x] **Sideload without a terminal ("Add from .zip").** A collapsible "Sideload" section in the Store tab opens a file picker. Accepts `.zip`, `.tar.gz`, `.tgz`. Uses the existing `/api/workers/upload` endpoint. _(Done 2026-05-23)_
- [x] **"Don't see it? Propose it."** A footer link at the bottom of the Store tab opens `https://bfrost.net/publish` in the system browser. _(Done 2026-05-23)_

**Blocked on (cross-repo):** `bfrostEngine` field in the manifest schema; `permissions` field enforced at install; `@bfrost/manifest-schema` npm package extraction — see the **Cross-Repo Dependencies** section below.

**Exit criteria:** A non-developer can open the Store tab, search for a community worker, read its README and permissions inside the app, click Install, approve the permissions, and have the worker running — without touching the terminal or the filesystem.

### Workstream E0 — Assistant Can Answer Questions About BFrost's Own State

**Goal:** when a user asks the chat "what's the latest news?" / "what's in the queue?" / "did the research run today?", the assistant can actually look it up. Right now those questions fail because the assistant has no tool that reads the Item Bus or run history.

- [x] **`core.items.query` tool worker.** `src/workers/builtin/items-query/` exposes two assistant tools: `queryItems` (Item Bus reader with filters for `itemType`/`itemTypes`/`producerWorkerId`/`tags`/`states`/`since`/`limit`) and `recentRuns` (scheduler run history). Newest-first ordering, capped at 50 items. Five unit tests in `tools.test.ts` cover limit/ordering, producer filtering, item-type filtering, empty-result messaging, and the human-readable output format.
- [x] **Wire into the assistant catalog.** Registered through `listRegisteredTools()`; `tools.test.ts` now asserts both new tool names appear. No `agent.ts` edits required.
- [x] **Discoverability in chat.** The dashboard chat empty state lists four example prompts including "What are the latest news items I have queued?" and "Did the research job run today?".
- [x] **Plain-language item summaries.** Each producer worker implements `summarizeForAssistant()` so "what's in my queue?" returns rich, human-readable descriptions instead of raw field dumps. _(Done 2026-05-24 — `core.news` implements `summarizeForAssistant`: formats `"News: 'title' from host [state] — short desc"`. `core.research` does not publish to the bus today (see its README); no summarizer needed there.)_

**Exit criteria:** Asking the dashboard chat "what are the latest news fetched?" returns a real list pulled from the Item Bus, with titles, producers, ages, and URLs. The same query works from any connected channel.

### Workstream E — Voice, Natural-Language Control, And In-App Help

**Goal:** the dashboard meets the user where they are. If they want to type a sentence instead of clicking, that works; if they want to talk, that works; if they get stuck, help is in the same window.

- [x] **Conversational control panel.** The existing dashboard chat learns commands that map to dashboard actions: "enable the news digest at 8am", "show me yesterday's queue", "disconnect WhatsApp". Implemented as `core.control`, a thin built-in worker that registers eight assistant tools (`listJobs`, `enableJob`, `disableJob`, `setJobSchedule`, `triggerJob`, `listWorkers`, `enableWorker`, `disableWorker`). Each tool's `execute` function calls internal scheduler and worker-state APIs directly in the same process (no HTTP round-trip). Job and worker names are resolved with fuzzy matching so the model can say "news" and resolve "news-digest". Lazy `require()` calls inside execute break the CJS cycle that would otherwise arise from importing `scheduler.ts` at module initialisation time.
- [ ] **Voice in / voice out from the dashboard.** The current `core.transcribe.whisper` capability is already in the wishlist. Promoting it: a microphone button in the dashboard, push-to-talk transcription, optional spoken responses through any provider with a TTS model.
- [x] **In-app guided help.** Every major panel heading exposes a "?" popover with plain-language guidance. _(Done 2026-05-24 — `HelpTip` component; added to 12 panel headings: Installed worker status, Recent events, Dashboard chat, Schedules and run status, Manifest settings, Model providers, Installed capabilities, Runtime readiness, Local runtime readiness, Backups & database, Factory reset, Recent operations, Channels, Worker Store, LM Studio. Manifest-level `help.md` rendering is a future enhancement.)_
- [x] **Plain-language errors.** `toAppError()` maps raw caught errors (network failures, HTTP status codes, stack traces, timeouts) to short friendly sentences. The global error toast now shows the friendly message with optional "Show details" / "Copy" links — "Show details" expands a scrollable pre block; "Copy" puts a JSON diagnostic bundle (timestamp, friendly + technical message, adminUrl, PID, browser UA) on the clipboard. Per-run errors in the job timeline are truncated to 180 chars with a "Show more" toggle. The `error` state is structured (`{ friendly, detail? }`) throughout; nothing shows a raw stack trace by default.
- [x] **Stuck detector.** If any enabled job has ≥ 3 consecutive error runs, the Overview tab surfaces a warning banner with a "Fix" button per job that navigates to the Jobs tab. `consecutiveErrors` is computed from recent run history in `getSchedulerSnapshot()` and stored on `SchedulerJobState`. _(Done 2026-05-23 — `scheduler.ts` + `admin-api.ts` + `App.tsx` `renderStuckDetectorBanner()`)_

**Exit criteria:** A non-developer can do most day-to-day operations from the chat panel and recover from common failures (expired credential, missing model, schedule conflict) without leaving the dashboard.

### Workstream F — Backups, Safety, And Recoverability For Non-Developers

**Goal:** a non-developer can't accidentally destroy their setup, and recovering from a mistake is one click.

- [x] **Automatic local backups.** Daily snapshots at 03:00 via node-cron. Configurable enable/disable and retention days (default off, 7 days). Auto-pruning keeps at least 2 backups regardless of retention. System tab shows an on/off toggle and a retention-days field. Each backup row has a **Restore** button that marks the backup for apply on next startup (restore-pending marker). On startup, `applyPendingRestoreIfAny()` copies the backup over the main DB before the DB opens. _(Done 2026-05-23 — `app-backup.ts` `startAutoBackup/pruneOldBackups/scheduleRestoreOnNextBoot/applyPendingRestoreIfAny` + `GET|PATCH /api/backups/settings` + `POST /api/backups/:file/restore` + System tab UI)_
- [ ] **Optional encrypted cloud backup.** User-supplied destination (S3-compatible, Google Drive, Dropbox); BFrost itself does not host. Off by default.
- [x] **Credential safety.** API key inputs use `type="password"` with a Show/Hide toggle and a one-click Copy button. Encrypted export bundle deferred. _(Done 2026-05-23 — `showOpenaiKey`/`showAnthropicKey` toggles + clipboard copy in `renderCloudApiKeysConfiguration()`)_
- [x] **Safe-mode boot.** Opening `/?safe=1` disables all workers before the dashboard loads; `POST /api/admin/disable-all-workers` backs it. A "Restart in Safe Mode" button in the System → Danger Zone panel navigates there. _(Done 2026-05-23)_
- [x] **One-click "factory reset".** Wipes worker state but preserves credentials (and vice versa, or both); confirmation dialog spells out exactly what goes. _(Done 2026-05-23 — `POST /api/admin/factory-reset` + `FactoryResetBodySchema` + `closeDb()` in `sqlite.ts` + Danger Zone panel in System tab)_

**Exit criteria:** A non-developer can restore from yesterday's backup, move their setup to a new laptop, and recover from a broken worker, without touching the filesystem.

### Workstream G — Documentation And Onboarding Content

**Goal:** the documentation a non-developer needs is short, visual, and lives next to the thing they're doing.

- [ ] **Two-tier docs.** "For everyone" (visual, task-oriented, screenshot-heavy) vs. "For worker authors" (the existing `docs/worker-authoring.md`). The current docs site adds a clearly-labelled "For everyone" front section.
- [ ] **Five short videos.** Install, connect a channel, enable a worker, edit a schedule, restore from backup. 60–90 seconds each.
- [ ] **Per-channel "How to connect" pages** with screenshots that match what the user sees in BotFather / Meta Developer Console / their email provider's settings page.
- [x] **In-product changelog.** A "What's new" panel in the System tab reads `web/public/whats-new.json` and displays plain-language release notes (version, date, headline, bullet items). _(Done 2026-05-23)_
- [x] **Sample data mode.** "Load sample data" button in the Overview empty state seeds realistic news + research queue items via `POST /api/admin/seed-sample-data`, then refreshes the dashboard. _(Done 2026-05-23)_

**Exit criteria:** A non-developer can answer their own first ten "how do I…?" questions without leaving the app or asking another human.

---

## Cross-Repo Dependencies

These items live in the BFrost application repo but block phases of the website / store roadmap. Each one is a gate; none is optional.

| Item | Blocks | Status |
|------|--------|--------|
| `@bfrost/manifest-schema` npm package (extract `WorkerManifest` + Zod schema from `src/workers/types.ts` + `src/admin-api.ts`) | Website Phase 1 CI gate; store's server-side validation | ❌ Not started |
| `bfrostEngine` semver-range field on `WorkerManifest` | Store compatibility badges; `@bfrost/manifest-schema` publish | ✅ Done — `bfrostEngineRange?: string` on `WorkerManifest` + `WorkerSummarySchema` |
| `permissions` field enforced at install (permission runtime — `ROADMAP.md` Workstream 5) | Trust tiers meaningful; install consent dialog in Workstream D | ❌ Open in `ROADMAP.md` |
| `bfrost pack` CLI command | Store Phase 3 self-serve publishing; author toolchain | ❌ Not started |
| `bfrost worker install <spec>` CLI command | Store Phase 3 one-line install; first-run wizard Step 6 | ❌ Not started |
| `bfrost://install?id=&version=` deep-link handler (macOS) | Store Phase 4 one-click from website | ❌ Not started |
| Admin API: rescan + uninstall as complete operations | Store Phase 3 | ⚠️ Partial |
| In-host catalog tab — Workstream D | Store Phase 4 | ✅ Done 2026-05-23 |
| Update notification polling (`GET /v1/updates`) | Store Phase 4 | ✅ Done 2026-05-23 |

> **Start here:** `@bfrost/manifest-schema` extraction is the highest-leverage item. It unblocks website Phase 1 CI and gives the store and the app a single shared validation contract. The extraction is a mechanical refactor — move `WorkerManifest` and its Zod schema into a new `packages/manifest-schema/` directory, publish to npm as `@bfrost/manifest-schema`, and update imports.

---

## Suggested Sequencing

This roadmap depends on the technical platform reaching the state described in `ROADMAP.md` Workstreams 1, 3, and 4. Beyond that, a realistic order:

1. **Cross-repo: `@bfrost/manifest-schema`** first. Unblocks the website CI gate and is the shared contract everything else depends on. Mechanical, low-risk.
2. **Workstream C** alongside the schema work. Improving the built-in worker dashboards benefits every existing user immediately.
3. **Workstream B** (WhatsApp + Email). The headline feature for a low-code audience.
4. **Workstream D (Store tab MVP)** — fetch and display the store catalog, sideload from .zip. The permission consent and deep-link flow follow once the permission runtime (ROADMAP.md W5) lands.
5. **Workstream F** (backups + safe mode) — blocks any broader public release.
6. **Workstream A** (installer) when B + D are solid enough that packaging them is worthwhile.
7. **Workstreams E, G** in parallel; most items here are polish on top of working features.

---

## Out Of Scope For This Track

- Hosted/cloud BFrost. Everything here stays local-first.
- A worker marketplace with anonymous publishers (still out of scope per `ROADMAP.md`). The store at `bfrost.net` is a community registry, not a marketplace — no hosting, no paid tiers.
- Multi-user accounts inside a single BFrost install.
- Mobile clients. The dashboard should be responsive; native mobile is a separate effort.

---

## Open Questions

- **WhatsApp path.** Cloud API (durable, more setup) vs. Web bridge (frictionless, ToS-risky) — ship one as the documented default? Recommend Cloud API.
- **Installer shell.** Tauri (smaller, Rust-based) vs. Electron (more familiar, larger). Recommend Tauri unless a blocker appears.
- **Telemetry.** Zero telemetry is the current stance and matches the local-first promise. Reconsider only if support load makes blind debugging untenable, and only as opt-in.
- **Conversational control surface.** ~~Implemented as a built-in worker that exposes intents, or as a core capability?~~ **Resolved:** shipped as `core.control` worker. ✅
- **Catalog source of truth.** ~~A curated registry repo vs. a JSON file shipped in-app vs. both.~~ **Resolved (2026-05-23):** `bfrost-workers/registry` on GitHub is the source of truth; `api.bfrost.net/v1` is the live read API; the app's Store tab is a native client of that API. Offline fallback is the bundled `src/data/registry.json` from the website, served via CDN. ✅
