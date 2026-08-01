/**
 * POS Feishu daily sync cron — P5.4 peel from registerPhaseRoutes.
 */
import axios from 'axios';
import { getActiveTenantIds, tenantContext } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import { beatHeartbeatSimple } from '../health/monitor-beat.js';

const log = childLogger({ domain: 'growth-phases', handler: 'phase-pos-sync-cron' });

const POS_SYNC_CRON_KEY = 'pos_feishu_sync';

export function startPosFeishuSyncCron(pool) {
  let lastPosSyncDate = '';

  function shouldRunPosSync() {
    const now = new Date(Date.now() + 8 * 3600000);
    const today = now.toISOString().slice(0, 10);
    const hour = now.getUTCHours();
    return hour === 17 && today !== lastPosSyncDate;
  }

  setInterval(async () => {
    if (!shouldRunPosSync()) return;
    const now = new Date(Date.now() + 8 * 3600000);
    lastPosSyncDate = now.toISOString().slice(0, 10);
    log.info({ msg: 'pos_sync_cron_start', at: now.toISOString() });
    try {
      for (const tenantId of await getActiveTenantIds(pool)) {
        const resp = await axios.post(`http://127.0.0.1:${process.env.PORT || 3000}/api/growth/pos-feishu-sync`, {}, {
          headers: {
            Authorization: 'Bearer ' + (process.env.MINIPROGRAM_SYNC_SECRET || ''),
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId,
          },
          timeout: 300000,
        });
        const data = resp.data;
        if (data && data.ok) {
          log.info({ msg: 'pos_sync_cron_success', tenant_id: tenantId, orders: data.orders_synced, items: data.items_synced, customers_linked: data.customers_linked });
          continue;
        }
        throw new Error(`tenant=${tenantId} ${data?.error || 'unknown_error'}`);
      }
      await beatHeartbeatSimple(pool, 'pos_feishu_sync_cron');
    } catch (e) {
      log.error({ msg: 'pos_sync_cron_failed', err: e.message });
      try {
        const failedTenant = String((e.message || '').match(/tenant=([A-Za-z0-9_-]+)/)?.[1] || '').trim();
        if (failedTenant) {
          await tenantContext.run(failedTenant, async () => {
            await pool.query(`INSERT INTO growth_sync_failures (source, event_type, payload, error_message, tenant_id) VALUES ($1,$2,$3,$4,$5)`,
              [POS_SYNC_CRON_KEY, 'daily_sync_failed', '{}', e.message || String(e), failedTenant]);
            await pool.query(`INSERT INTO growth_alerts (alert_key, alert_type, severity, title, message, suggested_action, status, tenant_id)
              VALUES ($1,$2,$3,$4,$5,$6,'open',$7)
              ON CONFLICT (alert_key, tenant_id) DO UPDATE SET severity=EXCLUDED.severity, message=EXCLUDED.message, suggested_action=EXCLUDED.suggested_action, status='open', updated_at=NOW()`,
              [`pos_sync_failed_${failedTenant}`, 'pos_sync_failed', 'high', 'POS数据同步失败', '每日凌晨POS飞书同步失败：' + (e.message || String(e)).slice(0, 200), '检查飞书应用权限、表字段、网络连接；手动调 POST /api/growth/pos-feishu-sync 重试', failedTenant]);
          });
        }
      } catch (_) { /* ignore */ }
    }
  }, 60 * 1000);

  log.info({ msg: 'pos_sync_cron_scheduled', schedule: 'daily ~01:10 CST' });
}
