# BFrost Roadmap — The "Wow" Release

> The previous technical roadmap (Workstreams 1–7 to v1.0.0) is essentially complete and lives in git history (`git show a293d11:ROADMAP.md`). The few items still open from it are carried over at the bottom. This document is about the next problem: **people download BFrost but don't star it.**

## The diagnosis

Downloads without stars means people try BFrost and leave before the magic happens. A star is earned in a *moment* — something the user sees that is worth sharing. Today that moment doesn't exist reliably: a fresh install greets the user with empty tabs, no model configured, and a dashboard that describes a platform instead of demonstrating one. The zero-credential demo shipped on 2026-06-09 is step zero; this roadmap turns it into a show.

**Definition of "wow", made measurable:**

1. **Time-to-first-signal-of-life < 60 seconds.** From `npm start` to seeing something *alive* on screen — moving, producing, narrating itself — with zero configuration.
2. **Time-to-first-personal-value < 5 minutes.** From first boot to BFrost doing something the user actually cares about (their topic, their Telegram, their model).
3. **The screenshot test.** Every dashboard tab, in its first-run state, should be worth a screenshot. If a tab is empty, the empty state must sell the feature, not apologize for it.
4. **The one-sentence test.** A user can tell a friend what BFrost did for them in one sentence ("it sends me a researched news digest on Telegram every morning, all local").

---

## Workstream A — The first 60 seconds (turn the demo into a show)

The demo must not just *run*; it must perform. Watching is the wow.

- [x] `core.providers.demo` — always-configured zero-credential language model (shipped 2026-06-09).
- [x] Onboarding hero with "Try the live demo — no setup" CTA, dismiss action, and wizard entry point.
- [x] `demoNotice` banners with one-click cleanup of demo artifacts.
- [x] **Live Pipeline view.** An animated graph of the Item Bus: producer workers on the left, consumers on the right, items flowing between them in real time as the demo runs. This is the single highest-leverage feature in this roadmap — it is the screenshot, the GIF, and the launch-post hero image. It must be core-generic (rendered from `producerWorkerId` / `itemType` / `metadata` consumer stamps, no worker names in core).
- [x] **Narrated demo run.** While the demo executes, stream each stage to the UI as it happens ("news worker published 3 items → research worker picked one → note written") instead of showing only the final result. The existing event stream already carries this data; surface it as a progress story, not a log.
- [x] **"What just happened" recap.** When the demo completes, show a short recap card: what ran, which contract it used (producers → Item Bus → consumers), and one CTA — "now plug in a real model (2 minutes)".
- [x] **Anti-wow audit of the first run.** Boot a fresh install and fix everything that looks dead or broken with zero config: health checks that fail loudly for unconfigured optional workers, empty tables with no copy, error toasts the user didn't cause. Every empty state gets one line of pitch plus a CTA.

**Exit criterion:** a screen recording of `npm start` → 60 seconds later is good enough to be the README hero GIF with no editing tricks.

## Workstream B — The first 5 minutes (one real outcome)

The demo proves the machine works; the next five minutes must make it *theirs*.

- [x] **Recipes: one-click outcome presets.** A recipe wires existing workers into a named outcome and asks only for what's missing. Launch set of three:
  - *"Morning digest on Telegram"* — news → research → Telegram; asks for a bot token and a topic.
  - *"Watch a topic, write research notes"* — news → research, fully local; asks for a topic only.
  - *"Publish to X from a feed"* — news → publisher-x; asks for X credentials.
  Recipes are data (manifest-level composition), not core code — they configure and enable workers that already exist.
- [x] **Provider adoption that feels psychic.** On first run, detect a locally running LM Studio or Ollama and offer one-click adoption ("Found LM Studio with 2 models loaded — use it?"). For cloud keys, a paste-one-key flow that immediately fires a test message and shows the reply.
- [x] **First real result is delivered, not buried.** When the user's first non-demo job completes, push the artifact to wherever they are: a dashboard notification with the result inline, and the configured channel if one exists. Never make them go find it in a table.

**Exit criterion:** a new user with LM Studio already running reaches a personalized, delivered result in under 5 minutes without reading any docs.

## Workstream C — The platform wow (extension feels like magic)

This is the wow for the developer audience — the ones who write the blog posts.

- [x] **Create a worker by describing it.** A "Describe a worker" panel in the Workers tab (`POST /api/workers/generate`) where the user types a capability in plain English; a real model emits a constrained JSON spec (`src/workers/scaffold.ts`), which is scaffolded deterministically into a runnable producer/consumer worker, installed, and enabled. The model only fills in the design — the TypeScript is generated from a fixed, contract-safe template, so a worker created this way always loads. Demo provider is rejected for code-gen; needs a real model.
- [x] **`npx bfrost new worker`** — CLI scaffold (`bin/bfrost.mjs new worker`) sharing the same `scaffold.ts` templates as the describe flow, writing into `<home>/workers/local/<id>` without booting the server.
- [x] **Hot reload for local workers.** `src/workers/watch.ts` watches the local worker roots; editing an *enabled* worker's source forces a recompile (busting the esbuild mtime cache and the require cache) and re-registers it through the existing enable/disable lifecycle — no restart. Gated by `BFROST_WORKER_HOT_RELOAD` (default on) + local worker code execution. Also fixed esbuild to resolve bundled deps (`ai`, `zod`) against the host's `node_modules` so workers load from any install location, not just the repo.

**Exit criterion:** the "describe → worker running" flow is a 30-second clip that developers share on its own.

## Workstream D — Distribution and star conversion

The wow has to be seen to earn stars, and friction kills it before it starts.

- [x] **Zero-friction install.** `npx bfrost` (bin entry + publishable package, state in `~/.bfrost`) and a Docker one-liner (`Dockerfile`, `docker-compose.yml`, ghcr publish via the Release workflow). First publish: push a `v*` tag with the `NPM_TOKEN` secret configured. Homebrew tap deliberately deferred — npx + Docker cover the audiences that convert.
- [ ] **Hero media refresh.** Runbook + full 60–90 s narrated video script (demo → recipe → result → describe-a-worker) are ready in [`docs/launch/hero-recording.md`](./docs/launch/hero-recording.md). Remaining: the actual recording is a **human-only** step — record once the Pipeline view is final and commit `assets/bfrost-demo.gif` + the video.
- [x] **Docs site with a 5-minute quickstart** whose steps match the wizard exactly — [`docs/quickstart.md`](./docs/quickstart.md) mirrors all 8 wizard steps and carries a "keep in sync with `web/src/Wizard.tsx`" note so there's no drift. Mirror this page onto the standalone docs site (separate repo) at publish time.
- [x] **Ask at the moment of delight.** After the first successful demo or recipe run, a dismissible, once-ever "Enjoying BFrost? Star it on GitHub ⭐" banner shows on the Overview (`bfrost:star-ask-shown` localStorage key).
- [x] **Launch beats.** Drafts ready and coordinated in [`docs/launch/`](./docs/launch/) (`show-hn.md`, `reddit-selfhosted.md`, `x-thread.md`), each with explicit "do not post until" gates and refreshed to feature the describe-a-worker / `npx bfrost new worker` / hot-reload story. Time all channels to the Pipeline view + recipes landing together, not to incremental releases.

---

## Sequencing

1. **Workstream A** first and completely — it converts the existing download traffic we already get.
2. **Workstream B** (recipes + provider adoption) — turns the demo audience into retained users.
3. **Workstream D** install + media — then launch.
4. **Workstream C** in parallel as capacity allows; it has the longest shareability tail.

## Carried over from the v1.0 technical roadmap

Still open, unchanged in scope (full context in `git show a293d11:ROADMAP.md`):

- [ ] Frontend smoke test for schema-rendered job forms (Workstream 6).
- [ ] Sandbox network-domain and credential-scope allowlists; Playwright session primitive (Workstream 5).
- [ ] Item Bus multi-consumer fan-out, when a real use case appears (Workstream 3).
- [ ] Docs site on GitHub Pages (Workstream 7 — now folded into Workstream D above).
- [ ] Scripted demo recording (Workstream 7 — superseded by the hero media refresh in Workstream D).
- [ ] Channel follow-ups: per-worker secrets/env access for `telegramBotToken` in `src/config.ts` / `src/health.ts` (Workstream 2).

## Out of scope, unchanged

Remote worker loading, hosted marketplace, multi-tenant deployment, cloud-managed BFrost, and sandboxing anonymous third-party workers remain out of scope until the local platform has a community.
