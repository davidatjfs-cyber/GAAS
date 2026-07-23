/**
 * Versioned schema migrations for HRMS.
 * Tracks applied files in schema_migrations; never re-runs completed SQL.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';

/** macOS AppleDouble / 编辑器垃圾：不得进入迁移队列 */
export function isMigrationSqlFile(name) {
  const base = path.basename(String(name || ''));
  if (!base.endsWith('.sql')) return false;
  if (base.startsWith('._')) return false;
  if (base.startsWith('.~')) return false;
  // 正式迁移以数字前缀开头（含 111b_ 这类字母后缀）
  return /^\d/.test(base);
}

export async function ensureSchemaMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export function listMigrationFiles(migrationsDir = path.join(__dirname, 'migrations')) {
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => isMigrationSqlFile(f))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

export async function getAppliedVersions(pool) {
  const r = await pool.query(`SELECT version FROM schema_migrations ORDER BY version`);
  return new Set((r.rows || []).map((row) => row.version));
}

/**
 * 仓库 .sql 数 vs schema_migrations 记账对账。
 * @returns {{ ok: boolean, repoCount: number, appliedCount: number, pending: string[], orphanApplied: string[] }}
 */
export async function getMigrationDriftReport(pool, {
  migrationsDir = path.join(__dirname, 'migrations'),
} = {}) {
  await ensureSchemaMigrationsTable(pool);
  const files = listMigrationFiles(migrationsDir);
  const done = await getAppliedVersions(pool);
  const pending = files.filter((f) => !done.has(f));
  const orphanApplied = [...done].filter((v) => !files.includes(v)).sort((a, b) => a.localeCompare(b, 'en'));
  return {
    ok: pending.length === 0 && orphanApplied.length === 0,
    repoCount: files.length,
    appliedCount: done.size,
    pending,
    orphanApplied,
  };
}

/**
 * Apply pending .sql files. Each file runs in its own transaction when possible.
 * @returns {{ applied: string[], skipped: string[], failed: string|null }}
 */
export async function applyPendingMigrations(pool, {
  migrationsDir = path.join(__dirname, 'migrations'),
  dryRun = false,
  onProgress = null,
} = {}) {
  await ensureSchemaMigrationsTable(pool);
  const files = listMigrationFiles(migrationsDir);
  const done = await getAppliedVersions(pool);
  const applied = [];
  const skipped = [];

  for (const file of files) {
    if (done.has(file)) {
      skipped.push(file);
      if (onProgress) onProgress({ type: 'skip', file });
      continue;
    }
    if (dryRun) {
      applied.push(file);
      if (onProgress) onProgress({ type: 'pending', file });
      continue;
    }
    const full = path.join(migrationsDir, file);
    const sql = fs.readFileSync(full, 'utf8');
    if (onProgress) onProgress({ type: 'run', file });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      applied.push(file);
      if (onProgress) onProgress({ type: 'done', file });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_rb) {
        /* ignore */
      }
      if (onProgress) onProgress({ type: 'error', file, error: e });
      return { applied, skipped, failed: file, error: e };
    } finally {
      client.release();
    }
  }

  return { applied, skipped, failed: null, error: null };
}
