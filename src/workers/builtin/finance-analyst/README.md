# core.finance-analyst

Finance-analyst **consumer**. Subscribes to `finance.news` items (produced by `core.finance-news`) and attaches a **structured, informational read** of the likely market impact to each one. Optionally delivers a digest of the reads to your channel.

> **Informational only — not financial advice.** This worker never tells you to buy, sell, or hold. It characterises a *likely* reaction and the mechanism, grounded only in the article text, and is required to express uncertainty (including whether a move is probably already priced in). News-driven reads are frequently wrong and frequently late; treat them as a thinking aid, not a signal.

## What it consumes / writes

- **Consumes:** `finance.news` items on the Item Bus (unhandled ones only — it skips items it has already analysed).
- **Writes:** its read into `metadata['core.finance-analyst']` on each item — it does **not** change the item's state, so producers and other consumers are unaffected.

Per-item read:

```jsonc
{
  "analyzedAt": "2026-05-29T…Z",
  "direction": "up" | "down" | "mixed" | "unclear",
  "magnitude": "low" | "moderate" | "high",
  "horizon": "intraday" | "days" | "weeks" | "months" | "unclear",
  "confidence": "low" | "medium" | "high",
  "pricedIn": "likely" | "partly" | "unlikely" | "unclear",
  "mechanism": "why this could move the name",
  "note": "optional caveat"
}
```

## Configuration (Jobs panel)

On the `finance-analysis` job:

- **Items to analyse per run** — most recent unhandled items first.
- **Investor lens** — tilts emphasis (long-value / swing-momentum / short-seller / income / macro); it changes emphasis, not facts.
- **Analysis prompt** — editable (with examples). Kept deliberately informational.
- **Send the reads to my channel** — delivers a compact digest via `notifyOperatorChannels` (Telegram / Discord / email).

Default cron (`20 7,13,19 * * 1-5`) runs ~20 minutes after the finance-news scan presets so fresh items already exist when it runs.

## Reads

- **A chat model**, resolved through the standard registry. The article text stored by the producer (`payload.articleText`, capped) is what the model sees — it never fetches anything itself.

## Caveats

- This is a built-in worker because it delivers reads to operator channels (`notifyOperatorChannels` is not part of the local-worker SDK).
- It analyses one article at a time (batched into a single model call per run). It does not yet aggregate multiple articles about the same name into one combined thesis — that is a future improvement.
- It depends on `core.finance-news` (or any producer emitting `finance.news` items with an `articleText`/`snippet` payload).
