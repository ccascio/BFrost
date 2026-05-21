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
- [ ] **First-run wizard (in-app, not in the installer).** When the dashboard opens for the first time it runs a guided setup with these steps, each skippable:
  1. **Welcome + what BFrost does** in two sentences and one screenshot.
  2. **Pick a model provider.** Three tabs, equal weight: **Local** (detect LM Studio / Ollama if present; otherwise one-click "Download LM Studio" with a progress bar and a model picker), **OpenAI** (paste an API key, pick a model from a fetched list, "Test" button), **Anthropic** (same shape — paste key, pick a Claude model, test). The user can connect more than one and switch the active provider later from Settings. Cloud providers ship as their own workers (`core.providers.openai`, `core.providers.anthropic`) — currently in the `ROADMAP.md` wish list; promoted to a low-code blocker here because a non-developer with a ChatGPT/Claude subscription should not have to install a local model just to try BFrost.
  3. **Pick channels.** A checklist (Telegram, WhatsApp, Email, Dashboard-only). Each checked channel opens a focused mini-flow (see Workstream B). Skipping is fine — the dashboard chat works without any channel.
  4. **Pick what BFrost should do for you.** A worker catalog (see Workstream D) filtered to "starter" workers. The user toggles on the ones that match their goals ("Daily news digest", "Voice memos transcribed", "Publish to my blog"). Each toggle shows the credentials it will ask for next.
  5. **Collect credentials.** A single form generated from each enabled worker's manifest (`requiredCredentials`). Inline help, masked inputs, "Test connection" buttons.
  6. **First run.** Schedule the enabled workers and trigger one of them immediately so the user sees output before leaving the wizard.
- [ ] **Resumable wizard.** The user can quit at any step and the dashboard reopens on the same step.
- [ ] **Re-run from settings.** "Restart setup" is always reachable from the Settings tab.
- [ ] **Telemetry-free.** The wizard records progress locally only; nothing leaves the machine.

**Exit criteria:** A tester who has never used the terminal can go from downloading the installer to seeing a news digest in their dashboard in under 15 minutes, without reading any documentation outside the app.

### Workstream B — Channel Connect Flows (Telegram, WhatsApp, Email, more)

**Goal:** connecting a channel is a guided form with screenshots, not a `.env` instruction list.

- [x] **Generalised "connect a channel" UX.** Channel workers register a `kind: 'channel-connect'` `WorkerDashboardViewDefinition` covering their credential surface IDs. `renderWorkerConfigurationSurface` in `App.tsx` looks up the view generically — no worker ids hard-coded there. Existing `TelegramConnectPanel` and `DiscordConnectPanel` components moved from `App.tsx` into their worker dashboard bundles (`web/src/workers/builtin/channels-telegram/dashboard.tsx` and `web/src/workers/builtin/channels-discord/dashboard.tsx`). Adding a new channel (WhatsApp, Email) requires only creating the worker and registering a `channel-connect` view; no `App.tsx` edits needed.
- [x] **Telegram revamp.** Four-step `TelegramConnectPanel`: BotFather walkthrough, paste-and-verify-via-`getMe`, allowed-user-ID setup (with link to `@userinfobot`), Send test message. Backed by `GET /api/workers/telegram/status` + `POST /api/workers/telegram/verify-token` + `POST /api/workers/telegram/test-message`. Replaces the schema-driven form for `core.channels.telegram` only.
- [ ] **WhatsApp worker (`core.channels.whatsapp`).** Decide between two paths and ship one:
  - **WhatsApp Cloud API** (Meta's official Business API). Pros: durable, allowed for automation. Cons: requires a Meta developer account, phone-number registration, and Business verification for production. Connect flow walks through the developer console; we store the token and phone-number-id.
  - **WhatsApp Web bridge** (e.g. `whatsapp-web.js` / `Baileys`). Pros: works with a personal number, QR-code login. Cons: against ToS for some use cases, can be rate-limited or banned. Worker ships with a clear warning.
  - Recommend shipping Cloud API as the documented default, and Web bridge behind an "advanced / personal use" toggle.
- [ ] **Email worker (`core.channels.email`).** SMTP-out + IMAP-in. Connect flow auto-detects common providers (Gmail, Fastmail, iCloud) and pre-fills server settings; falls back to a manual form. Includes "Send test email" and "Fetch latest inbox message" verifiers.
- [x] **Discord worker (`core.channels.discord`).** Send-only operator notifications: `notifyOperator(text)` posts to a channel via the Discord HTTP API; chunked at 2k chars. Five-step `DiscordConnectPanel` (Developer Portal → paste-and-verify token via `users/@me` → OAuth invite URL generated from the verified bot's client id → paste channel ID → send test message), with friendly 403/404 hints when the bot lacks permission or the channel can't be found. Two-way receive (gateway WebSocket via discord.js) is not implemented; Telegram remains the two-way channel.
- [ ] **Signal worker (stretch).** Via `signal-cli`; only viable on Linux/macOS, gated behind an "advanced" badge.
- [x] **Channel-agnostic UX in the dashboard.** A dedicated "Channels" tab (between Overview and Jobs in the sidebar) lists every `kind: 'channel'` worker as a collapsible card. Each card shows the display name, tagline, and a Connected/Setup-needed status pill derived from the worker's health state. Clicking a card expands the worker's registered `channel-connect` dashboard view inline (Telegram's four-step panel, Discord's five-step panel, etc.). Adding a new channel requires no changes here — the card appears automatically once the worker is installed. A `channels` SVG icon (radio/broadcast arcs) was added to the icon set. No backend changes were required.

**Exit criteria:** A non-developer can connect Telegram **and** WhatsApp from the dashboard in under 5 minutes each, without reading external documentation.

### Workstream C — Built-In Workers: Operate Without Knowing They Exist

**Goal:** every bundled worker has a dashboard surface a non-developer can use to get value, without ever needing to read the manifest, edit JSON, or write a prompt.

- [x] **Plain-language naming.** Every built-in worker carries a `displayName` / `tagline` on its manifest (`core.news` → "Daily News Digest", `core.publisher.x` → "Post to X", `core.research` → "Research Notes", …); the dashboard reads those for user-facing surfaces and falls back to the technical `name`/`description`.
- [x] **Guided settings forms.** Source-rule string-list fields (`allowHosts`, `blockHosts`, `preferredHosts`, `lowQualityHosts`) now carry `placeholder` and `suggestions` (one-click chips). `WorkerJobPromptManifest` gains an optional `examples` array; the advanced-prompt editor renders them as clickable chips that load the example into the textarea. The research worker ships three example prompts (Default analyst, Executive brief, Deep dive) with a plain-language `helpText`. The "expert" raw textarea stays one toggle away for power users.
- [x] **Recipe-style presets.** `WorkerJobManifest.presets` ships in the manifest type; the News worker offers three one-click recipes (Tech weekday mornings, Daily world news, Weekend long-reads). Applying a preset fills cron + params in the draft; nothing saves until the user clicks Save. Any other job can declare its own.
- [ ] **Preview before save.** Source-rule edits, prompt edits, and schedule changes all show "Here's what this would have produced on the last run" before the user clicks Save.
- [ ] **First-class undo.** Settings changes are versioned. The settings panel always shows "Revert to last known good" alongside Save.
- [ ] **Reduce App.tsx complexity.** The Overview, Queue, and Workers tabs read entirely from worker-declared surfaces (continuing Workstream 1/3 work in `ROADMAP.md`). No worker-specific HTML/JSX in `web/src/App.tsx`. This is a hard prerequisite for the catalog (Workstream D) and the recipe presets above.
- [x] **Friendlier empty states.** Overview's "Recent events", Events tab, Job runs timeline, Backups, and Workers tab all show actionable empty states with "Open X" buttons; the chat welcome lists four concrete example prompts including the bus-query ones now powered by `core.items.query`.

**Exit criteria:** A non-developer can change the news digest schedule, add a source, preview the next run, and revert a mistake without ever opening a code editor or reading the worker's README.

### Workstream D — Worker Catalog And One-Click Install

**Goal:** workers feel like apps — browsable, install-on-click, configure-with-a-form.

- [ ] **In-dashboard catalog tab.** Lists bundled workers, local workers, and (later) curated community workers. Each card shows display name, one-sentence description, icon, required credentials, and an Install / Enable / Configure button.
- [ ] **Search and filter.** By category (Channels, Publishing, Research, Tools, Providers) and by capability tag (`sends-messages`, `posts-publicly`, `reads-files`).
- [ ] **Worker proposals from inside the app.** "Don't see what you need?" links to a short form (or a GitHub Discussion) for proposing new workers, with the requestor's use case pre-templated.
- [ ] **Local installation without a terminal.** A "Add from folder" or "Add from .zip" button next to Rescan, so a non-developer can install a worker someone shared with them. (Honors the worker-first contract — drop into `workers/local/`, run the existing compile-on-load pipeline.)
- [ ] **Per-worker review surface.** When a worker first asks to do something risky (post publicly, send messages, write a file), the user sees a clear dialog explaining what it wants and a single Approve / Decline. This is the user-facing half of Workstream 5 from `ROADMAP.md`.

**Exit criteria:** A non-developer can browse the catalog, install a community worker someone sent them as a `.zip`, fill in its credentials, and run it — all from the dashboard.

### Workstream E0 — Assistant Can Answer Questions About BFrost's Own State

**Goal:** when a user asks the chat "what's the latest news?" / "what's in the queue?" / "did the research run today?", the assistant can actually look it up. Right now those questions fail because the assistant has no tool that reads the Item Bus or run history.

- [x] **`core.items.query` tool worker.** `src/workers/builtin/items-query/` exposes two assistant tools: `queryItems` (Item Bus reader with filters for `itemType`/`itemTypes`/`producerWorkerId`/`tags`/`states`/`since`/`limit`) and `recentRuns` (scheduler run history). Newest-first ordering, capped at 50 items. Five unit tests in `tools.test.ts` cover limit/ordering, producer filtering, item-type filtering, empty-result messaging, and the human-readable output format.
- [x] **Wire into the assistant catalog.** Registered through `listRegisteredTools()`; `tools.test.ts` now asserts both new tool names appear. No `agent.ts` edits required.
- [x] **Discoverability in chat.** The dashboard chat empty state lists four example prompts including "What are the latest news items I have queued?" and "Did the research job run today?".
- [ ] **Plain-language item summaries (future).** Each producer worker could declare an optional `summarizeForAssistant(item) => string` on its manifest; the query tool would call it when available. Not implemented yet — the current output uses producer/itemType/state/age + shortDesc + url, which is enough for News today.

**Exit criteria:** Asking the dashboard chat "what are the latest news fetched?" returns a real list pulled from the Item Bus, with titles, producers, ages, and URLs. The same query works from any connected channel.

### Workstream E — Voice, Natural-Language Control, And In-App Help

**Goal:** the dashboard meets the user where they are. If they want to type a sentence instead of clicking, that works; if they want to talk, that works; if they get stuck, help is in the same window.

- [ ] **Conversational control panel.** The existing dashboard chat learns commands that map to dashboard actions: "enable the news digest at 8am", "show me yesterday's queue", "disconnect WhatsApp". Implemented as a thin worker that exposes intents to the assistant.
- [ ] **Voice in / voice out from the dashboard.** The current `core.transcribe.whisper` capability is already in the wishlist. Promoting it: a microphone button in the dashboard, push-to-talk transcription, optional spoken responses through any provider with a TTS model.
- [ ] **In-app guided help.** Every screen has a "?" that opens a contextual panel with a short explanation, screenshots, and (where useful) a one-click "Show me" that walks the user through the relevant fields. Powered by per-worker `help.md` files in the manifest folder.
- [ ] **Plain-language errors.** Replace stack traces and raw HTTP errors with user-facing messages plus a "Show technical details" toggle. Includes a "Copy diagnostic bundle" button for support.
- [ ] **Stuck detector.** If a worker has been failing or unconfigured for N runs, the dashboard surfaces a banner with a single Fix button that opens the relevant settings panel.

**Exit criteria:** A non-developer can do most day-to-day operations from the chat panel and recover from common failures (expired credential, missing model, schedule conflict) without leaving the dashboard.

### Workstream F — Backups, Safety, And Recoverability For Non-Developers

**Goal:** a non-developer can't accidentally destroy their setup, and recovering from a mistake is one click.

- [ ] **Automatic local backups.** Daily snapshots of `data/` (excluding model binaries) retained for N days. Configurable retention. Restore-from-backup is a button in Settings, with a preview of what will change.
- [ ] **Optional encrypted cloud backup.** User-supplied destination (S3-compatible, Google Drive, Dropbox); BFrost itself does not host. Off by default.
- [ ] **Credential safety.** Credentials in the dashboard are masked, copy-revealed, and exportable as an encrypted bundle (never plaintext) so the user can move between machines.
- [ ] **Safe-mode boot.** A keyboard shortcut at startup launches the dashboard with all workers disabled, so a misbehaving worker can never lock the user out.
- [ ] **One-click "factory reset".** Wipes worker state but preserves credentials (and vice versa); confirmation dialog spells out exactly what goes.

**Exit criteria:** A non-developer can restore from yesterday's backup, move their setup to a new laptop, and recover from a broken worker, without touching the filesystem.

### Workstream G — Documentation And Onboarding Content

**Goal:** the documentation a non-developer needs is short, visual, and lives next to the thing they're doing.

- [ ] **Two-tier docs.** "For everyone" (visual, task-oriented, screenshot-heavy) vs. "For worker authors" (the existing `docs/worker-authoring.md`). The current docs site adds a clearly-labelled "For everyone" front section.
- [ ] **Five short videos.** Install, connect a channel, enable a worker, edit a schedule, restore from backup. 60–90 seconds each.
- [ ] **Per-channel "How to connect" pages** with screenshots that match what the user sees in BotFather / Meta Developer Console / their email provider's settings page.
- [ ] **In-product changelog.** A "What's new" panel that surfaces new workers and UI changes in plain language ("Added WhatsApp support" — not "Bumped channel-worker contract to v3").
- [ ] **Sample data mode.** A toggle that seeds the dashboard with realistic-looking fake data so a first-time user has something to look at while their workers run for the first time.

**Exit criteria:** A non-developer can answer their own first ten "how do I…?" questions without leaving the app or asking another human.

---

## Suggested Sequencing

This roadmap depends on the technical platform reaching the state described in `ROADMAP.md` Workstreams 1, 3, and 4. Beyond that, a realistic order:

1. **Workstream C** first. Improving the built-in worker dashboards benefits every existing user immediately and proves the patterns the catalog (D) will reuse.
2. **Workstream B** alongside C. WhatsApp + a polished Telegram flow are the headline feature for a low-code audience.
3. **Workstream D** once C's patterns are stable.
4. **Workstream A** when B + D are good enough that an installer is a worthwhile thing to ship. Building a Tauri/Electron installer earlier wraps an unfinished UX.
5. **Workstreams E, F, G** in parallel with the above; F (backups + safe mode) blocks any broader public release.

---

## Out Of Scope For This Track

- Hosted/cloud BFrost. Everything here stays local-first.
- A worker marketplace with anonymous publishers (still out of scope per `ROADMAP.md`).
- Multi-user accounts inside a single BFrost install.
- Mobile clients. The dashboard should be responsive; native mobile is a separate effort.

---

## Open Questions

- **WhatsApp path.** Cloud API (durable, more setup) vs. Web bridge (frictionless, ToS-risky) — ship one as the documented default? Recommend Cloud API.
- **Installer shell.** Tauri (smaller, Rust-based) vs. Electron (more familiar, larger). Recommend Tauri unless a blocker appears.
- **Telemetry.** Zero telemetry is the current stance and matches the local-first promise. Reconsider only if support load makes blind debugging untenable, and only as opt-in.
- **Conversational control surface.** Implemented as a built-in worker that exposes intents, or as a core capability? Leaning worker, to stay honest about the worker-first contract.
- **Catalog source of truth.** A curated registry repo (like `awesome-bfrost`) vs. a JSON file shipped in-app vs. both. Probably both, with the shipped file as a fallback when offline.
