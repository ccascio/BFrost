// Placeholder for the future installable frontend worker contract.
//
// Built-in worker dashboards currently live under:
//   web/src/workers/builtin/<worker>/dashboard.tsx
//
// A future zip-installed worker UI contract should provide a compiled and
// sandboxed dashboard bundle or a schema-driven view description. Raw TSX from
// local uploads is not loaded by BFrost today.
//
// A News-like dashboard would show:
// - recent digest runs
// - fetched/qualified/queued/rejected counts
// - queued news items and decision history
// - links back to Config for Google credentials and query settings
export const dashboardView = null;
