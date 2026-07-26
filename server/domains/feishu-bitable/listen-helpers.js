/**
 * Bitable LISTEN / catchup / DB-record helpers (P2 peel from agents.js).
 */

export function resolveBitableConfigKeyFromNotifyPayload(payload, bitableConfigs = {}) {
  const p = String(payload || '').trim();
  if (!p) return null;
  if (bitableConfigs[p]?.tableId) return p;
  for (const [k, cfg] of Object.entries(bitableConfigs)) {
    if (cfg?.type === 'task_response') continue;
    const tid = String(cfg?.tableId || '').trim();
    if (tid && tid === p) return k;
  }
  return null;
}

export function bitableRowUpdatedAtMs(record) {
  const t = record?.updated_at ?? record?.created_at ?? record?.created_time;
  if (!t) return 0;
  const d = t instanceof Date ? t : new Date(t);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function parseJsonObject(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value) : (value || {});
  } catch {
    return {};
  }
}

export function mapFeishuGenericRowsToRecords(rows) {
  return (rows || []).map((r) => {
    const raw = parseJsonObject(r.raw);
    const fields = parseJsonObject(r.fields);
    return {
      record_id: r.record_id,
      fields,
      created_at: r.created_at,
      updated_at: r.updated_at,
      ...raw,
    };
  });
}

export function buildDbBitableSubmission(configKey, record) {
  const fields = record.fields || {};
  return {
    configKey,
    recordId: record.record_id,
    createdTime: record.created_time || record.created_at,
    submitter: fields['提交人'] || '',
    store: fields['所属门店'] || fields['门店'] || '',
    checkType: fields['检查类型'] || '',
    checkStatus: fields['检查状态'] || '',
    checkRemark: fields['检查说明'] || '',
    checkPhotos: fields['检查照片'] || [],
    submitTime: fields['提交日期'] || record.created_time || record.created_at,
    fields,
  };
}

/**
 * Collect new/changed DB rows using updated_at watermark (NOTIFY/catchup path).
 */
export function collectNewDbBitableSubmissions(
  records,
  configKey,
  lastProcessedTime,
  rowUpdatedAtMs = bitableRowUpdatedAtMs
) {
  const newSubmissions = [];
  const newRecords = [];

  for (const record of records || []) {
    const recordId = record.record_id;
    const processedKey = `${configKey}_${recordId}`;
    const rowMs = rowUpdatedAtMs(record);
    const seenMs = lastProcessedTime.get(processedKey);
    if (seenMs != null && rowMs > 0 && rowMs <= seenMs) continue;

    newSubmissions.push(buildDbBitableSubmission(configKey, record));
    newRecords.push(record);
  }

  return { newSubmissions, newRecords };
}

export function markBitableRecordsProcessed(
  newRecords,
  configKey,
  processedRecordIds,
  lastProcessedTime,
  dedupMaxKeys,
  dedupCleanCount,
  rowUpdatedAtMs = bitableRowUpdatedAtMs
) {
  for (const record of newRecords || []) {
    const pk = `${configKey}_${record.record_id}`;
    const rowMs = rowUpdatedAtMs(record);
    processedRecordIds.add(pk);
    lastProcessedTime.set(pk, rowMs > 0 ? rowMs : Date.now());
    if (processedRecordIds.size > dedupMaxKeys) {
      const oldestIds = Array.from(processedRecordIds).slice(0, dedupCleanCount);
      oldestIds.forEach((id) => {
        processedRecordIds.delete(id);
        lastProcessedTime.delete(id);
      });
    }
  }
}

export function listCatchupConfigKeys(bitableConfigs = {}) {
  return Object.keys(bitableConfigs).filter(
    (k) => bitableConfigs[k]?.tableId && bitableConfigs[k]?.type !== 'task_response'
  );
}

export function computeListenReconnectDelay(backoffMs, minMs, maxMs) {
  return Math.min(Math.max(backoffMs, minMs), maxMs);
}

export function nextListenBackoffMs(backoffMs, maxMs) {
  return Math.min(backoffMs * 2, maxMs);
}

export function shouldTriggerAggressiveCatchup(failStreak, threshold) {
  return Number(failStreak) >= Number(threshold);
}

export function pickAggressiveCatchupDelay(deadlineMs, randomFn = Math.random) {
  const delay = Math.min(deadlineMs - 500, 1500 + Math.floor(randomFn() * 9000));
  return Math.max(800, delay);
}

export function buildBitableCapacityMessages(stats) {
  const mainCount = stats?.main?.total || 0;
  const totalCount = stats?.total || 0;
  const out = { mainCount, totalCount, warning: null, critical: null };
  if (mainCount > 1000) {
    out.warning =
      `⚠️ Bitable 容量提醒\n主表记录数：${mainCount}/2000\n总记录数：${totalCount}\n系统已启用自动归档，7天后数据移至归档表，60天后自动删除`;
  }
  if (mainCount > 1500) {
    out.critical =
      `🚨 Bitable 容量预警\n主表记录数：${mainCount}/2000\n系统将自动清理旧数据，无需手动干预`;
  }
  return out;
}

export function msUntilNextArchiveAt3am(now = new Date()) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(3, 0, 0, 0);
  return { msUntilArchive: tomorrow.getTime() - now.getTime(), nextAt: tomorrow };
}
