// Placeholder for the future trusted local backend worker contract.
//
// A real News-like module would export a validated worker contribution:
// - manifest/job definitions
// - job runner process that searches, filters, deduplicates, and queues news
// - optional admin API routes
// - optional dashboard data providers
// - schema for search queries, date restriction, and result limits
//
// BFrost validates that this path is local to the worker directory, but it does
// not load or execute this file in the manifest-only worker contract.
export const workerModule = null;
