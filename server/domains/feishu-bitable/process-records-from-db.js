/**
 * Process feishu_generic_records after PG NOTIFY / catchup (P2 peel from agents.js).
 */
import {
  bitableRowUpdatedAtMs,
  collectNewDbBitableSubmissions,
  mapFeishuGenericRowsToRecords,
  markBitableRecordsProcessed,
} from './listen-helpers.js';

/**
 * @param {object} deps
 * @returns {(configKey: string) => Promise<void>}
 */
export function createProcessBitableRecordsFromDB(deps) {
  const {
    pool,
    bitableConfigs,
    processedRecordIds,
    lastProcessedTime,
    dedupMaxKeys = 30000,
    dedupCleanCount = 8000,
    extractRelationsFromBitableRecord,
    processBitableData,
    processChecklistConfirmation,
    log,
  } = deps;

  return async function processBitableRecordsFromDB(configKey) {
    const config = bitableConfigs[configKey];
    if (!config?.tableId) return;

    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    let records;
    try {
      const result = await pool().query(
        `SELECT record_id, fields, raw, created_at, updated_at
         FROM feishu_generic_records
         WHERE table_id = $1
           AND (created_at > $2 OR updated_at > $2)
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT 500`,
        [config.tableId, cutoff]
      );
      records = mapFeishuGenericRowsToRecords(result.rows || []);
    } catch (e) {
      log.error(`[bitable][${configKey}] query feishu_generic_records failed:`, e?.message);
      return;
    }

    if (records.length === 0) return;

    const { newSubmissions, newRecords } = collectNewDbBitableSubmissions(
      records,
      configKey,
      lastProcessedTime,
      bitableRowUpdatedAtMs
    );

    if (newSubmissions.length === 0) return;
    log.info(`[bitable][${configKey}] processed ${newSubmissions.length} new records from DB (via NOTIFY/catchup)`);

    for (const record of newRecords) {
      try { await extractRelationsFromBitableRecord(record, configKey); } catch (e) { /* ignore */ }
    }

    await processBitableData(configKey, newRecords);

    if (configKey === 'ops_checklist' && typeof processChecklistConfirmation === 'function') {
      for (const sub of newSubmissions) {
        try {
          await processChecklistConfirmation(sub);
        } catch (e) {
          log.error(`[bitable] ops_checklist confirmation error:`, e?.message);
        }
        await new Promise((r) => setImmediate(r));
      }
    }

    markBitableRecordsProcessed(
      newRecords,
      configKey,
      processedRecordIds,
      lastProcessedTime,
      dedupMaxKeys,
      dedupCleanCount,
      bitableRowUpdatedAtMs
    );
  };
}
