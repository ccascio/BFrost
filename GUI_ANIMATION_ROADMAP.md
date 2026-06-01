# BFrost GUI Motion Roadmap

## Objective

Use the strongest ideas from Animate UI to make BFrost's dashboard and public website feel clearer, faster, and more trustworthy without weakening the worker-first contract.

Animate UI is useful here as a pattern library: animated primitives, operational shell components, copy/code helpers, progress states, notification stacks, and public-site sharing affordances. It should not become BFrost's visual identity wholesale, and the dashboard should stay calm, dense, and operational.

## Fit Assessment

### Highest-fit components

- **Sidebar**: aligns with BFrost's worker and system navigation. The current custom sidebar in `web/src/Sidebar.tsx` already has grouping, counts, collapse, active state, and keyboard focus movement; the opportunity is smoother disclosure and better mobile behavior, not replacement.
- **Dialog / Alert Dialog / Sheet**: fits permission consent, destructive actions, store install approval, schedule-review confirmation, worker detail panels, and API-key forms.
- **Progress**: fits worker installation, sideload uploads, runtime/model load/unload, store fetches, long-running jobs, backups, and restore.
- **Notification List**: fits dashboard events, worker health changes, action approval results, store update notices, and job completion. Current `TopBar` has one error toast; BFrost needs a small stacked notification center.
- **Management Bar**: fits queue bulk review, action approvals, worker catalog batch operations, and store pagination/filter controls.
- **Copy Button / Code Tabs**: fits diagnostics, install commands, worker snippets, docs, logs, config examples, and generated API/SDK examples.
- **Preview Link Card**: fits worker store cards, docs cross-links, README-backed worker detail, and external URLs.
- **Share Button**: fits the public website, store listings, docs pages, release notes, and demo pages more than the local dashboard.

### Lower-fit or avoid in the dashboard

- **Decorative backgrounds**: avoid in the app. The dashboard needs legibility and repeated-use ergonomics, not animated scenery.
- **Radial Menu / Radial Nav**: interesting for demos, but not a first choice for BFrost operations. Context menus should remain predictable and keyboard-friendly.
- **Flip Card / Motion Carousel / Radial Intro**: keep for website marketing or guided docs, not the core app.
- **Liquid / Ripple / Flip buttons**: use sparingly. BFrost buttons should communicate state and risk more than visual flourish.

## Non-Negotiables

1. **Worker-first boundary stays intact.** Generic UI primitives may live in `web/src/`, but worker-specific rendering remains in `web/src/workers/` or worker dashboard bundles. No core App code should learn worker ids to support these improvements.
2. **Reduced motion is required.** Add a root motion policy and CSS fallbacks for `prefers-reduced-motion`. Large transforms, looping motion, and parallax must disable automatically.
3. **No Tailwind migration as a prerequisite.** The app currently uses plain CSS in `web/src/styles.css` and no `motion`, Radix, Base UI, Tailwind, or lucide dependency. Start with local React/CSS primitives; add dependencies only where they simplify accessible behavior.
4. **Operational density wins.** Cards, animations, and transitions should help scanning, selection, feedback, or recovery. Avoid marketing composition inside the app.
5. **Website can be more expressive than the app.** The public site can use screenshot-led sections, code tabs, share affordances, and richer page transitions as long as performance and accessibility hold.

## Application Roadmap

### Phase A0 - UI Foundation

**Goal:** create the shared app interaction layer that future UI work can use consistently.

**Status:** Done. Implemented as dependency-free React/CSS primitives in `web/src/ui/`, exposed through `web/src/ui/index.ts`, styled by shared motion tokens in `web/src/styles.css`, and previewable with the internal `?ui-demo=1` route.

- Add `web/src/ui/` with small primitives:
  - `Button`, `IconButton`, `CopyButton`
  - `Tooltip`
  - `Progress`
  - `Dialog` / `AlertDialog`
  - `Sheet`
  - `NotificationStack`
  - `ManagementBar`
  - `CodeTabs`
- Add motion tokens to `styles.css`: durations, easing, reduced-motion overrides, focus and disabled-state rules.
- Keep primitive APIs generic and worker-agnostic.
- Evaluate whether CSS-only transitions are enough. If not, add `motion` as the only first motion dependency and wrap the root with a reduced-motion policy.

**Files likely touched:** `web/src/main.tsx`, `web/src/styles.css`, new `web/src/ui/*`.

**Exit criteria:** primitives render in a small internal demo/test surface, respect keyboard navigation, and do not introduce worker-specific imports.

### Phase A1 - Shell And Feedback

**Goal:** make navigation and global feedback smoother without redesigning the app.

**Status:** Done for the local dashboard shell and mirrored in the website shell. The dashboard now uses collapsed-entry tooltips, animated child disclosure, mobile drawer state, notification-stack errors with copyable diagnostics, and inline progress for model operations. The website now has animated mobile navigation, a global notification stack, share feedback, and Playwright coverage for the shell behavior.

- Refine `web/src/Sidebar.tsx`:
  - animate parent/child disclosure with reduced-motion support
  - preserve current grouped entries and counts
  - improve collapsed hover/focus labels with `Tooltip`
  - add mobile sheet behavior for narrow screens
- Replace the single `TopBar` error toast with `NotificationStack`:
  - errors, success messages, worker health notices, store update notices
  - copy diagnostic action remains available
  - recent notices optionally fold into a notification list
- Convert topbar model load/unload/save feedback to inline progress states instead of label-only busy text.

**Files likely touched:** `web/src/Sidebar.tsx`, `web/src/TopBar.tsx`, `web/src/App.tsx`, `web/src/styles.css`.

**Exit criteria:** current dashboard screenshots look familiar, but navigation and busy/error feedback feel more stable and less jumpy.

### Phase A2 - Operations Controls

**Goal:** apply the Management Bar, Progress, Dialog, and Copy Button patterns to the screens users operate repeatedly.

**Status:** Done for the local dashboard surfaces and applied to the website where the same operational patterns exist. The dashboard now uses management/action controls, a diff-review sheet, schedule-save alert dialog, job running progress, stable preset chips, dialog-based worker install consent, store preview links, install progress, and a copyable admin URL. The website store now uses a management bar for catalog controls, and worker detail pages expose install-review progress, release/source preview cards, and a copyable curl command.

- Queue and Actions:
  - add `ManagementBar` for selection, filtering, approve/reject, pagination, and bulk action affordances
  - move action diff preview into a `Sheet` or `Dialog` with clear approve/reject footer
  - preserve the existing permissioned action runtime and audit history
- Jobs:
  - replace inline schedule confirmation with `AlertDialog` for risky changes and a compact inline review for low-risk changes
  - add `Progress` for running jobs when a run has active state
  - improve recipe preset chips so selected/applied recipes are visually stable
- Store:
  - use `PreviewLinkCard` behavior for worker cards and external website links
  - move install permission consent to `Dialog`
  - use `Progress` for install/download/verify/extract stages when backend exposes stage data
- Config/System:
  - use `CopyButton` for local URLs, diagnostic bundles, tokens-safe examples, sudoers snippets, and setup commands
  - use `CodeTabs` for command variants when platform-specific instructions appear

**Files likely touched:** `web/src/App.tsx`, `web/src/TopBar.tsx`, `web/src/styles.css`, worker dashboards under `web/src/workers/builtin/*/dashboard.tsx` where the worker owns the surface.

**Exit criteria:** queue/action/store/job workflows have consistent toolbars, progress, and confirmation semantics.

### Phase A3 - Worker Dashboard Contract

**Goal:** let worker-provided UI use the same interaction language without making core import specific workers.

**Status:** Done. Exposed a tiny `window.bfrost.ui` contract with stable class names and helpers, passed it into worker dashboard render context, documented the host CSS contract, updated the local dashboard example and bundle test, and converted the Telegram channel dashboard as the first worker-owned surface while leaving `web/src/workers/registry.ts` behavior untouched.

- Document a host CSS class contract for local worker dashboard bundles: buttons, status pills, panels, form fields, progress, and empty states.
- Optionally expose a tiny `window.bfrost.ui` helper surface for stable primitives that worker dashboards can call without bundling a second design system.
- Keep the runtime bundle behavior in `web/src/workers/registry.ts` intact: workers register their own views and queue detail renderers.
- Convert built-in worker dashboards opportunistically, one worker at a time.

**Files likely touched:** `web/src/main.tsx`, `web/src/workers/types.ts`, `web/src/workers/registry.ts`, `docs/worker-authoring.md`, `workers/README.md`.

**Exit criteria:** a local worker can ship a dashboard that visually matches BFrost without copying large CSS or importing app internals.

### Phase A4 - Verification

**Goal:** make the polish measurable.

- Add frontend smoke tests for:
  - schema-rendered job forms
  - sidebar navigation and collapse
  - dialog focus trap and Escape behavior
  - notification stack announcement and dismissal
  - reduced-motion mode
- Add visual checks for desktop and mobile breakpoints.
- Add an accessibility pass after each phase, especially for dialogs, sheets, progress, and notification live regions.

**Files likely touched:** test setup TBD. This also satisfies the open `ROADMAP.md` Workstream 6 frontend smoke-test gate.

## Website Roadmap

The application repo does not currently contain the public website source. `README.md` references `bfrost.net`, the store API, and a future/ongoing docs site, so this track should be applied in the website repo or when the docs site source is added here.

The website should split into two related but separate experiences:

- **Homepage / marketing site**: explains BFrost quickly, proves the worker-first idea, shows real screenshots, and sends visitors to install, docs, GitHub, or the worker store.
- **Docs site**: helps users and worker authors complete tasks. It should be calmer, denser, searchable, and built around copyable examples.

This split is important because Animate UI's more expressive motion belongs mostly on the homepage and store pages, while docs need restrained interaction: code tabs, copy buttons, link previews, and progress through tutorials.

### Phase W0 - Website UI Inventory

**Goal:** map the public site into homepage, docs, and store surfaces before implementing visual polish.

- Inventory pages by product surface:
  - Homepage: hero, proof screenshots, worker lifecycle, local-first trust, comparison, install CTA.
  - Docs: getting started, installation, dashboard guide, worker authoring, Item Bus, SDK/API, troubleshooting.
  - Store: listing, detail, publish, trust/permissions, release notes.
- Decide whether the website uses Tailwind/shadcn already. If yes, Animate UI can be adopted more directly. If not, reuse the app's smaller CSS primitive approach.
- Align public-site tokens with the app: colors, radius, type scale, focus rings, reduced motion.

**Exit criteria:** a short component map exists for every public page type.

### Phase W1 - Homepage Product Story

**Goal:** make the homepage explain BFrost's worker-first promise in one pass, using real product visuals rather than decorative effects.

- Build a first viewport with:
  - BFrost name as the headline signal
  - one-sentence worker-first promise
  - primary CTAs for Install/Get Started and GitHub
  - a real dashboard screenshot or generated product-composite image, not an abstract SVG/gradient hero
- Add a restrained lifecycle section:
  - install worker
  - configure credentials/settings
  - run or schedule
  - observe queue/events/actions
  - disable/remove without core changes
- Add screenshot-led sections using `assets/screenshots/`:
  - dashboard overview
  - worker store
  - dashboard chat
  - installed workers
- Add a local-first trust section:
  - data stays local
  - workers are explicit capabilities
  - permissioned actions and audit log
  - no remote worker loading by default
- Use motion only to clarify sequence: subtle reveal, active lifecycle step, notification/event timeline. No looping decorative backgrounds.

**Exit criteria:** a newcomer can understand what BFrost is, why workers matter, and where to go next without opening the docs.

### Phase W2 - Docs And Developer Trust

**Goal:** make the docs easier to scan, copy from, and share.

- Add `CodeTabs` to install/setup/worker-authoring examples:
  - npm install/build/start
  - worker layouts
  - TypeScript vs compiled JS worker examples
  - macOS/Windows/Linux commands where needed
- Add `CopyButton` to every command, config example, worker id, and API endpoint.
- Add `PreviewLinkCard` for cross-links between architecture, worker authoring, Item Bus, SDK, and examples.
- Add subtle progress/step indicators to tutorials.

**Exit criteria:** a new contributor can copy commands and switch examples without scrolling through repeated blocks.

### Phase W3 - Worker Store Pages

**Goal:** make public worker listings feel installable, inspectable, and safe.

- Add `ShareButton` to worker detail pages and release notes.
- Add `PreviewLinkCard` for related workers, dependencies, author pages, GitHub links, and README links.
- Add permission and trust sections that visually match the in-app Store tab.
- Add install CTA states:
  - copy install command
  - open `bfrost://install` when deep links exist
  - fallback to app Store tab instructions
- Add lightweight animated filters/sorting inspired by Management Bar, but keep result cards stable.

**Exit criteria:** a website visitor understands what a worker does, what it can access, and how to install it.

### Phase W4 - Docs/Homepage Bridge

**Goal:** keep the homepage and docs connected without making either one do the other's job.

- Homepage links to task-specific docs at decision points:
  - "Install BFrost"
  - "Connect a channel"
  - "Create a worker"
  - "Understand the Item Bus"
- Docs pages link back to product context only where useful:
  - architecture overview
  - worker store
  - comparison/use cases
- Add `PreviewLinkCard` for these cross-links so users understand where a link goes before leaving the page.
- Use consistent page chrome but different density:
  - homepage: visual, narrative, CTA-led
  - docs: searchable, left-nav, copyable examples, minimal animation

**Exit criteria:** users can move from pitch to task and back without getting lost.

### Phase W5 - Performance And Accessibility

**Goal:** keep the public site fast and comfortable.

- Respect `prefers-reduced-motion` everywhere.
- Avoid auto-playing looping backgrounds.
- Ensure code tabs, share menus, preview cards, and carousels are keyboard accessible.
- Run Lighthouse/Core Web Vitals checks before launch.

**Exit criteria:** expressive pages remain fast, readable, and accessible.

## Dependency Strategy

### Dashboard

Start with no new dependency. The existing stack is React 19, Vite, TypeScript, and plain CSS. Build the minimum primitives locally first.

Consider adding dependencies only when they remove meaningful accessibility or animation complexity:

- `motion`: only if CSS transitions are insufficient for stacked notifications, layout animations, or presence transitions.
- Radix/Base UI primitives: only for Dialog/Popover/Tooltip if local accessibility work becomes too expensive.
- Avoid a Tailwind migration for the dashboard unless there is a separate design-system reason.
- Avoid broad shadcn/Animate UI import churn in `App.tsx`; this file is already large and should be simplified, not made more coupled.

### Website

If the website already uses Tailwind/shadcn, Animate UI components can be adopted directly. If it does not, port the patterns rather than the implementation.

## Suggested Sequencing

1. **A0 UI Foundation**: reduced-motion policy, primitives, CSS tokens.
2. **A1 Shell And Feedback**: sidebar polish plus notification stack.
3. **A2 Operations Controls**: Actions, Queue, Store, Jobs.
4. **A4 smoke tests** for the pieces already touched.
5. **W1 Homepage Product Story**: screenshot-led homepage, worker lifecycle, install/GitHub CTAs.
6. **W2 Docs And Developer Trust**: CodeTabs, CopyButton, PreviewLinkCard.
7. **A3 Worker Dashboard Contract**: once primitives are stable enough for workers to consume.
8. **W3/W4 Store pages and docs/homepage bridge**.
9. **W5 Performance and accessibility** before a public push.

## First Implementation Slice

The best first slice is intentionally small:

- Add reduced-motion CSS tokens.
- Add `CopyButton`, `Progress`, and `NotificationStack`.
- Replace the `TopBar` single error toast with the stack.
- Use `CopyButton` for diagnostics and one existing config/setup snippet.
- Add a minimal frontend smoke test around notification dismissal and reduced-motion behavior.

This creates immediate polish, exercises the pattern, and does not require touching worker-specific code or adding a large dependency.
