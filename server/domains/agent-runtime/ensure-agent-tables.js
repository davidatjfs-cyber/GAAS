/**
 * Agent-related listen-time migrations runner (P20 peel from agents.js).
 * Runs numbered SQL files under server/migrations/ — does not invent schema.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * @param {object} deps
 * @param {() => { query: Function }} deps.pool
 * @param {{ info?: Function, error?: Function }} deps.log
 * @param {string} [deps.migrationsDir] absolute path to migrations/
 */
export function createEnsureAgentTables(deps) {
  const { pool, log, migrationsDir } = deps;
  const dir =
    migrationsDir ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

  return async function ensureAgentTables() {
    const runMig = async (name) => {
      const migrationFile = path.join(dir, name);
      const sql = fs.readFileSync(migrationFile, 'utf-8');
      await pool().query(sql);
      log.info('[agents] Migration', name, 'applied successfully');
    };
    try {
      await runMig('005_agent_p0p2_tables.sql');
    } catch (e) {
      const code = String(e?.code || '');
      if (code !== '23505') log.error('[agents] ensureAgentTables 005 failed:', e?.message || e);
    }
    try {
      await runMig('010_hrms_perf_notifications.sql');
    } catch (e) {
      log.error('[agents] ensureAgentTables 010 failed:', e?.message || e);
    }
    try {
      await runMig('012_agent_scores_base_score.sql');
    } catch (e) {
      log.error('[agents] ensureAgentTables 012 failed:', e?.message || e);
    }
  };
}
