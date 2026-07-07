import fs from 'node:fs/promises';

let initialized = false;

export async function ensureBaselineSchemaHealth(pool) {
  if (!pool?.query) return { ok: false, skipped: true };
  if (initialized) return { ok: true, cached: true };
  const sql = await fs.readFile(new URL('./migrations/101_baseline_schema_health.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  initialized = true;
  console.log('[schema] baseline schema health ready');
  return { ok: true };
}
