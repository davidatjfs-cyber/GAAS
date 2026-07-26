/**
 * ensureMasterTables orchestration (P4 peel from master-agent.js).
 */
import { applyCoreMasterTablesDdl } from './master-tables-ddl-core.js';
import { applyTrainingRelatedTablesDdl } from './master-tables-ddl-training.js';
import { applyAgentMonitorTablesDdl } from './master-tables-ddl-monitor.js';

/**
 * @param {{
 *   getPool: () => { connect: Function },
 *   log: { info: Function, error: Function },
 *   ensureKnowledgeGraphTables: () => Promise<void>,
 * }} deps
 */
export function createMasterTablesEnsuring(deps) {
  const { getPool, log, ensureKnowledgeGraphTables } = deps;

  return async function ensureMasterTables() {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await applyCoreMasterTablesDdl(client);
      await applyTrainingRelatedTablesDdl(client);
      await applyAgentMonitorTablesDdl(client);
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
