import { tryParseJson, decryptFeishuEncryptPayload } from './crypto.js';
import { findConfigKeyByTableInfo } from './config-lookup.js';
import { stripAttachmentLikeFields, mapFeishuFieldToHrms } from './map.js';
import { upsertFeishuGenericRecord } from './records.js';
import {
  ensureFeishuGenericRecordsTable,
  ensureFeishuGenericRecordsNotifyTrigger,
  ensureFeishuSyncTable,
  ensureDedupIndexes,
  ensureTableVisitRecordsTable,
} from './schema-ensure.js';
import {
  getFeishuAccessToken,
  createFeishuBitableRecord,
  getFeishuBitableData,
} from './api.js';

export function createFeishuBitableHelpers({
  pool,
  axios,
  isExternalEnabled,
  safeErrMessage,
  notifyAdminsDualWriteFailure,
  feishuEnv = {},
}) {
  const apiDeps = { axios, isExternalEnabled, safeErrMessage, feishuEnv };

  return {
    tryParseJson,
    decryptFeishuEncryptPayload: (v) => decryptFeishuEncryptPayload(v, feishuEnv.encryptKey),
    findConfigKeyByTableInfo,
    stripAttachmentLikeFields,
    mapFeishuFieldToHrms,
    upsertFeishuGenericRecord: (args) => upsertFeishuGenericRecord(pool, args),
    ensureFeishuGenericRecordsTable: () => ensureFeishuGenericRecordsTable(pool),
    ensureFeishuGenericRecordsNotifyTrigger: () => ensureFeishuGenericRecordsNotifyTrigger(pool, notifyAdminsDualWriteFailure),
    ensureFeishuSyncTable: () => ensureFeishuSyncTable(pool, safeErrMessage),
    ensureDedupIndexes: () => ensureDedupIndexes(pool),
    ensureTableVisitRecordsTable: () => ensureTableVisitRecordsTable(pool, safeErrMessage),
    getFeishuAccessToken: (options = {}) => getFeishuAccessToken({ ...apiDeps, ...options }),
    createFeishuBitableRecord: (args) => createFeishuBitableRecord({ ...apiDeps, ...args }),
    getFeishuBitableData: (appToken, tableId, accessToken) => getFeishuBitableData(apiDeps, appToken, tableId, accessToken),
  };
}
