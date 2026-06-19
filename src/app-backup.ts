import { promises as fs } from 'fs';
import path from 'path';
import cron, { type ScheduledTask } from 'node-cron';
import Database from 'better-sqlite3';
import { config } from './config';
import { createBackup, ensureAppDb } from './sqlite';
import { loadKvJson, saveKvJson } from './sqlite';
import { recordEventSafe } from './event-log';

const BACKUP_RETENTION = 50;
const AUTO_BACKUP_SETTINGS_KEY = 'admin.autoBackup';
const RESTORE_PENDING_FILE = 'restore-pending.json';

export interface AppBackupRecord {
  file: string;
  path: string;
  createdAt: string;
  sizeBytes: number;
  /** True when this backup has been selected for restore on the next startup. */
  restorePending?: boolean;
}

export interface AutoBackupSettings {
  enabled: boolean;
  /** Days to keep backups. Default 7. */
  retentionDays: number;
}

const DEFAULT_AUTO_BACKUP_SETTINGS: AutoBackupSettings = {
  enabled: false,
  retentionDays: 7,
};

export function appBackupDir(): string {
  return path.join(config.adminStoreDir, 'backups');
}

function restorePendingPath(): string {
  return path.join(config.adminStoreDir, RESTORE_PENDING_FILE);
}

export async function createAppBackup(nowIso = new Date().toISOString()): Promise<AppBackupRecord> {
  await ensureAppDb();
  const dir = appBackupDir();
  await fs.mkdir(dir, { recursive: true });

  const file = `bfrost-${nowIso.replace(/[:.]/g, '-')}.sqlite`;
  const backupPath = path.join(dir, file);

  await createBackup(backupPath);

  const stat = await fs.stat(backupPath);
  return {
    file,
    path: backupPath,
    createdAt: nowIso,
    sizeBytes: stat.size,
  };
}

export async function listAppBackups(limit = 20): Promise<AppBackupRecord[]> {
  const dir = appBackupDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const pendingFile = await getPendingRestoreFile();

  const backups = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.sqlite'))
      .map(async (file) => {
        const backupPath = path.join(dir, file);
        const stat = await fs.stat(backupPath);
        return {
          file,
          path: backupPath,
          createdAt: stat.mtime.toISOString(),
          sizeBytes: stat.size,
          restorePending: pendingFile === file ? true : undefined,
        } satisfies AppBackupRecord;
      }),
  );

  return backups
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.min(Math.max(Math.floor(limit), 1), BACKUP_RETENTION));
}

/** Prune backups older than `retentionDays` days, keeping a minimum of 2. */
export async function pruneOldBackups(retentionDays: number): Promise<number> {
  const dir = appBackupDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return 0;
  }

  const backups = (
    await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.sqlite'))
        .map(async (file) => {
          const p = path.join(dir, file);
          const stat = await fs.stat(p).catch((err) => {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
              console.warn(`[Backup] Failed to stat backup ${file}:`, err);
            }
            return null;
          });
          return stat ? { file, path: p, mtime: stat.mtime } : null;
        }),
    )
  )
    .filter(Boolean)
    .sort((a, b) => b!.mtime.getTime() - a!.mtime.getTime()) as Array<{
    file: string;
    path: string;
    mtime: Date;
  }>;

  const cutoff = Date.now() - retentionDays * 86_400_000;
  let pruned = 0;

  // Keep at least 2 backups regardless of retention.
  for (let i = 2; i < backups.length; i++) {
    if (backups[i].mtime.getTime() < cutoff) {
      await fs.rm(backups[i].path, { force: true })
        .then(() => {
          pruned++;
        })
        .catch((err) => {
          console.warn(`[Backup] Failed to prune backup ${backups[i].file}:`, err);
        });
    }
  }

  return pruned;
}

// ── Auto-backup settings ─────────────────────────────────────────────────────

export async function getAutoBackupSettings(): Promise<AutoBackupSettings> {
  const stored = await loadKvJson<AutoBackupSettings>(AUTO_BACKUP_SETTINGS_KEY);
  return { ...DEFAULT_AUTO_BACKUP_SETTINGS, ...stored };
}

export async function saveAutoBackupSettings(settings: Partial<AutoBackupSettings>): Promise<AutoBackupSettings> {
  const current = await getAutoBackupSettings();
  const next: AutoBackupSettings = { ...current, ...settings };
  await saveKvJson(AUTO_BACKUP_SETTINGS_KEY, next);
  return next;
}

// ── Restore-on-next-boot marker ──────────────────────────────────────────────

export async function scheduleRestoreOnNextBoot(backupFile: string): Promise<void> {
  const dir = config.adminStoreDir;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    restorePendingPath(),
    JSON.stringify({ file: backupFile, requestedAt: new Date().toISOString() }),
  );
}

export async function cancelPendingRestore(): Promise<void> {
  await fs.rm(restorePendingPath(), { force: true });
}

async function getPendingRestoreFile(): Promise<string | null> {
  try {
    const raw = await fs.readFile(restorePendingPath(), 'utf8');
    const parsed = JSON.parse(raw) as { file?: string };
    return typeof parsed.file === 'string' ? parsed.file : null;
  } catch {
    return null;
  }
}

/**
 * Called at startup (before `ensureAppDb()`). If a restore-pending marker
 * exists, copies the backup file over the main DB path so the next `getDb()`
 * call opens the restored snapshot.
 */
export async function applyPendingRestoreIfAny(): Promise<void> {
  const pendingFile = await getPendingRestoreFile();
  if (!pendingFile) return;

  const backupPath = path.join(appBackupDir(), pendingFile);
  try {
    const stat = await fs.stat(backupPath);
    if (!stat.isFile()) throw new Error('Not a file');
  } catch {
    console.warn(`[Backup] Restore-pending marker points to missing backup: ${pendingFile}. Skipping.`);
    await cancelPendingRestore();
    return;
  }

  // Guard: verify SQLite integrity before touching the live DB.
  try {
    const db = new Database(backupPath, { readonly: true, fileMustExist: true });
    let integrityOk = false;
    try {
      const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
      integrityOk = row?.integrity_check === 'ok';
    } finally {
      db.close();
    }
    if (!integrityOk) {
      console.error(`[Backup] Integrity check failed for backup: ${pendingFile}. Aborting restore.`);
      await recordEventSafe({
        category: 'admin',
        action: 'backup_restore_integrity_failed',
        severity: 'error',
        summary: `Backup restore aborted — integrity check failed: ${pendingFile}`,
        metadata: { file: pendingFile },
      });
      await cancelPendingRestore();
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Backup] Could not open backup for integrity check: ${pendingFile} — ${msg}`);
    await recordEventSafe({
      category: 'admin',
      action: 'backup_restore_integrity_failed',
      severity: 'error',
      summary: `Backup restore aborted — could not open backup file: ${pendingFile}`,
      metadata: { file: pendingFile, error: msg },
    });
    await cancelPendingRestore();
    return;
  }

  const dest = config.appDbPath;
  await fs.mkdir(path.dirname(dest), { recursive: true });

  // Swap: current → .pre-restore, backup → current
  const preRestorePath = dest + '.pre-restore';
  try {
    await fs.copyFile(dest, preRestorePath);
  } catch {
    // DB might not exist yet — that's fine.
  }

  await fs.copyFile(backupPath, dest);
  await cancelPendingRestore();
  await recordEventSafe({
    category: 'admin',
    action: 'backup_restored',
    severity: 'info',
    summary: `Database restored from backup: ${pendingFile}`,
    metadata: { file: pendingFile },
  });
  console.log(`[Backup] Restored from backup: ${pendingFile}`);
}

// ── Auto-backup scheduler ────────────────────────────────────────────────────

let autoBackupTask: ScheduledTask | null = null;

export async function startAutoBackup(): Promise<void> {
  const settings = await getAutoBackupSettings();

  await stopAutoBackup();

  if (!settings.enabled) {
    return;
  }

  // Daily at 03:00 local time.
  autoBackupTask = cron.schedule('0 3 * * *', async () => {
    try {
      const backup = await createAppBackup();
      await recordEventSafe({
        category: 'admin',
        action: 'backup_auto_created',
        summary: `Automatic daily backup created: ${backup.file}`,
        metadata: { file: backup.file, sizeBytes: backup.sizeBytes },
      });
      const pruned = await pruneOldBackups(settings.retentionDays);
      if (pruned > 0) {
        await recordEventSafe({
          category: 'admin',
          action: 'backup_pruned',
          summary: `Pruned ${pruned} old backup(s) (retention: ${settings.retentionDays} days).`,
          metadata: { pruned, retentionDays: settings.retentionDays },
        });
      }
    } catch (err) {
      console.error('[Backup] Auto-backup failed:', err);
    }
  });

  console.log(`[Backup] Auto-backup scheduled daily at 03:00 (retention: ${settings.retentionDays} days).`);
}

export async function stopAutoBackup(): Promise<void> {
  if (!autoBackupTask) return;
  autoBackupTask.stop();
  autoBackupTask.destroy();
  autoBackupTask = null;
}

/** Restart the auto-backup scheduler after settings change. */
export async function restartAutoBackup(): Promise<void> {
  await startAutoBackup();
}
