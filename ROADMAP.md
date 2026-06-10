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

- [ ] **Recipes: one-click outcome presets.** A recipe wires existing workers into a named outcome and asks only for what's missing. Launch set of three:
  - *"Morning digest on Telegram"* — news → research → Telegram; asks for a bot token and a topic.
  - *"Watch a topic, write research notes"* — news → research, fully local; asks for a topic only.
  - *"Publish to X from a feed"* — news → publisher-x; asks for X credentials.
  Recipes are data (manifest-level composition), not core code — they configure and enable workers that already exist.
- [ ] **Provider adoption that feels psychic.** On first run, detect a locally running LM Studio or Ollama and offer one-click adoption ("Found LM Studio with 2 models loaded — use it?"). For cloud keys, a paste-one-key flow that immediately fires a test message and shows the reply.
- [ ] **First real result is delivered, not buried.** When the user's first non-demo job completes, push the artifact to wherever they are: a dashboard notification with the result inline, and the configured channel if one exists. Never make them go find it in a table.

**Exit criterion:** a new user with LM Studio already running reaches a personalized, delivered result in under 5 minutes without reading any docs.

## Workstream C — The platform wow (extension feels like magic)

This is the wow for the developer audience — the ones who write the blog posts.

- [ ] **Create a worker by describing it.** A chat-driven flow (dashboard chat + the existing worker-author skill knowledge) where the user describes a capability and BFrost scaffolds, installs, and enables a local worker. Even a constrained v1 (a scheduled job with a prompt and an Item Bus subscription) is enough to demo "I typed a sentence and got a worker".
- [ ] **`npx bfrost new worker`** — CLI scaffold for developers who'd rather start from files; mirrors the author skill's templates.
- [ ] **Hot reload for local workers.** Edit a local worker's source, save, and see it recompile and re-register without restarting BFrost. The esbuild compile-on-load pipeline already exists; add a watcher and a registry swap.

**Exit criterion:** the "describe → worker running" flow is a 30-second clip that developers share on its own.

## Workstream D — Distribution and star conversion

The wow has to be seen to earn stars, and friction kills it before it starts.

- [ ] **Zero-friction install.** `npx bfrost` (or equivalent single command), a Docker one-liner, and a Homebrew tap. `git clone && npm install && npm run build && npm start` is a wow killer — every minute of setup taxes the 60-second budget.
- [ ] **Hero media refresh.** Re-record the README GIF the moment the Pipeline view lands; add a 60–90 second narrated video (demo → recipe → result).
- [ ] **Docs site with a 5-minute quickstart** (carried over from the v1.0 roadmap) whose steps match the wizard exactly — no drift between docs and product.
- [ ] **Ask at the moment of delight.** After the first successful demo or recipe run, show one dismissible, once-ever "Enjoying BFrost? Star it on GitHub ⭐" link. Asking at the peak converts; asking in the README footer doesn't.
- [ ] **Launch beats.** Time Show HN / r/selfhosted / X posts to the Pipeline view + recipes landing together, not to incremental releases.

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
