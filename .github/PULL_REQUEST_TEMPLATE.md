## Summary

What this PR changes, in one or two sentences.

## Scope

- [ ] **Core** — changes inside `src/` outside `src/workers/`, or inside `web/src/` outside `web/src/workers/`. Justify why this can't be a worker change.
- [ ] **Built-in worker** — changes under `src/workers/builtin/<id>/` or `web/src/workers/builtin/<id>/`.
- [ ] **Local / example worker** — changes under `workers/`.
- [ ] **Docs / tests / CI only.**

## Worker-first checks (for core changes)

If this PR touches the core:

- [ ] No worker ids hardcoded in core (`grep -ri "news\|tweet\|publisher\|convertprivately\|research\|telegram" src web --exclude-dir=workers` returns only generic hits).
- [ ] No new core import of worker internals.
- [ ] If the change shifts behaviour visible to workers, `bfrostApiVersion` is bumped and the deprecation note is in this PR's body.

## How I tested this

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build` (frontend)
- [ ] Manual: <one-line description of what you exercised in the dashboard / via the API>

## Linked issues

Closes #
