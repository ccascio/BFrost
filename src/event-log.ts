import { randomUUID } from 'crypto';
import { ensureAppDb, runSql, runSqlJson, sqlString } from './sqlite';

export type EventSeverity = 'info' | 'warning' | 'error';

export interface EventLogInput {
  category: string;
  action: string;
  severity?: EventSeverity;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface EventLogRecord {
  id: string;
  createdAt: string;
  category: string;
  action: string;
  severity: EventSeverity;
  summary: string;
  metadata: Record<string, unknown>;
}

export type EventLogSubscriber = (event: EventLogRecord) => void;

const subscribers = new Set<EventLogSubscriber>();

export async function recordEvent(input: EventLogInput): Promise<void> {
  await ensureAppDb();
  const nowIso = new Date().toISOString();
  const id = randomUUID();
  const severity = input.severity ?? 'info';
  const metadataObject = input.metadata ?? {};
  const metadata = JSON.stringify(metadataObject);
  await runSql(
    `INSERT INTO event_log (id, created_at, category, action, severity, summary, metadata_json)
     VALUES (${sqlString(id)}, ${sqlString(nowIso)}, ${sqlString(input.category)}, ${sqlString(input.action)}, ${sqlString(severity)}, ${sqlString(input.summary)}, ${sqlString(metadata)});`,
  );
  notifyEventSubscribers({
    id,
    createdAt: nowIso,
    category: input.category,
    action: input.action,
    severity,
    summary: input.summary,
    metadata: parseMetadata(metadata),
  });
}

export async function recordEventSafe(input: EventLogInput): Promise<void> {
  try {
    await recordEvent(input);
  } catch (err) {
    console.warn('[EventLog] Failed to record event:', err);
  }
}

export async function listRecentEvents(limit = 50): Promise<EventLogRecord[]> {
  await ensureAppDb();
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  const raw = await runSqlJson(
    `SELECT id, created_at AS createdAt, category, action, severity, summary, metadata_json AS metadataJson
     FROM event_log
     ORDER BY created_at DESC
     LIMIT ${safeLimit};`,
  );
  return raw.map((row) => ({
    id: stringValue(row.id),
    createdAt: stringValue(row.createdAt),
    category: stringValue(row.category),
    action: stringValue(row.action),
    severity: eventSeverity(row.severity),
    summary: stringValue(row.summary),
    metadata: parseMetadata(row.metadataJson),
  }));
}

export async function listRecentEventsSafe(limit = 50): Promise<EventLogRecord[]> {
  try {
    return await listRecentEvents(limit);
  } catch (err) {
    console.warn('[EventLog] Failed to list events:', err);
    return [];
  }
}

export function subscribeToEventLog(subscriber: EventLogSubscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

function notifyEventSubscribers(event: EventLogRecord): void {
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch (err) {
      console.warn('[EventLog] Subscriber failed:', err);
    }
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function eventSeverity(value: unknown): EventSeverity {
  return value === 'warning' || value === 'error' ? value : 'info';
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
