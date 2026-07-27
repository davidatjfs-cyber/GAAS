/**
 * 飞书表格同步：SOP 步骤库同步（厨房打点卡数据源）。
 * 从 server/feishu-sync.js 拆出（behavior-preserving extract）。
 */
import { pool, resolveTenantIdDefault } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import { getFeishuAccessToken, fetchTableRecords } from './api.js';
import { notifyFeishuSyncFailure } from './notify.js';
import { loadTenantFeishuConfig, withTableMeta } from './config.js';
import { extractSopStepFields } from './field-extractors.js';

const log = childLogger({ domain: 'feishu-sync' });

export async function syncSopSteps(tenantId = resolveTenantIdDefault()) {
  try {
    log.info({ msg: 'sop_steps_sync_start' });
    const integration = await loadTenantFeishuConfig(tenantId);
    if (!integration) {
      log.warn({ msg: 'sop_steps_skip_missing_integration', tenant_id: tenantId });
      return { ok: false, skipped: 'integration_not_configured' };
    }
    const accessToken = await getFeishuAccessToken(integration);
    const records = await fetchTableRecords(withTableMeta('sop_steps', integration.tables?.sop_steps), accessToken);

    let upserted = 0, skipped = 0;
    for (const record of records) {
      const row = extractSopStepFields(record.fields || {}, record.record_id);
      if (!row) { skipped++; continue; }

      await pool().query(
        `INSERT INTO kitchen_sop_steps
           (dish_name, store, station, step_seq, action, time_limit_seconds,
            quality_standard, common_failure, failure_action, is_critical,
           feishu_record_id, enabled, synced_at, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,NOW(),$12)
         ON CONFLICT (dish_name, store, step_seq, tenant_id) DO UPDATE SET
           station             = EXCLUDED.station,
           action              = EXCLUDED.action,
           time_limit_seconds  = EXCLUDED.time_limit_seconds,
           quality_standard    = EXCLUDED.quality_standard,
           common_failure      = EXCLUDED.common_failure,
           failure_action      = EXCLUDED.failure_action,
           is_critical         = EXCLUDED.is_critical,
           feishu_record_id    = EXCLUDED.feishu_record_id,
           enabled             = TRUE,
           synced_at           = NOW()`,
        [
          row.dish_name, row.store, row.station, row.step_seq, row.action,
          row.time_limit_seconds, row.quality_standard, row.common_failure,
          row.failure_action, row.is_critical, row.feishu_record_id, tenantId
        ]
      );
      upserted++;
    }

    log.info({ msg: 'sop_steps_sync_done', upserted, skipped });
    return { ok: true, total: records.length, upserted, skipped };
  } catch (error) {
    log.error({ msg: 'sop_steps_sync_failed', err: error?.message || String(error) });
    notifyFeishuSyncFailure('SOP步骤库', error);
    return { ok: false, error: String(error?.message || error) };
  }
}
