import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';
import { createBackup, ensureAppDb } from './sqlite';

const BACKUP_RETENTION = 50;

export interface AppBackupRecord {
  file: string;
  path: string;
  createdAt: string;
  sizeBytes: number;
}

export function appBackupDir(): string {
  return path.join(config.adminStoreDir, 'backups');
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
        };
      }),
  );

  return backups
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.min(Math.max(Math.floor(limit), 1), BACKUP_RETENTION));
}
