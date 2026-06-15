# Hero GIF / video recording runbook

The README hero GIF is the single highest-converting asset in the repo — most visitors star (or leave) without ever installing. Re-record it whenever the first-run experience changes materially (it must always show the current Pipeline view).

> **This is a human-only step.** Everything below is the runbook; the actual recording, narration, and the resulting `assets/bfrost-demo.gif` / video file have to be produced by a person at a screen. Treat the ROADMAP "Hero media refresh" box as done only once the new files are committed and the README points at them.

## Target

- **GIF:** ≤ 45 seconds real time, ≤ 15 MB, 1280×800 source, no editing tricks — the honesty *is* the pitch. Saved to `assets/bfrost-demo.gif`.
- **Video (60–90 s, narrated):** demo → recipe → result, plus the new *describe-a-worker* moment. Hosted on the docs site / X, not in the repo. Full script below.

## Preparation

1. Fresh state so the onboarding hero shows: `bfrost --home /tmp/bfrost-hero` (or move `~/.bfrost` aside). Quit other LM Studio/Ollama instances unless you want the adoption banner in frame (scene 5 wants it — start LM Studio with a model loaded).
2. Browser window exactly 1280×800, 100 % zoom, light theme of the OS irrelevant (dashboard styles itself).
3. Clear `localStorage` for `127.0.0.1:3030` so the star-ask and first-result banners are armed but not shown.

## Scenes (GIF)

| # | Duration | What's on screen |
|---|----------|------------------|
| 1 | ~3 s | Terminal: type `npx bfrost`, server prints the dashboard URL |
| 2 | ~2 s | Browser opens the Overview — onboarding hero with "Try the live demo — no setup" |
| 3 | ~4 s | Click the CTA — narration stages appear one by one |
| 4 | ~10 s | Switch to the **Pipeline** tab while the demo runs — items flowing producer → bus → consumer. Linger here; this is the money shot |
| 5 | ~5 s | Back to Overview: "What just happened" recap card + (if LM Studio is running) the adoption banner |

End on the recap card, not on a menu.

## Video script (60–90 s, narrated)

Same opening as the GIF, then two payoff scenes the GIF doesn't have: a recipe and the describe-a-worker moment. Keep narration calm and literal — let the product do the talking. Times are cumulative.

| # | At | On screen | Narration (verbatim) |
|---|----|-----------|----------------------|
| 1 | 0:00 | Terminal: `npx bfrost`, dashboard URL prints | "BFrost runs scheduled AI pipelines on your own machine. One command." |
| 2 | 0:06 | Overview — onboarding hero | "First boot isn't an empty dashboard. Click the demo —" |
| 3 | 0:10 | Click **Try the live demo** — stages narrate | "— a built-in model, no API key, runs a sample news-to-research pipeline." |
| 4 | 0:18 | **Pipeline** tab, items flowing producer → bus → consumer | "Every feature is a worker. They talk over a typed bus. This is it running live." |
| 5 | 0:30 | **Recipes** → apply *Morning digest on Telegram*, fill the one missing field | "Want a real outcome? A recipe wires the workers together and asks only for what's missing." |
| 6 | 0:42 | Result lands — recap card, and the Telegram message if wired | "Run it. The result is delivered, not buried in a table." |
| 7 | 0:52 | **Workers** tab → type a sentence into *Describe a worker* → Create | "And when you want something new, you describe it." |
| 8 | 1:02 | The new worker appears enabled; open its dashboard tab | "BFrost designs it, generates the code from a safe template, installs it, turns it on. No file, no restart." |
| 9 | 1:12 | Back to Overview — recap / adoption banner | "Local. Yours. Extensible by asking. `npx bfrost`." |

Trim to land under 90 s; scenes 5 and 7 are the keepers if you need to cut — they're what the GIF can't show. Scene 7–8 also stands alone as a ~15 s clip for X tweet 4 (export it separately).

> The describe-a-worker scene needs a real model connected (the demo provider is rejected for code-gen). Have LM Studio or Ollama running with a chat model loaded, or an OpenAI/Anthropic key set, before recording scenes 7–8.

## Recording & conversion

macOS: QuickTime screen recording (or `cmd-shift-5`), then:

```bash
# trim, scale, and convert to a palette-optimised GIF
ffmpeg -i hero.mov -vf "fps=12,scale=820:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" -loop 0 assets/bfrost-demo.gif
```

If the result is over ~15 MB, drop `fps` to 10 or trim scene 4.

## Checklist before committing

- [ ] Pipeline view visible for at least 8 seconds.
- [ ] No personal data in frame (Telegram handles, API keys, real topics you don't want public).
- [ ] First frame readable as a static image — GitHub shows it before the GIF loads.
- [ ] README alt text still matches what the GIF shows.
