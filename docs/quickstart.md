# 5-minute quickstart

This walks you from nothing to your first real, scheduled result. It mirrors the in-app setup wizard step for step — the same wizard opens automatically on first boot, so you can follow along either here or on screen. Every step after the first is skippable; you can always come back from the dashboard tabs.

> **Keep this in sync.** These steps must match the wizard (`web/src/Wizard.tsx`) exactly — if you change a wizard step, change the matching section here. The product is the source of truth; the docs follow it.

## 0. Install and open (≈30 s)

Requires **Node.js 20+** (enough for the zero-config demo).

```bash
npx bfrost
```

…or with Docker:

```bash
docker run -d --name bfrost -p 127.0.0.1:3030:3030 -v bfrost-data:/app/data ghcr.io/ccascio/bfrost
```

Open <http://127.0.0.1:3030>. With `npx`, all state lives in `~/.bfrost` (override with `--home <dir>`; run `bfrost --help` for flags).

The setup wizard opens on first boot. The eight steps below match it.

## 1. Welcome — see it run with zero setup (≈30 s)

Click **“Try the live demo — no setup.”** A built-in, zero-credential model runs a sample news → research pipeline on the Item Bus and narrates each stage ("news worker published 3 items → research worker picked one → note written"). When it finishes you get a **“What just happened”** recap card.

This needs no API key and no model — it exists so you see the platform alive before configuring anything. Switch to the **Pipeline** tab while it runs to watch items flow producer → bus → consumer.

## 2. Connect a model provider (≈1 min)

Pick the model that will power your real jobs:

- **Already running LM Studio or Ollama?** BFrost detects it and offers one-click adoption ("Found LM Studio — 2 models loaded — use it?"). Accept it and you're done.
- **Prefer cloud?** Paste an OpenAI or Anthropic API key; BFrost immediately fires a test message and shows the reply so you know it works.

Everything after this point uses the model you choose here. (No model yet? You can still finish the wizard and add one later from the **Models** tab.)

## 3. Long-term memory embeddings (optional)

If you want the assistant to remember things across conversations, enable embeddings. This uses your OpenAI key from the previous step and requires the embeddings endpoint. **Skip it** if you don't need long-term memory — it changes nothing else.

## 4. Connect a channel (optional)

Where should results be delivered? Add a **Telegram**, **Discord**, or **email** channel and paste its credentials (e.g. a Telegram bot token from @BotFather). **Skip** to keep everything in the dashboard — you can add channels any time later.

## 5. Enable workers (≈1 min)

Turn on the capabilities you want. Each worker is a self-contained feature — a news harvester, a research-note writer, an X/WordPress publisher, and so on. Toggling one on adds its jobs and tools; toggling it off removes them. Start with one or two (the **News Digest** is a good first pick).

> Tip: you don't have to assemble workers by hand. **Recipes** (one-click outcome presets like *"Morning digest on Telegram"*) wire several workers together and ask only for what's missing. And on the **Workers** tab you can **describe a worker in plain English** and BFrost will scaffold, install, and enable it for you.

## 6. Credentials needed (≈1 min)

The wizard lists any credentials the workers you enabled still require (e.g. a Google API key for web-search-backed digests, X keys for publishing). Fill in the ones you need; leave the rest. Each entry links to where to get it.

## 7. Run your first job (≈30 s)

Pick an enabled job and click **Run now**. It runs immediately using your configured model. When it finishes, the result is pushed to you — inline in the dashboard, and to your configured channel if you set one up — so you never have to go digging in a table for it. The wizard shows a ✓ with the run summary.

This is the moment that matters: a personalized result, delivered, in well under five minutes.

## 8. Platform & security (optional)

BFrost binds to `127.0.0.1` by default. Sensible defaults already apply; these controls are all optional:

- **Dashboard password** (`ADMIN_PASSWORD`) — set one if you'll expose BFrost beyond loopback.
- **Session length** and **job model timeout** — tune if needed.
- **Allow local worker code** — required to run local workers that ship code, including the ones you create with **“describe a worker”** or `npx bfrost new worker`. Off by default; turn it on only for code you trust.

Finish the wizard. You now have a running, scheduled AI pipeline on your own machine.

---

## Where to go next

- **Add a capability the easy way:** Workers tab → *Describe a worker*, or [`docs/worker-authoring.md`](./worker-authoring.md) to build one by hand.
- **Scaffold from the CLI:** `bfrost new worker "Daily standup summary"` writes a worker into `~/.bfrost/workers/local/` — enable it from the Workers tab.
- **Understand the plumbing:** [`docs/item-bus.md`](./item-bus.md) covers the Item Bus and per-worker storage.
