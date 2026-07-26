/**
 * Bitable submission poller (Wave A4b peel from agents.js pollBitableSubmissions).
 * Dedup Sets/Maps stay in agents.js and are injected by reference.
 */
import { childLogger } from '../../utils/logger.js';
import {
  collectNewBitableSubmissions,
  fetchAllBitableRecords,
  persistGenericBitableRecords,
  processOpsChecklistSubmissions,
} from './poll-submissions-helpers.js';

const log = childLogger({ domain: 'feishu-bitable', handler: 'poll-submissions' });

/**
 * @param {object} deps
 * @returns {(configKey?: string) => Promise<void>}
 */
export function createPollBitableSubmissions(deps) {
  const {
    pool,
    bitableConfigs,
    processedRecordIds,
    lastProcessedTime,
    dedupMaxKeys = 30000,
    dedupCleanCount = 8000,
    seedBitableDedup,
    getBitableRecords,
    extractRelationsFromBitableRecord,
    processBitableData,
    validateSubmissionLogic,
    validatePhotoAuthenticity,
    getBitableRecordImageDownloadUrl,
    callVisionLLM,
    extractScore,
    deduplicateMessage,
    sendLarkMessage,
    prefixWithAgentName,
  } = deps;

  return async function pollBitableSubmissions(configKey = 'ops_checklist') {
    const cfg = bitableConfigs[configKey];
    if (!cfg?.tableId) return;
    await seedBitableDedup();
    log.info({ msg: 'bitable_poll', detail: [`[bitable][${configKey}] polling submissions...`] });

    const records = await fetchAllBitableRecords(configKey, getBitableRecords, log);
    if (records === null) return;

    const { newSubmissions, newRecords } = collectNewBitableSubmissions(
      records,
      configKey,
      processedRecordIds,
      lastProcessedTime,
      dedupMaxKeys,
      dedupCleanCount,
      log
    );

    if (newSubmissions.length === 0) return;

    log.info({ msg: 'bitable_poll', detail: [`[bitable][${configKey}] processed ${newSubmissions.length} new submissions`] });

    await persistGenericBitableRecords(pool, configKey, newRecords, bitableConfigs, log);

    for (const record of newRecords) {
      try { await extractRelationsFromBitableRecord(record, configKey); } catch (e) { /* ignore */ }
    }

    await processBitableData(configKey, newRecords);

    if (configKey === 'ops_checklist') {
      await processOpsChecklistSubmissions({
        pool,
        validateSubmissionLogic,
        validatePhotoAuthenticity,
        getBitableRecordImageDownloadUrl,
        callVisionLLM,
        extractScore,
        deduplicateMessage,
        sendLarkMessage,
        prefixWithAgentName,
        log,
      }, newSubmissions);
    }
  };
}
