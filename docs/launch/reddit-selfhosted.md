# r/selfhosted draft

> **Do not post until:** the ghcr image is pullable and docker-compose.yml is on main. This audience will try the compose file within minutes and will ask about security — the answers are in the post, keep them there.

**Title:**

> BFrost — self-hosted AI operations platform (scheduled news → research → publish pipelines), local models, SQLite, no telemetry [MIT]

**Body:**

I've been building BFrost, a self-hosted platform for scheduled AI pipelines — think "harvest news on my topics → write research notes with a local model → deliver to my Telegram every morning", running entirely on your own hardware.

**Self-hosted specifics first, since that's why we're all here:**

- **One container.** `docker compose up -d` with the compose file in the repo, or `docker run -d --name bfrost -p 127.0.0.1:3030:3030 -v bfrost-data:/app/data ghcr.io/ccascio/bfrost`. Also runs bare with `npx bfrost` (Node 20+).
- **Loopback by default.** The compose file publishes on 127.0.0.1 and the bare install binds 127.0.0.1. If you expose it wider, there's a dashboard password (`ADMIN_PASSWORD`), and the compose file has a commented slot for it.
- **All state is one SQLite file** in a named volume (plus run artifacts). Built-in integrity-checked backup/restore from the dashboard.
- **No telemetry, no phone-home, no hosted service.** Models run via LM Studio or Ollama on your host (the compose file includes the host-gateway mapping), or bring an OpenAI/Anthropic key if you want cloud models for specific jobs.
- **Resource footprint is small** — it's a Node scheduler + dashboard; the heavy lifting is whatever model server you point it at.

**What it actually is:** every capability is a pluggable worker (news harvester, research writer, Telegram/Discord/email channels, X/WordPress publishers, model providers). Workers communicate over a typed pub/sub queue, so adding "also publish to Mastodon" is a new worker, not a fork. You can even add one by describing it in plain English (or `npx bfrost new worker`) — BFrost scaffolds and enables it from a safe template. There's a zero-credential live demo on first boot so you can see the pipeline run before configuring anything.

**Honest limitations:** single-user by design. Local worker code you enable runs unsandboxed (file/shell actions go through an approval queue with diff previews, but it's not a jail) — treat third-party workers like you'd treat any self-hosted plugin. Voice features need ffmpeg/whisper on the host.

MIT licensed. Repo: https://github.com/ccascio/BFrost — feedback on the Docker story is especially welcome since it's new.
