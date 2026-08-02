/**
 * Database backup / restore module.
 *
 * Produces a single gzip-compressed JSON dump of every table in the public
 * schema (via `SELECT *`), and can restore that dump back into the database.
 *
 * NOTE ON PERSISTENCE: backup files are written to BACKUP_DIR (default:
 * "<project root>/backups"). On hosts with an ephemeral filesystem (e.g. a
 * Render web service without a mounted persistent disk), files written here
 * are lost on redeploy/restart. Download backups you want to keep, or mount
 * a persistent disk and point BACKUP_DIR at it.
 */

import { pool } from './db';
import { promises as fsp } from 'fs';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
const MAX_BACKUPS_KEPT = 7;

// Never dump/restore the express-session store: it holds live login sessions,
// not application data, and wiping it mid-restore would log admins out and
// serves no purpose for a data backup/restore feature.
const EXCLUDED_TABLES = new Set(['sessions']);

export interface BackupMeta {
  filename: string;
  createdAt: string;
  sizeBytes: number;
  sizeHuman: string;
  type: 'auto' | 'manual';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function ensureDir(): Promise<void> {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}

async function getTableNames(): Promise<string[]> {
  const result = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  return (result.rows as any[])
    .map((r) => r.tablename as string)
    .filter((t) => !EXCLUDED_TABLES.has(t));
}

function assertValidFilename(filename: string): void {
  if (!/^backup-(auto|manual)-[0-9A-Za-z\-]+\.json\.gz$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
}

/** Return the list of available backups, newest first. */
export async function listBackups(): Promise<BackupMeta[]> {
  await ensureDir();
  const files = await fsp.readdir(BACKUP_DIR);
  const backupFiles = files.filter((f) => f.startsWith('backup-') && f.endsWith('.json.gz'));

  const metas: BackupMeta[] = [];
  for (const filename of backupFiles) {
    try {
      const filePath = path.join(BACKUP_DIR, filename);
      const stat = await fsp.stat(filePath);
      const match = filename.match(/^backup-(auto|manual)-/);
      const type: 'auto' | 'manual' = match && match[1] === 'auto' ? 'auto' : 'manual';
      const createdAt =
        stat.birthtime && stat.birthtime.getTime() > 0
          ? stat.birthtime.toISOString()
          : stat.mtime.toISOString();
      metas.push({
        filename,
        createdAt,
        sizeBytes: stat.size,
        sizeHuman: formatSize(stat.size),
        type,
      });
    } catch {
      // Skip files that vanished or can't be read (e.g. concurrent delete)
    }
  }

  metas.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return metas;
}

/** Delete a backup file by name. */
export async function deleteBackup(filename: string): Promise<void> {
  assertValidFilename(filename);
  const filePath = path.join(BACKUP_DIR, filename);
  await fsp.unlink(filePath);
}

/** Get the filesystem path for a backup file (for streaming downloads). */
export function getBackupPath(filename: string): string {
  assertValidFilename(filename);
  return path.join(BACKUP_DIR, filename);
}

/** Delete the oldest backups beyond MAX_BACKUPS_KEPT. */
async function pruneOldBackups(): Promise<void> {
  const all = await listBackups();
  if (all.length <= MAX_BACKUPS_KEPT) return;
  const toDelete = all.slice(MAX_BACKUPS_KEPT);
  for (const b of toDelete) {
    await deleteBackup(b.filename).catch((err) =>
      console.warn(`⚠️ Failed to prune old backup ${b.filename}:`, err)
    );
  }
}

/** Create a full database backup (every public-schema table except `sessions`). */
export async function createBackup(type: 'auto' | 'manual' = 'manual'): Promise<BackupMeta> {
  await ensureDir();

  const tables = await getTableNames();
  const dump: Record<string, any[]> = {};
  for (const table of tables) {
    const res = await pool.query(`SELECT * FROM "${table}"`);
    dump[table] = res.rows;
  }

  const createdAt = new Date().toISOString();
  const payload = {
    formatVersion: 1,
    createdAt,
    type,
    tables: dump,
  };

  const json = JSON.stringify(payload);
  const compressed = (await gzip(json)) as Buffer;

  const safeTimestamp = createdAt.replace(/[:.]/g, '-');
  const filename = `backup-${type}-${safeTimestamp}.json.gz`;
  const filePath = path.join(BACKUP_DIR, filename);
  await fsp.writeFile(filePath, compressed);

  await pruneOldBackups();

  const stat = await fsp.stat(filePath);
  return {
    filename,
    createdAt,
    sizeBytes: stat.size,
    sizeHuman: formatSize(stat.size),
    type,
  };
}

/**
 * Restore the database from a backup file. Overwrites all current data in
 * every table present in both the backup and the live schema.
 *
 * Uses `SET session_replication_role = replica` for the duration of the
 * transaction so tables can be truncated/reloaded in any order without
 * fighting foreign-key constraints — a standard bulk-load technique.
 */
export async function restoreBackup(
  filename: string
): Promise<{ tablesRestored: number; rowsRestored: number }> {
  const filePath = getBackupPath(filename);
  const compressed = await fsp.readFile(filePath);
  const json = (await gunzip(compressed)).toString('utf8');

  let payload: any;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new Error('Backup file is corrupted (invalid JSON)');
  }
  if (!payload || typeof payload.tables !== 'object') {
    throw new Error('Backup file is in an unrecognized format');
  }

  const backedUpTables = Object.keys(payload.tables).filter((t) => !EXCLUDED_TABLES.has(t));
  const liveTables = new Set(await getTableNames());
  // Only restore tables that still exist in the current schema — protects
  // against restoring an old backup after a table was renamed/removed.
  const tablesToRestore = backedUpTables.filter((t) => liveTables.has(t));

  const client = await pool.connect();
  let rowsRestored = 0;
  try {
    await client.query('BEGIN');
    await client.query('SET session_replication_role = replica');

    if (tablesToRestore.length > 0) {
      const quoted = tablesToRestore.map((t) => `"${t}"`).join(', ');
      await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
    }

    for (const table of tablesToRestore) {
      const rows: any[] = payload.tables[table] || [];
      if (rows.length === 0) continue;

      const colRes = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table]
      );
      const colTypes = new Map<string, string>(
        (colRes.rows as any[]).map((r) => [r.column_name as string, r.data_type as string])
      );

      const columns = Object.keys(rows[0]);
      const colList = columns.map((c) => `"${c}"`).join(', ');
      const placeholders = columns
        .map((c, i) => {
          const dtype = colTypes.get(c);
          return dtype === 'jsonb' || dtype === 'json' ? `$${i + 1}::${dtype}` : `$${i + 1}`;
        })
        .join(', ');
      const insertSql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;

      for (const row of rows) {
        const values = columns.map((c) => {
          const v = row[c];
          if (v !== null && typeof v === 'object') return JSON.stringify(v);
          return v;
        });
        await client.query(insertSql, values);
        rowsRestored++;
      }
    }

    await client.query('SET session_replication_role = origin');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return { tablesRestored: tablesToRestore.length, rowsRestored };
}

/** Start the daily 03:00 UTC automatic backup scheduler (keeps last 7 total). */
export function startBackupScheduler(): void {
  const CHECK_INTERVAL_MS = 60 * 1000; // check once a minute
  let lastRunDateUtc: string | null = null;

  setInterval(async () => {
    try {
      const now = new Date();
      const todayUtc = now.toISOString().slice(0, 10);
      if (now.getUTCHours() === 3 && lastRunDateUtc !== todayUtc) {
        lastRunDateUtc = todayUtc;
        console.log('🗄️ Running scheduled daily backup (03:00 UTC)...');
        const meta = await createBackup('auto');
        console.log(`✅ Scheduled backup created: ${meta.filename} (${meta.sizeHuman})`);
      }
    } catch (err) {
      console.error('❌ Scheduled backup failed:', err);
    }
  }, CHECK_INTERVAL_MS);

  console.log('🗓️ Backup scheduler started — daily backups at 03:00 UTC, last 7 kept.');
}
