/**
 * Feishu bitable.record.changed async handler (Wave 4q — behavior-preserving extract from index.js ~8461–8639).
 * ctx 字段均为 index 本地函数或从 feishu-sync / utils/database 等模块注入。
 */
export async function processFeishuDataChange(event, logId, ctx) {
  const {
    pool,
    safeErrMessage,
    resolveTenantIdDefault,
    loadTenantFeishuBitableConfig,
    getFeishuTokenByConfig,
    getFeishuAccessToken,
    getFeishuBitableData,
    findConfigKeyByTableInfo,
    upsertFeishuGenericRecord,
    mapFeishuFieldToHrms,
    upsertTableVisitRecordFromMapped,
    notifyAdminsDualWriteFailure,
  } = ctx;

  try {
    // 租户感知：tenant 由外层 tenantContext.run(webhookTenantId, ...) 设置。
    const tenantId = resolveTenantIdDefault();
    const tenantCfg = await loadTenantFeishuBitableConfig(tenantId).catch(() => null);
    // 优先用租户专属凭证，无租户配置时回退到全局环境变量（兜底'default'）。
    const accessToken = tenantCfg?.app_id
      ? await getFeishuTokenByConfig({ app_id: tenantCfg.app_id, app_secret: tenantCfg.app_secret }).catch(() =>
          getFeishuAccessToken()
        )
      : await getFeishuAccessToken();
    const appToken = event.app_token;
    const tableId = event.table_id;
    const recordId = event.record_id;

    // 获取记录详情
    const recordData = await getFeishuBitableData(appToken, tableId, accessToken);
    const record = recordData.items?.find((item) => item.record_id === recordId);

    if (!record) {
      throw new Error('Record not found in Feishu');
    }

    // Always upsert raw record into generic storage with configKey
    try {
      const configKey = findConfigKeyByTableInfo(appToken, tableId);
      await upsertFeishuGenericRecord({ appToken, tableId, record, configKey });
    } catch (e) {
      console.log('[processFeishuDataChange] generic upsert failed:', e?.message || e);
      void notifyAdminsDualWriteFailure(
        `飞书 Webhook → feishu_generic_records（table ${String(tableId || '').slice(0, 16)} record ${String(recordId || '').slice(0, 24)}）`,
        e
      );
    }

    // 桌访表：从租户配置取 table_id，回退到默认值（默认租户历史值）。
    const tableVisitTableId = tenantCfg?.tables?.table_visit?.table_id || 'tblpx5Efqc6eHo3L';
    const isTableVisit = String(tableId || '').trim() === tableVisitTableId;
    if (!isTableVisit) {
      await pool.query('update feishu_sync_logs set sync_status = $1, processed_at = now() where id = $2', [
        'success',
        logId,
      ]);
      return;
    }

    // 根据表格类型处理数据
    const hrmsData = mapFeishuFieldToHrms(record, 'table_visit');

    // 存储到HRMS系统（这里以桌访记录为例）
    if (hrmsData.date && hrmsData.store) {
      await upsertTableVisitRecordFromMapped(hrmsData);

      // 更新同步状态
      await pool.query('update feishu_sync_logs set sync_status = $1, processed_at = now() where id = $2', [
        'success',
        logId,
      ]);

      console.log('[Feishu Webhook] Data synced successfully:', hrmsData.recordId);
    } else {
      throw new Error('Missing required fields: date or store');
    }
  } catch (error) {
    await pool.query(
      'update feishu_sync_logs set sync_status = $1, error_message = $2, processed_at = now() where id = $3',
      ['failed', safeErrMessage(error), logId]
    );
    throw error;
  }
}
