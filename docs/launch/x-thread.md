# X thread draft

> **Do not post until:** the new hero GIF (Pipeline view) exists — tweet 1 is the GIF. Attach the recap-card screenshot to tweet 3. Post the same week as Show HN / r/selfhosted.

**1/** (attach hero GIF)
Your AI morning digest shouldn't need a cloud service.

BFrost runs scheduled AI pipelines — news → research notes → Telegram — entirely on your machine.

`npx bfrost`, click the demo, watch the pipeline run live. No API key needed.

github.com/ccascio/BFrost

**2/**
The whole platform is one rule: every feature is a worker.

The core only installs, schedules, runs, and observes workers. News, Telegram, the model providers — all plugins on a typed pub/sub bus. Delete one, the feature is gone. The core never changes.

**3/** (attach recap screenshot)
First run = a live show, not an empty dashboard.

A built-in zero-credential model runs a sample news → research pipeline, narrates each stage, then shows you what just happened and how to plug in your own model (it auto-detects LM Studio/Ollama).

**4/**
Local-first means local: SQLite file you own, no telemetry, models via LM Studio/Ollama (or bring a cloud key per-job if you want).

Docker one-liner or `npx bfrost`. MIT.

Feedback and worker ideas welcome → github.com/ccascio/BFrost
