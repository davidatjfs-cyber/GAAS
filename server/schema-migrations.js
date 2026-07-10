/**
 * Versioned schema migrations for HRMS.
 * Tracks applied files in schema_migrations; never re-runs completed SQL.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';

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
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

export async function getAppliedVersions(pool) {
  const r = await pool.query(`SELECT version FROM schema_migrations ORDER BY version`);
  return new Set((r.rows || []).map((row) => row.version));
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
