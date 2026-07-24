/**
 * 全量拉取指定多维表并写入 feishu_generic_records；桌访表同时 upsert table_visit_records（供 HTTP 与 CLI 共用）。
 */
export async function runManualFeishuBitableSync(
  ctx,
  { appToken, tableId, appId, appSecret }
) {
  const {
    getFeishuAccessToken,
    getFeishuBitableData,
    findConfigKeyByTableInfo,
    upsertFeishuGenericRecord,
    mapFeishuFieldToHrms,
    upsertTableVisitRecordFromMapped,
    notifyAdminsDualWriteFailure
  } = ctx;

  if (!appToken || !tableId) {
    throw new Error('missing_app_token_or_table_id');
  }
  const accessToken = await getFeishuAccessToken({ appId, appSecret });
  const data = await getFeishuBitableData(appToken, tableId, accessToken);

  const TABLE_VISIT_TABLE_ID = 'tblpx5Efqc6eHo3L';
  const isTableVisit = String(tableId || '').trim() === TABLE_VISIT_TABLE_ID;

  let synced = 0;
  let failed = 0;
  let genericUpserted = 0;
  const failedDetails = [];

  for (const record of data.items || []) {
    try {
      const configKey = findConfigKeyByTableInfo(appToken, tableId);
      await upsertFeishuGenericRecord({ appToken, tableId, record, configKey });
      genericUpserted++;

      if (!isTableVisit) {
        continue;
      }

      const hrmsData = mapFeishuFieldToHrms(record, 'table_visit');

      if (hrmsData.date && hrmsData.store) {
        await upsertTableVisitRecordFromMapped(hrmsData);
        synced++;
      } else {
        failed++;
        const reason = `missing_required_fields date="${hrmsData.date || ''}" store="${hrmsData.store || ''}"`;
        const detail = {
          recordId: record?.record_id || null,
          reason,
          required: {
            date: hrmsData.date || '',
            store: hrmsData.store || ''
          }
        };
        if (failedDetails.length < 30) failedDetails.push(detail);
        console.warn('[Manual Sync] Skipped record:', detail);
      }
    } catch (error) {
      const detail = {
        recordId: record?.record_id || null,
        reason: error?.message || String(error || 'unknown_error')
      };
      if (failedDetails.length < 30) failedDetails.push(detail);
      console.error('[Manual Sync] Record error:', detail);
      failed++;
    }
  }

  if (failed > 0) {
    void notifyAdminsDualWriteFailure(
      '飞书多维表手动同步（部分记录写入失败）',
      new Error(
        `failed=${failed} synced=${synced} total=${data.items?.length || 0} ` +
          `${JSON.stringify((failedDetails || []).slice(0, 5))}`.slice(0, 500)
      )
    );
  }

  return {
    message: 'Manual sync completed',
    synced,
    failed,
    total: data.items?.length || 0,
    genericUpserted,
    isTableVisit,
    failedDetails
  };
}
