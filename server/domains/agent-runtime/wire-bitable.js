/**
 * Bitable submission archive / records-client / process / stats / poll wiring
 * (P17 peel from agents.js bottom `createXxx` wiring cluster).
 */
import { createArchiveOldBitableSubmissions } from '../feishu-bitable/archive-old-submissions.js';
import { createBitableRecordsClient } from '../feishu-bitable/bitable-records-client.js';
import { createProcessBitableData } from '../feishu-bitable/process-bitable-data.js';
import { createGetBitableSubmissionStats } from '../feishu-bitable/get-submission-stats.js';
import { createOpsSubmissionValidation } from '../agent-ops/submission-validation.js';
import { createPollBitableSubmissions } from '../feishu-bitable/poll-submissions.js';

/**
 * @param {object} deps
 */
export function wireBitable(deps) {
  const {
    pool,
    bitableConfigs,
    axios,
    sleep,
    tenantContext,
    extractDissatisfactionDishFromFields,
    extractDissatisfactionReasonFromFields,
    normalizeBitableDateValue,
    normalizeCanonicalStoreName,
    extractBitableFieldText,
    callVisionLLM,
    log,
    processedRecordIds,
    lastProcessedTime,
    seedBitableDedup,
    getBitableRecords,
    extractRelationsFromBitableRecord,
    processBitableData,
    getBitableRecordImageDownloadUrl,
    deduplicateMessage,
    sendLarkMessage,
    prefixWithAgentName,
  } = deps;

  const archiveOldBitableSubmissions = createArchiveOldBitableSubmissions({
    pool,
    archiveThresholdDays: 7,
    deleteThresholdDays: 60,
  });

  const bitableRecordsClient = createBitableRecordsClient({ bitableConfigs, axios, sleep });

  const processBitableDataApi = createProcessBitableData({
    pool,
    bitableConfigs,
    tenantContext,
    extractDissatisfactionDishFromFields,
    extractDissatisfactionReasonFromFields,
    normalizeBitableDateValue,
    normalizeCanonicalStoreName,
    extractBitableFieldText,
  });

  const getBitableSubmissionStats = createGetBitableSubmissionStats({ pool });

  const { extractScore, validatePhotoAuthenticity, validateSubmissionLogic } = createOpsSubmissionValidation({
    pool,
    callVisionLLM,
    log,
  });

  const pollBitableSubmissions = createPollBitableSubmissions({
    pool,
    bitableConfigs,
    processedRecordIds,
    lastProcessedTime,
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
  });

  return {
    archiveOldBitableSubmissions,
    bitableRecordsClient,
    processBitableData: processBitableDataApi,
    getBitableSubmissionStats,
    pollBitableSubmissions,
  };
}
