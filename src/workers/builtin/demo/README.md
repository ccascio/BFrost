# `core.demo` — zero-config demo

The first-run "wow": a single click that shows BFrost working before you configure anything.

## What it does

Contributes a first-run call-to-action (`onboarding`) that the platform renders on the setup
wizard's welcome step and the overview empty state. Activating it runs the `demo-run` job,
which:

1. Publishes four realistic sample articles as `news.article` items on the Item Bus.
2. Synthesizes a short Markdown research note from them.
3. Stores a snapshot of the run for the dashboard surface.

The whole pipeline is **self-contained** — no API key, no model, no network call. Re-running
clears the previous demo items first, so the queue stays tidy.

## Produces

- `news.article` items tagged `demo`, with `producerWorkerId: core.demo` and `payload.demo: true`.

These are real bus items, so if you later enable `core.research` or `core.publisher.x` they
will pick them up like any other article — the demo is also a working producer.

## Consumes / credentials

Nothing. No `requiredCredentials`, so the worker is healthy out of the box and its job can be
triggered the moment BFrost boots.

## Removing it

It is `deletable`. Disable or delete `core.demo` once your own workers are set up — its
onboarding CTA disappears automatically, because the core only renders CTAs the registry
exposes. Removing the worker removes the feature; the core never references it by name.
