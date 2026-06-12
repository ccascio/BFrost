# Hero GIF / video recording runbook

The README hero GIF is the single highest-converting asset in the repo — most visitors star (or leave) without ever installing. Re-record it whenever the first-run experience changes materially (it must always show the current Pipeline view).

## Target

- **GIF:** ≤ 45 seconds real time, ≤ 15 MB, 1280×800 source, no editing tricks — the honesty *is* the pitch. Saved to `assets/bfrost-demo.gif`.
- **Video (optional, 60–90 s):** same scenes plus a recipe run, narrated. Hosted on the docs site / X, not in the repo.

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
