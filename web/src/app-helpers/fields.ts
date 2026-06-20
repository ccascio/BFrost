import type {
  JobDashboardField,
  JobDraft,
  JobParamDraftValue,
  JobStringListField,
  SchedulerJobState,
  WorkerDashboardSurface,
} from '../app-types';

export function jobScheduleChanges(job: SchedulerJobState, draft: JobDraft): Array<{ field: string; from: string; to: string }> {
  const changes: Array<{ field: string; from: string; to: string }> = [];
  if (draft.enabled !== job.enabled) {
    changes.push({ field: 'Enabled', from: job.enabled ? 'Yes' : 'No', to: draft.enabled ? 'Yes' : 'No' });
  }
  if (draft.cron !== job.cron) {
    changes.push({ field: 'Schedule', from: job.cron, to: draft.cron });
  }
  if (draft.modelAlias !== job.modelAlias) {
    changes.push({
      field: 'Model',
      from: job.modelAlias || '(platform default)',
      to: draft.modelAlias || '(platform default)',
    });
  }
  if (draft.approvalRequired !== job.approvalRequired) {
    changes.push({
      field: 'Require approval',
      from: job.approvalRequired ? 'Yes' : 'No',
      to: draft.approvalRequired ? 'Yes' : 'No',
    });
  }
  return changes;
}

export function jobConfigSummary(job: SchedulerJobState): string {
  const parts = ['model'];
  if (job.dashboardFields.length > 0) {
    parts.push(`${job.dashboardFields.length} field${job.dashboardFields.length === 1 ? '' : 's'}`);
  }
  if (job.promptEditable) {
    parts.push('prompt');
  }
  return parts.join(' · ');
}

export function stringListDraftRows(value: JobParamDraftValue): string[] {
  const rows = String(value).split('\n');
  return rows.length > 0 ? rows : [''];
}

export function stringListDraftItems(value: JobParamDraftValue): string[] {
  return stringListDraftRows(value)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeStringListItem(value: string): string {
  return value.trim().toLowerCase();
}

export function stringListDraftIncludes(value: JobParamDraftValue, item: string): boolean {
  const normalized = normalizeStringListItem(item);
  return stringListDraftItems(value).some((current) => normalizeStringListItem(current) === normalized);
}

export function addStringListDraftValue(value: JobParamDraftValue, item: string): string {
  const trimmed = item.trim();
  if (!trimmed) return String(value);
  const items = stringListDraftItems(value);
  if (items.some((current) => normalizeStringListItem(current) === normalizeStringListItem(trimmed))) {
    return items.join('\n');
  }
  return [...items, trimmed].join('\n');
}

export function toggleStringListDraftValue(value: JobParamDraftValue, item: string): string {
  const normalized = normalizeStringListItem(item);
  const items = stringListDraftItems(value);
  if (items.some((current) => normalizeStringListItem(current) === normalized)) {
    return items.filter((current) => normalizeStringListItem(current) !== normalized).join('\n');
  }
  return addStringListDraftValue(value, item);
}

export function fieldListPlaceholder(field: JobStringListField): string {
  if (field.placeholder) return field.placeholder;
  const key = field.key.toLowerCase();
  if (key.includes('host')) return 'example.com';
  if (key.includes('quer')) return 'Add an interest';
  return 'Add an item';
}

export function buildJobParamsDraft(job: SchedulerJobState): Record<string, JobParamDraftValue> {
  const params = job.params ?? {};
  return Object.fromEntries(
    job.dashboardFields.map((field) => {
      const value = params[field.key];
      if (field.type === 'number') {
        return [field.key, typeof value === 'number' ? value : field.defaultValue];
      }
      if (field.type === 'boolean') {
        return [field.key, typeof value === 'boolean' ? value : field.defaultValue];
      }
      if (field.type === 'string-list') {
        return [
          field.key,
          Array.isArray(value)
            ? value.filter((item) => typeof item === 'string').join('\n')
            : field.defaultValue.join('\n'),
        ];
      }
      if (field.type === 'select' || field.type === 'secret-reference') {
        return [field.key, typeof value === 'string' ? value : field.defaultValue];
      }
      if (field.type === 'action') {
        return [field.key, ''];
      }
      return [field.key, typeof value === 'string' ? value : field.defaultValue];
    }),
  );
}

export function buildSurfaceDraft(
  surface: WorkerDashboardSurface,
  workerData?: Record<string, unknown>,
): Record<string, JobParamDraftValue> {
  return Object.fromEntries(
    (surface.fields ?? []).map((field) => [field.key, fieldDefaultDraftValue(field, workerData)]),
  );
}

export function fieldDefaultDraftValue(
  field: JobDashboardField,
  workerData?: Record<string, unknown>,
): JobParamDraftValue {
  if (field.seedPath && workerData) {
    const seeded = resolveSeedPath(workerData, field.seedPath);
    if (seeded !== undefined) {
      if (field.type === 'string-list' && Array.isArray(seeded)) {
        return seeded.filter((v) => typeof v === 'string').join('\n');
      }
      if (field.type === 'number' && typeof seeded === 'number') return seeded;
      if (field.type === 'boolean' && typeof seeded === 'boolean') return seeded;
      if ((field.type === 'text' || field.type === 'textarea' || field.type === 'select' || field.type === 'secret-reference') && typeof seeded === 'string') {
        return seeded;
      }
    }
  }
  if (field.type === 'action') return '';
  if (field.type === 'string-list') return field.defaultValue.join('\n');
  return field.defaultValue;
}

export function resolveSeedPath(root: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = root;
  let segments = path.split('.');
  while (segments.length > 0) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    const current = cursor as Record<string, unknown>;
    let matched = false;
    for (let length = segments.length; length >= 1; length -= 1) {
      const key = segments.slice(0, length).join('.');
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        cursor = current[key];
        segments = segments.slice(length);
        matched = true;
        break;
      }
    }
    if (!matched) return undefined;
  }
  return cursor;
}

export function serializeDashboardFields(
  fields: JobDashboardField[],
  draft: Record<string, JobParamDraftValue>,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((field) => field.type !== 'action').map((field) => {
      const value = draft[field.key] ?? fieldDefaultDraftValue(field);
      if (field.type === 'string-list') {
        return [field.key, String(value).split('\n').map((item) => item.trim()).filter(Boolean)];
      }
      if (field.type === 'number') {
        return [field.key, typeof value === 'number' ? value : Number(value)];
      }
      if (field.type === 'boolean') {
        return [field.key, Boolean(value)];
      }
      return [field.key, String(value)];
    }),
  );
}

export function serializeJobParams(job: SchedulerJobState, draft: JobDraft): Record<string, unknown> {
  return serializeDashboardFields(job.dashboardFields, draft.params);
}

export function surfaceDraftHasValue(fields: JobDashboardField[], draft: Record<string, JobParamDraftValue>): boolean {
  return fields.some((field) => {
    if (field.type === 'action') return false;
    const value = draft[field.key] ?? fieldDefaultDraftValue(field);
    if (field.type === 'boolean') return true;
    if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (field.type === 'string-list') {
      return String(value).split('\n').some((item) => item.trim().length > 0);
    }
    return String(value).trim().length > 0;
  });
}
