import { promises as fs } from 'fs';
import path from 'path';
import { loadKvJson, saveKvJson } from '../../../sqlite';
import { getNewsStoreDir } from './settings';

const NEWS_RUNS_STORE_KEY = 'news.runs';
const RUN_RETENTION = 56;

export interface NewsRunRecord {
  file: string;
  ranAt: string;
  fetchedCount: number;
  candidateCount?: number;
  articleFetchSuccessCount: number;
  articleFetchFailureCount: number;
  sourceQualifiedCount: number;
  allowlistedCount: number;
  blockedSourceCount: number;
  lowScoreRejectedCount: number;
  queuedCount: number;
  rejectedCount: number;
  seenCount: number;
  duplicateUrlCount?: number;
  duplicateTitleCount?: number;
  nearDuplicateCount: number;
  droppedHallucinated?: number;
  undecidedCount?: number;
}

export function newsRunFileForRanAt(ranAt: string): string {
  return `${ranAt.replace(/[:.]/g, '-')}.json`;
}

export async function saveNewsRun(run: Omit<NewsRunRecord, 'file'>): Promise<NewsRunRecord> {
  const runs = await loadNewsRuns();
  const file = newsRunFileForRanAt(run.ranAt);
  const record = { ...run, file };
  const next = [record, ...runs.filter((item) => item.file !== file)]
    .sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt))
    .slice(0, RUN_RETENTION);
  await saveKvJson(NEWS_RUNS_STORE_KEY, next);
  return record;
}

export async function listNewsRuns(limit = 5): Promise<NewsRunRecord[]> {
  return (await loadNewsRuns()).slice(0, limit);
}

async function loadNewsRuns(): Promise<NewsRunRecord[]> {
  const stored = await loadKvJson<unknown>(NEWS_RUNS_STORE_KEY);
  if (Array.isArray(stored)) {
    return stored.map(normalizeRun).sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt));
  }

  const imported = await importLegacyRunFiles();
  if (imported.length > 0) {
    await saveKvJson(NEWS_RUNS_STORE_KEY, imported);
  }
  return imported;
}

async function importLegacyRunFiles(): Promise<NewsRunRecord[]> {
  const runsDir = path.join(getNewsStoreDir(), 'runs');
  try {
    const entries = (await fs.readdir(runsDir))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, RUN_RETENTION);

    const results: NewsRunRecord[] = [];
    for (const file of entries) {
      const raw = await fs.readFile(path.join(runsDir, file), 'utf8');
      results.push(normalizeRun({ ...JSON.parse(raw), file }));
    }
    return results.sort((a, b) => Date.parse(b.ranAt) - Date.parse(a.ranAt));
  } catch {
    return [];
  }
}

function normalizeRun(input: unknown): NewsRunRecord {
  const item = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const file = stringValue(item.file) || `${stringValue(item.ranAt) || 'unknown'}.json`;
  return {
    file,
    ranAt: stringValue(item.ranAt) || file,
    fetchedCount: numberValue(item.fetchedCount),
    candidateCount: numberValue(item.candidateCount),
    articleFetchSuccessCount: numberValue(item.articleFetchSuccessCount),
    articleFetchFailureCount: numberValue(item.articleFetchFailureCount),
    sourceQualifiedCount: numberValue(item.sourceQualifiedCount),
    allowlistedCount: numberValue(item.allowlistedCount),
    blockedSourceCount: numberValue(item.blockedSourceCount),
    lowScoreRejectedCount: numberValue(item.lowScoreRejectedCount),
    queuedCount: numberValue(item.queuedCount ?? item.addedCount),
    rejectedCount: numberValue(item.rejectedCount),
    seenCount: numberValue(item.seenCount),
    duplicateUrlCount: numberValue(item.duplicateUrlCount),
    duplicateTitleCount: numberValue(item.duplicateTitleCount),
    nearDuplicateCount: numberValue(item.nearDuplicateCount),
    droppedHallucinated: numberValue(item.droppedHallucinated),
    undecidedCount: numberValue(item.undecidedCount),
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
