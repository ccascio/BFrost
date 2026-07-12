# core.finance-analyst

Finance-analyst **consumer**. Subscribes to `finance.news` items (produced by `core.finance-news`) and attaches **structured BUY, HOLD, or SELL advice plus a practical non-trading research priority** for every verified target. Optionally delivers a digest of the priorities to your channel.

The worker is deliberately advisory. It must choose BUY, HOLD, or SELL instead of hiding uncertainty behind a non-answer. Its separate `attention` field tells the operator whether to investigate, watch, do no further research, or treat the article as insufficient evidence; it never executes a trade.

## What it consumes / writes

- **Consumes:** `finance.news` items on the Item Bus. It skips items already analysed with the current advice schema and automatically revisits legacy reads after schema upgrades.
- **Writes:** its read into `metadata['core.finance-analyst']` on each item — it does **not** change the item's state, so producers and other consumers are unaffected.

Per-item read:

```jsonc
{
  "analyzedAt": "2026-05-29T…Z",
  "recommendations": [{
    "target": "AAPL",
    "recommendation": "buy" | "hold" | "sell",
    "attention": "act_on_research" | "watch" | "no_action" | "insufficient_evidence",
    "catalyst": "the specific development to investigate",
    "evidence": "facts from the article that support the priority",
    "direction": "up" | "down" | "mixed" | "unclear",
    "magnitude": "low" | "moderate" | "high",
    "horizon": "intraday" | "days" | "weeks" | "months" | "unclear",
    "confidence": "low" | "medium" | "high",
    "pricedIn": "likely" | "partly" | "unlikely" | "unclear",
    "mechanism": "why this could move the target",
    "risks": "what could invalidate the recommendation",
    "nextCheck": "the next concrete fact to verify"
  }]
}
```

Advice metadata carries `analysisVersion: 3`. Items with an older analysis version are automatically eligible for reanalysis after the upgrade.

## Configuration (Jobs panel)

On the `finance-analysis` job:

- **Items to analyse per run** — most recent unhandled items first.
- **Investor lens** — tilts emphasis (long-value / swing-momentum / short-seller / income / macro); it changes emphasis, not facts.
- **Risk tolerance** — conservative / balanced / aggressive recommendation calibration.
- **Portfolio context** — optional holdings, cost basis, horizon, position limits, and constraints passed into every analysis.
- **Analysis prompt** — editable, with decisive and mechanism-first examples.
- **Send the advice to my channel** — delivers a compact priority and recommendation digest via `notifyOperatorChannels` (Telegram / Discord / email).

Default cron (`20 7,13,19 * * 1-5`) runs ~20 minutes after the finance-news scan presets so fresh items already exist when it runs.

## Reads

- **A chat model**, resolved through the standard registry. It receives the complete `payload.articleText` stored by the producer with targets, category, source, search targets, relevance reason, timestamps, content quality, snippet, tags, risk tolerance, and portfolio context. The analyst no longer truncates article text to 2,500 characters.

## Caveats

- This is a built-in worker because it delivers reads to operator channels (`notifyOperatorChannels` is not part of the local-worker SDK).
- It analyses multiple articles in one model call per run. It does not yet aggregate several articles about the same name into one combined thesis — that is a future improvement.
- It depends on `core.finance-news` (or any producer emitting `finance.news` items with an `articleText`/`snippet` payload).
- Advice quality still depends on source quality and available context. A recommendation with low confidence should be checked against the emitted risks and `nextCheck` before action.
- `attention` is a research workflow signal: `act_on_research` means investigate promptly, `watch` means wait for confirmation, `no_action` means no further research is warranted now, and `insufficient_evidence` means the article cannot support a reliable priority.
