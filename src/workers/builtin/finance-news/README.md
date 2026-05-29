# core.finance-news

Finance-news **producer**. Searches the web for developments on a watchlist of tickers/companies/themes, optionally has the model keep only what is materially relevant, publishes the survivors to the Item Bus, and can notify your channel when relevant items are found.

> **Informational only.** This worker surfaces and filters news. It does **not** give buy/sell advice and is not a trading signal. By the time news is searchable, the obvious reaction is often already priced in — treat the output as awareness and research, not alpha.

## What it produces

`finance.news` items on the Item Bus. Payload shape:

```jsonc
{
  "tickers": ["AAPL"],            // watchlist names matched in the article (+ the name that found it)
  "category": "earnings",         // best-guess category from the keyword groups
  "source": { "host": "reuters.com", "title": "…" },
  "snippet": "…",                 // search-result snippet
  "articleText": "…",             // extracted article text (capped ~4k chars) for downstream consumers
  "relevanceReason": "…",         // one-line "why it matters" from the AI pass (null if filter off)
  "producedFor": "AAPL",
  "fetchedAt": "2026-05-29T…Z"
}
```

A downstream **consumer** (e.g. an analysis agent) can subscribe to `finance.news`, read `articleText` + `tickers`, and write its own structured read into `metadata['<its-id>']`.

## What it reads

- **Google Web Search** — via the `core.search.google` worker (`searchGoogle`). The `googleSearchConfigured` dependency must be satisfied (configure credentials in the search worker's Config). Note Google Custom Search has a free-tier daily quota; watchlist size × `maxResultsPerName` × schedule frequency drives usage.
- **Article text** — via the `core.article-fetch` worker (`fetchArticle`).
- **A chat model** — only when "Filter for relevance with AI" is on, resolved through the standard model registry.

## Configuration (Jobs panel)

All settings live on the `finance-news-scan` job:

- **Watchlist** — names searched one at a time.
- **News categories** — keyword groups OR'd into each query: `earnings`, `ratings`, `ma`, `regulatory`, `insider`, `macro`, `dividend`, `product`.
- **Investor lens** — `none` / long-value / swing-momentum / short-seller / income / macro. Tunes how the AI relevance pass frames "material"; it is a lens, not a gate.
- **Relevance prompt** — editable (with examples), used only when the AI filter is on.
- **Filter for relevance with AI** — on/off.
- **Notify my channel when relevant items are found** — sends a short summary to the primary channel via `notifyOperatorChannels`.
- Plus `maxResultsPerName`, `maxItems`, `seenTtlHours`, `dateRestrict`.

## Notifications

When **notify** is on and a run produces items, a short digest is delivered to whatever channels are configured as operator-notification targets (Telegram / Discord / email).

## Caveats / roadmap

- Google web search is convenient but a relatively weak finance source (quota, paywalls, latency, low signal). Higher-signal feeds — **SEC EDGAR** (8-K material events, Form 4 insider, 13D/G), company IR RSS — are the intended upgrade and can be added as additional sourcing without changing the item contract.
- The relevance pass is a **filter + one-line note**, not a full impact analysis. The deeper "likely effect on the name" reasoning belongs to a separate consumer worker.
- "Macro" is currently searched as keywords appended to each watchlist name; dedicated macro feeds are a future improvement.
