/**
 * ensureMasterTables orchestration (P4 peel from master-agent.js).
 */
import { ensureCoreMasterTables } from './ensure-tables-core.js';
import { ensureTrainingRelatedTables } from './ensure-tables-training.js';
import { ensureAgentMonitorTables } from './ensure-tables-monitor.js';

/**
 * @param {{
 *   getPool: () => { connect: Function },
 *   log: { info: Function, error: Function },
 *   ensureKnowledgeGraphTables: () => Promise<void>,
 * }} deps
 */
export function createEnsureMasterTables(deps) {
  const { getPool, log, ensureKnowledgeGraphTables } = deps;

  return async function ensureMasterTables() {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await ensureCoreMasterTables(client);
      await ensureTrainingRelatedTables(client);
      await ensureAgentMonitorTables(client);
      await client.query('COMMIT');
      log.info('[master] Tables ensured (including autonomous, regression, LLM monitoring)');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (String(e?.code || '') === '23505') return;
      log.error('[master] ensureMasterTables failed:', e?.message);
    } finally {
      client.release();
    }
    try { await ensureKnowledgeGraphTables(); } catch (e) { log.error('[master] ensureKGTables failed:', e?.message); }
  };
}
