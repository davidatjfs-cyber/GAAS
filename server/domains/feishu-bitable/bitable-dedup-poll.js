/**
 * Bitable dedup state + multi-config poll scheduler (P19 peel from agents.js).
 */
export function createBitableDedupPollApi(deps) {
  const {
    pool,
    bitableConfigs,
    pollBitableSubmissions,
    log,
  } = deps;

  const lastProcessedTime = new Map();
  const processedRecordIds = new Set();
  let dedupsSeeded = false;

  async function seedBitableDedup() {
    if (dedupsSeeded) return;
    dedupsSeeded = true;
    try {
      const r = await pool().query(
        `SELECT record_id, table_id, MAX(updated_at) AS updated_at
         FROM feishu_generic_records
         WHERE created_at > NOW() - INTERVAL '30 days'
         GROUP BY record_id, table_id
         LIMIT 20000`
      );
      const tableIdToConfigKeys = new Map();
      for (const [key, cfg] of Object.entries(bitableConfigs)) {
        const tableId = String(cfg?.tableId || '').trim();
        if (!tableId) continue;
        if (!tableIdToConfigKeys.has(tableId)) tableIdToConfigKeys.set(tableId, []);
        tableIdToConfigKeys.get(tableId).push(key);
      }
      const fallbackKeys = Object.keys(bitableConfigs).filter(
        (k) => bitableConfigs[k]?.type !== 'task_response'
      );
      for (const row of r.rows || []) {
        const recordId = String(row?.record_id || '').trim();
        if (!recordId) continue;
        const tableId = String(row?.table_id || '').trim();
        const configKeys = tableIdToConfigKeys.get(tableId) || fallbackKeys;
        const rowMs = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
        const safeMs = Number.isFinite(rowMs) ? rowMs : 0;
        for (const key of configKeys) {
          const pk = `${key}_${recordId}`;
          processedRecordIds.add(pk);
          lastProcessedTime.set(pk, safeMs);
        }
      }
      log.info(`[bitable] seeded dedup set with ${processedRecordIds.size} keys from DB`);
    } catch (e) {
      log.error('[bitable] seed dedup failed:', e?.message);
    }
  }

  async function pollAllBitableSubmissions() {
    const preferredOrder = [
      'ops_checklist',
      'bad_reviews',
      'closing_reports',
      'opening_reports',
      'meeting_reports',
      'material_majixian',
      'material_hongchao',
      'table_visit',
    ];
    const known = new Set(preferredOrder);
    const finalKeys = [
      ...preferredOrder.filter((k) => bitableConfigs[k]),
      ...Object.keys(bitableConfigs).filter(
        (k) => !known.has(k) && bitableConfigs[k]?.type !== 'task_response'
      ),
    ];
    for (const configKey of finalKeys) {
      try {
        await pollBitableSubmissions(configKey);
      } catch (e) {
        log.error(`[bitable][${configKey}] poll error:`, e?.message);
      }
      await new Promise((r) => setImmediate(r));
    }
  }

  return {
    lastProcessedTime,
    processedRecordIds,
    seedBitableDedup,
    pollAllBitableSubmissions,
  };
}
