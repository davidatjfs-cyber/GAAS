/**
 * 飞书表格同步：菜品库成本同步（周度调度）。
 * 从 server/feishu-sync.js 拆出（behavior-preserving extract）。
 */
import { pool, resolveTenantIdDefault } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import { getFeishuAccessToken, fetchTableRecords } from './api.js';
import { notifyFeishuSyncFailure } from './notify.js';
import { loadTenantFeishuConfig, withTableMeta } from './config.js';
import { extractDishLibraryEntries } from './field-extractors.js';
import { ensureDishLibraryTable } from '../../services/feishu-dish-library-schema-ensure.js';

const log = childLogger({ domain: 'feishu-sync' });

export async function syncDishLibraryCosts(tenantId = resolveTenantIdDefault()) {
  try {
    log.info({ msg: 'dish_library_sync_start' });
    await ensureDishLibraryTable();
    const integration = await loadTenantFeishuConfig(tenantId);
    if (!integration) {
      log.warn({ msg: 'dish_library_skip_missing_integration', tenant_id: tenantId });
      return { ok: false, skipped: 'integration_not_configured' };
    }
    const accessToken = await getFeishuAccessToken(integration);
    let upserted = 0;
    let recordCount = 0;
    const syncTargets = [
      withTableMeta('dish_library', integration.tables?.dish_library),
      withTableMeta('dish_library_majixian_takeaway', integration.tables?.dish_library_majixian_takeaway)
    ].filter((row) => row.app_token && row.table_id);

    for (const tableConfig of syncTargets) {
      const records = await fetchTableRecords(tableConfig, accessToken);
      recordCount += records.length;
      for (const record of records) {
        const rows = extractDishLibraryEntries(record.fields || {}, record.record_id, {
          forceBizType: tableConfig.force_biz_type
        });
        for (const row of rows) {
          await pool().query(
            `INSERT INTO dish_library_costs
              (store, brand, biz_type, dish_name, dish_price, unit_cost, source_data, source_record_id, enabled, updated_at, tenant_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW(),$9)
             ON CONFLICT (brand, biz_type, dish_name, tenant_id)
             DO UPDATE SET
               store = EXCLUDED.store,
               dish_price = EXCLUDED.dish_price,
               unit_cost = EXCLUDED.unit_cost,
               source_data = EXCLUDED.source_data,
               source_record_id = EXCLUDED.source_record_id,
               enabled = TRUE,
               updated_at = NOW()`,
            [
              row.store,
              row.brand,
              row.biz_type,
              row.dish_name,
              row.dish_price,
              row.unit_cost,
              JSON.stringify(row.source_data || {}),
              row.feishu_record_id,
              tenantId
            ]
          );
          upserted++;
        }
      }
    }

    log.info({ msg: 'dish_library_sync_done', upserted, source_records: recordCount });
    return { ok: true, records: recordCount, upserted };
  } catch (error) {
    log.error({ msg: 'dish_library_sync_failed', err: error?.message || String(error) });
    notifyFeishuSyncFailure('菜品库成本', error);
    return { ok: false, error: String(error?.message || error) };
  }
}
