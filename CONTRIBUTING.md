# Contributing

Thanks for considering a BFrost contribution. This project is local-first software, so contribution hygiene matters: avoid committing private operational history, generated notes, local databases, logs, model files, or secrets.

## Local Setup

```bash
npm install
cp .env.example .env
npm run build
npm test
```

Start the app with:

```bash
npm start
```

The dashboard defaults to `http://127.0.0.1:3030`.

## Development Checks

Run these before opening a PR:

```bash
npx tsc --noEmit
npm test
npm run build
```

## Code Style

- Keep changes tightly scoped.
- Prefer existing modules and patterns over new abstractions.
- Use Zod at API boundaries.
- Keep dashboard job controls schema-driven when possible.
- Add tests for registry, manifest, scheduler, API, or migration behavior when touching worker contracts.

## Worker Contributions

Start with `workers/README.md` and the examples under `workers/examples/`.

The first public worker contract is manifest-only. Do not add arbitrary remote code loading or custom worker React bundles without a separate design discussion.

## Before You Commit

Check that these are not included:

- `.env` or secret-bearing files
- `data/` SQLite files, queues, backups, generated notes, or run history
- `logs/`
- `models/`
- local worker scratch directories
- generated `dist/` or `web/dist/` output unless a maintainer explicitly asks
