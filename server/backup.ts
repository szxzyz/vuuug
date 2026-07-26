/**
 * Backup module stub — placeholder so the server starts without errors.
 * Full backup functionality can be implemented when a backup storage target
 * (local filesystem path or cloud bucket) is configured.
 */

export interface BackupMeta {
  filename: string;
  createdAt: string;
  type: 'manual' | 'scheduled';
  sizeBytes: number;
}

/** Return a list of available backups. */
export function listBackups(): BackupMeta[] {
  return [];
}

/** Create a backup of the database. */
export async function createBackup(type: 'manual' | 'scheduled' = 'manual'): Promise<BackupMeta> {
  console.warn('⚠️ Backup module is a stub — no actual backup was created.');
  return {
    filename: `backup-${Date.now()}.sql`,
    createdAt: new Date().toISOString(),
    type,
    sizeBytes: 0,
  };
}

/** Delete a backup file by name. */
export async function deleteBackup(filename: string): Promise<void> {
  console.warn(`⚠️ Backup module is a stub — cannot delete ${filename}.`);
}

/** Get the filesystem path for a backup file. */
export function getBackupPath(filename: string): string {
  return `/tmp/${filename}`;
}

/** Restore the database from a backup file. */
export async function restoreBackup(filename: string): Promise<void> {
  console.warn(`⚠️ Backup module is a stub — cannot restore ${filename}.`);
  throw new Error('Restore not available: backup module is not configured.');
}

/** Start the scheduled backup process (no-op in stub). */
export function startBackupScheduler(): void {
  // no-op
}
