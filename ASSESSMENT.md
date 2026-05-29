# BFrost — Expert Assessment

**Date:** 2026-05-29 · **Version assessed:** 0.2.0 (`main`) · **Scope:** development practice, security, functional fitness, completeness.

This is a read-only review. Nothing in the codebase was modified. Severities are calibrated against the project's own stated threat model (`SECURITY.md`): BFrost is a **local-first, single-operator** app bound to `127.0.0.1`, and it explicitly does **not** sandbox worker code.

---

## 1. Verdict

BFrost is a genuinely well-architected codebase for a 0.2.0. The "every capability is a worker" contract is not just documentation — it is visibly enforced in the code (dynamic registry, no hard-coded worker ids in core, dispatch-through-adapter for providers/channels/tools). Test discipline is strong (34 test files, CI matrix on Node 20/22). The security primitives that exist are implemented correctly.

The main risks are **not** code-quality bugs; they are **default-configuration posture** and a **documentation/control mismatch**. Two findings below (S1, S2) deserve action before any non-hobbyist deployment. Everything else is incremental.

---

## 2. Strengths (verified, not assumed)

- **Worker-first contract is real.** Core (`src/` outside `src/workers/`) dispatches every provider/channel/tool through the registry; `llm.ts` has no per-provider branch. This is the project's biggest architectural asset and it holds up under inspection.
- **No shell injection in subprocess use.** Both subprocess call sites — `unzip`/`tar` extraction (`admin-server.ts:1249,1344`) and the `requestShell` action primitive (`actions/primitives.ts:400`) — use `execFile`/`spawn` with **array arguments**, never a shell string.
- **XSS is handled.** The only `dangerouslySetInnerHTML` (`web/src/Markdown.tsx:24`) is fed through `DOMPurify.sanitize` after `marked`.
- **Constant-time password compare with length guard** (`admin-server.ts:1784`) — avoids the common `timingSafeEqual` length-mismatch throw.
- **Same-origin by default.** No CORS headers are emitted, so browsers block cross-origin reads. Session cookie is `HttpOnly; SameSite=Lax`.
- **Body-size limits everywhere** (`readRawBody`, 1 MB default / 25 MB uploads) — basic DoS hygiene.
- **Store installs verify SHA-256** before extraction (`admin-server.ts:1329`) and enforce a 25 MB cap.
- **Permissioned action runtime is well-designed.** Read-only actions execute immediately; writes/shell block on an operator approval queue with diff previews, scope checks, output truncation, and full event logging.
- **Single-instance safety** via `runtime-lock.ts` (tested), and scheduler locks to prevent overlapping job runs.

---

## 3. Security findings

> **Status update (2026-05-29):** S1–S4 were addressed in a follow-up change after this audit.
> S1 — the `BFROST_ENABLE_LOCAL_WORKER_CODE` flag is now enforced in `activateLocalWorker`
> (with a regression test) and toggleable from the new **Settings → Platform & security** panel.
> S2/S3 — the admin password is now settable from that panel (written to `.env`), a default is
> set in the local `.env`, and the pre-existing login screen activates once a password is present
> (verified end-to-end). S4 — worker archive installs now pre-scan entries for traversal **and**
> symlinks before extraction, with a post-extract symlink walk (unit-tested). The remaining items
> in §8 (rate-limiting beyond localhost, ESLint/audit in CI, frontend smoke tests, splitting
> `admin-server.ts`) are unchanged. The findings below are preserved as the point-in-time audit.

### S1 — `BFROST_ENABLE_LOCAL_WORKER_CODE` is a control that does not exist *(Medium — config integrity)*

`config.localWorkerCodeEnabled` is defined (`config.ts:88`) and **read nowhere** in `src/`. The boot path `bootstrapLocalWorkers → activateLocalWorker → loadLocalWorkerModule` (`workers/bootstrap.ts`, `workers/loader.ts:80`) compiles and `require()`s local worker TypeScript **unconditionally**.

That local workers run unsandboxed is *expected and disclosed* (`SECURITY.md`; ROADMAP line 141 marks the sandbox as not-done — this is **not** presented here as a hidden vulnerability). The actual problem is narrower: **`.env.example:30` ships `BFROST_ENABLE_LOCAL_WORKER_CODE=false`, advertising an opt-in gate that has no effect.** An operator who sets it to `false` reasonably believes local code execution is disabled. It isn't.

**Fix (pick one):** either wire the flag into `loadLocalWorkerModule`/`activateLocalWorker` (skip-and-warn when false), or delete it from `.env.example` and config so it stops implying a gate. The first is the safer default.

### S2 — Default posture: unauthenticated API + no Host-header check *(Medium-High in aggregate, for the default config)*

Three facts compound:

1. `isAdminAuthEnabled()` returns `false` when `ADMIN_PASSWORD` is empty (`admin-server.ts:1763`), and `.env.example` ships it **empty**. Auth is only enforced when enabled (`:209`). → **By default the entire `/api/` surface is unauthenticated**, including the endpoints that upload, install, and enable workers (= execute code).
2. **No `Host`-header validation.** `handleRequest` trusts `req.headers.host` to build the URL (`:179`) with no allowlist. There is no CSRF token and no `Origin`/`Referer` check.
3. The `127.0.0.1` bind is the *only* control left.

Item 2 is the one that makes 1 dangerous beyond the local user: a localhost-only bind without Host-header validation is the textbook condition for a **DNS-rebinding** attack — a malicious web page the operator visits can rebind a hostname to `127.0.0.1` and reach the unauthenticated API from the victim's browser. I confirmed the header is unvalidated; I did **not** build a PoC, so treat this as "the precondition is present," not "exploited."

**Fix:** validate `Host` against an allowlist (`127.0.0.1`/`localhost` + configured host), and/or default to requiring a password. Either one closes the rebinding path.

### S3 — No brute-force throttling on `/api/auth/login` *(Low, given localhost default)*

No rate limit, attempt counter, or backoff on login (`admin-server.ts:189`). Low while bound to localhost; rises to Medium the moment an operator sets `ADMIN_HOST=0.0.0.0` (which the app permits with no warning). A small fixed delay + per-IP attempt cap is cheap insurance.

### S4 — Archive extraction trusts `unzip`/`tar` traversal handling *(Low)*

Worker zip/tarball extraction (`:1249`, `:1344`) shells out to system `unzip`/`tar`. The code validates that the *manifest directory* stays inside the extraction dir (`isPathInside`), but does not independently guard against a malicious archive writing files **outside** the temp dir during extraction (zip-slip / `../` entries). `unzip` largely refuses traversal; GNU/bsd `tar` behavior varies. SHA-256 verification (store path) and the "don't install untrusted workers" model mitigate this, but a defense-in-depth check (or a library extractor with explicit containment) would harden it.

---

## 4. Development best practice

**Strong:**
- `tsc` strict typecheck as the static gate; CI runs typecheck + tests + frontend build + manifest-enum sync across Node 20 and 22.
- Tests colocated and broad (queue, scheduler, locks, registry, loader, storage, actions, per-worker job logic). `node --test` native runner, no heavy framework.
- Clear module boundaries; deliberate documentation of the known CJS cycle workaround in `llm.ts`.
- Honest, detailed ROADMAP/LOWCODE_ROADMAP with `[ ]`/`[x]` self-tracking.

**Gaps / suggestions:**
- **No linter or formatter** (acknowledged in CLAUDE.md). `tsc` does not catch unused vars, floating promises, or `no-explicit-any`. A minimal `eslint` + `@typescript-eslint` pass (even advisory in CI) would catch a class of issues typecheck misses — and the action primitives already contain `eslint-disable` comments referencing a config that doesn't exist.
- **No coverage measurement.** Breadth looks good but there's no signal on which branches are exercised. `c8`/`node --test --experimental-test-coverage` would quantify it.
- **`admin-server.ts` is 72 KB / ~1850 lines.** It's the de-facto monolith — routing, auth, sessions, worker install, backups, dashboard aggregation all in one file. It's readable, but it's the highest-churn, highest-risk file and would benefit from splitting auth/session and the worker-install pipeline into their own modules (without touching the worker contract).
- **No dependency-audit step in CI.** `npm audit` is clean today (0 vulns), but it's not gated — add `npm audit --omit=dev` or Dependabot.

---

## 5. Functional fitness (for a local AI ops platform)

The five core abstractions (registry, Item Bus, per-worker storage, local-worker runtime, provider/channel/tool adapters) are the right ones for this product, and they're implemented coherently. The producer/consumer Item Bus with namespaced `metadata[consumerWorkerId]` is a clean cross-worker contract that avoids per-worker schema sprawl.

**Functional observations:**
- **Item Bus is single-terminal-state** — multi-consumer fan-out is explicitly deferred (ROADMAP line 123). Fine today; will need attention before any "multiple consumers complete the same item" use case.
- **Action approval is poll-based** (`waitForDecision`, 1 s interval, 5 min default timeout). Works, but a blocked worker holds a job slot for up to 5 minutes; under a busy scheduler that's a throughput consideration. An event/callback approval would scale better later.
- **Coarse permission scopes in practice.** `assertPermission` supports `file:read:*` / `shell:*` wildcards but path-scoped wildcards (e.g. `file:write:/safe/dir/*`) aren't supported — exact absolute-path match is impractical, so real manifests will tend toward `*`. Worth a path-prefix matcher before the permission model is called "done."

---

## 6. Completeness

The authors have already enumerated their own gaps; this confirms them rather than rediscovering them. Toward `v1.0.0` (`ROADMAP.md`), the open `[ ]` items are:
- **Permissioned action runtime** — primitives + approval exist; the full deny-by-default *sandbox* (line 141) is not done.
- **Frontend smoke tests** — none for schema-rendered job forms (the dashboard is the least-tested layer; web has 19 source files and effectively no UI test).
- **Per-worker metrics**, **accessibility pass**, and a **public docs site** — all open.
- Channel follow-ups (per-worker secrets/env) still pending (line 94).

Nothing here is a surprise or a contradiction of the docs. The project's self-assessment is accurate.

---

## 7. "Else" — operability & supply chain

- **Secrets at rest are plaintext** in `.env` and SQLite (disclosed in `SECURITY.md`). Acceptable for the threat model, but worth a one-line README reminder about filesystem permissions on `data/` and `.env`.
- **`ADMIN_HOST=0.0.0.0` is permitted silently.** Given S2/S3, the app should at minimum log a loud warning (or refuse to boot without a password) when bound to a non-loopback address.
- **`.env` is correctly gitignored** and not tracked — verified.
- **Local worker supply chain** rests entirely on operator trust + SHA-256 for store installs. Signature verification (not just hash) would be the natural next step if a community catalog grows.

---

## 8. Prioritized action list

| # | Action | Effort | Why |
|---|--------|--------|-----|
| 1 | Validate `Host` header (allowlist loopback + configured host) | S | Closes DNS-rebinding path against the default unauthenticated API (S2) |
| 2 | Either enforce `BFROST_ENABLE_LOCAL_WORKER_CODE` or remove it from `.env.example`/config | S | Eliminates a control that silently does nothing (S1) |
| 3 | Warn/refuse on non-loopback `ADMIN_HOST` without a password | S | Makes the unsafe deployment explicit (S2/S3) |
| 4 | Add login rate-limit / backoff | S | Brute-force hygiene (S3) |
| 5 | Add ESLint (advisory) + `npm audit` to CI | M | Catches the class of issues `tsc` can't |
| 6 | Harden archive extraction against traversal | M | Defense-in-depth on worker install (S4) |
| 7 | Add frontend smoke tests for schema-driven forms | M | The largest untested surface (completeness) |
| 8 | Split `admin-server.ts` (auth/session, install pipeline) | M | Reduce risk in the highest-churn file |

**Bottom line:** the engineering is solid and the architecture is a real asset. Spend the next increment on *default security posture* (items 1–4) rather than features — the gap between "safe on my laptop" and "safe if someone changes one env var or visits a bad web page" is the thing most worth closing before `v1.0.0`.
