import { HttpRouter } from '../router';
import { readJsonBody, sendJson } from '../responses';
import { recordEventSafe } from '../../event-log';
import { BadRequestError } from '../../admin-route';
import { buildDashboardState } from '../../admin-dashboard-state';
import { updateDashboardQueueItem } from '../../jobs/queue-service';
import {
  createAppBackup,
  getAutoBackupSettings,
  restartAutoBackup,
  saveAutoBackupSettings,
  scheduleRestoreOnNextBoot,
  cancelPendingRestore,
} from '../../app-backup';
import { AutoBackupSettingsSchema, QueueItemActionBodySchema } from '../../admin-api';

export function registerBackupRoutes(router: HttpRouter): void {
  router.add('POST', '/api/queue-item', async (req, res) => {
    const body = await readJsonBody(req, QueueItemActionBodySchema);
    await updateDashboardQueueItem(body.id, body.action);
    return sendJson(res, 200, await buildDashboardState());
  });

  router.add('POST', '/api/backups', async (_req, res) => {
    const backup = await createAppBackup();
    await recordEventSafe({
      category: 'admin',
      action: 'backup_created',
      summary: `SQLite backup created: ${backup.file}`,
      metadata: { file: backup.file, path: backup.path, sizeBytes: backup.sizeBytes },
    });
    return sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/backups/settings', async (_req, res) => {
    const settings = await getAutoBackupSettings();
    return sendJson(res, 200, settings);
  });

  router.add('PATCH', '/api/backups/settings', async (req, res) => {
    const body = await readJsonBody(req, AutoBackupSettingsSchema.partial());
    const updated = await saveAutoBackupSettings(body);
    await restartAutoBackup();
    await recordEventSafe({
      category: 'admin',
      action: 'auto_backup_settings_updated',
      summary: `Auto-backup ${updated.enabled ? 'enabled' : 'disabled'} (retention: ${updated.retentionDays} days).`,
      metadata: updated as unknown as Record<string, unknown>,
    });
    return sendJson(res, 200, updated);
  });

  router.add('POST', '/api/backups/:file/restore', async (_req, res, { params }) => {
    const file = params.file;
    if (!file.endsWith('.sqlite') || file.includes('/') || file.includes('..')) {
      throw new BadRequestError('Invalid backup filename.');
    }
    await scheduleRestoreOnNextBoot(file);
    await recordEventSafe({
      category: 'admin',
      action: 'backup_restore_scheduled',
      summary: `Restore from ${file} scheduled for next startup.`,
      metadata: { file },
    });
    return sendJson(res, 200, { ok: true, message: 'Restart BFrost to apply this backup.' });
  });

  router.add('POST', '/api/backups/restore-cancel', async (_req, res) => {
    await cancelPendingRestore();
    return sendJson(res, 200, { ok: true });
  });
}
