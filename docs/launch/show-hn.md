# Show HN draft

> **Do not post until:** `npx bfrost` works against the published npm package, the ghcr image is pullable, and the README hero GIF shows the Pipeline view. Launch all channels the same week (see r/selfhosted and X drafts in this folder).

**Title** (keep under 80 chars):

> Show HN: BFrost – local AI ops platform where every feature is a pluggable worker

**URL:** https://github.com/ccascio/BFrost

**First comment (post it yourself immediately after submitting):**

Hi HN — I built BFrost because I wanted my "AI automations" (morning news digest, research notes on topics I follow, posting to X) to run on my own machine, on a schedule, without a hosted service in the loop.

The design rule that shaped everything: **every capability is a worker.** The core only knows how to install, configure, schedule, run, observe, and uninstall workers. News harvesting, the Telegram channel, the LM Studio/OpenAI/Anthropic providers, even the assistant's tools — all workers, all using the same contract a third-party contributor would. Removing a worker removes the feature; the core has zero references to any specific one.

Workers talk through a typed pub/sub Item Bus backed by SQLite: producers publish items, consumers subscribe and write their outcome into their own metadata slice. Adding "publish to Mastodon" is a new consumer, not a core change. Local workers can ship TypeScript source — esbuild compiles them on first load, and their dashboard panels share the host's React at runtime.

Because the contract is that strict, extending the platform feels less like coding and more like asking. Three ways in, all on the same scaffold:

- **Describe it.** Type "every morning write me one calm haiku" into the Workers tab. A model fills in a constrained JSON spec — id, schedule, item type, prompt — and BFrost generates the worker's TypeScript from a fixed, contract-safe template, installs it, and enables it. The model never writes code, so a flaky model can't produce a worker that fails to load.
- **Scaffold from the CLI.** `npx bfrost new worker "Daily standup summary"` writes the same files for developers who'd rather start from source.
- **Hot reload.** Edit a local worker's source, save, and it recompiles and re-registers in place — no restart.

Try it without configuring anything:

    npx bfrost

then click "Try the live demo — no setup" — it runs a sample news → research pipeline on the bus with a built-in zero-credential model, narrating each stage. With LM Studio or Ollama already running, it detects it and offers one-click adoption.

Honest caveats: single-user by design; local worker code runs unsandboxed (file/shell actions go through a scoped approval queue, but network/credential scopes are still on the roadmap), so only enable code you trust; and the bundled workers are opinionated reference implementations.

Stack: Node 20+, SQLite (better-sqlite3), React dashboard, no framework on the backend. MIT licensed.

I'd love feedback on the worker contract itself — the manifest/adapter shape is the part I've rewritten the most and the part I most want outside eyes on.
