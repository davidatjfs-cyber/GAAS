import axios from 'axios';
import { executeGrowthActionRecord, resolveTenantIdForStore } from './growth-api.js';
import { getActiveTenantIds, tenantContext } from './utils/database.js';
import { refreshSalesGrowthSnapshot } from './domains/growth-pos/ingest.js';
import { registerGrowthAbRoutes } from './domains/growth-ab/routes.js';
import {
  ensureGrowthPhaseTables_1_4,
  ensureGrowthPhaseTables_5_8,
  ensureGrowthPhaseTables_9,
} from './growth-phase-tables.js';
import {
  evaluateAbTask,
  isAbManualInput,
  promoteAbWinner,
  refreshAbTestResults,
  safeDateOnly,
  todayShanghaiYmd,
} from './domains/growth-ab/service.js';
import { registerGrowthCouponRoutes } from './domains/growth-coupons/routes.js';
import { registerGrowthSyncFailureRoutes } from './domains/growth-sync-failures/routes.js';
import { registerGrowthWechatWorkRoutes } from './domains/growth-wechat-work/routes.js';
import { registerGrowthCampaignRoutes } from './domains/growth-campaigns/routes.js';
import { registerGrowthContentCalendarRoutes } from './domains/growth-content-calendar/routes.js';
import { registerGrowthContentRoutes } from './domains/growth-content/routes.js';
import {
  generateWeeklyContentSuggestion,
  pushWeeklySuggestionToFeishu,
} from './domains/growth-content/service.js';
import { registerGrowthPosRoutes } from './domains/growth-pos/routes.js';
import { registerGrowthChurnRoutes } from './domains/growth-churn/routes.js';
import { computeChurnScores } from './domains/growth-churn/service.js';
import { registerGrowthMenuHealthRoutes } from './domains/growth-menu-health/routes.js';
import { generateMenuHealthReport } from './domains/growth-menu-health/service.js';
import {
  authPhaseApi,
  cleanText,
  getPhaseApiTenantId,
} from './domains/growth-phase-auth.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'growth-phases' });


export async function ensurePhaseTables(pool) {
  await ensureGrowthPhaseTables_1_4(pool);
  await ensureGrowthPhaseTables_5_8(pool);
  await ensureGrowthPhaseTables_9(pool);
}


export { ingestPosOrders } from './domains/growth-pos/ingest.js';

/**
 * @param {import('express').Express} app
 * @param {any} pool
 * @param {{ getFeishuBitableData?: Function }} [deps]
 */
export function registerPhaseRoutes(app, pool, deps = {}) {
  function rqa(req, res) {
    const auth = authPhaseApi(req);
    if (!auth.ok) { res.status(auth.status).json({ ok: false, error: auth.error }); return false; }
    return true;
  }

  const phaseAuthDeps = {
    pool,
    requirePhaseAuth: rqa,
    getPhaseTenantId: getPhaseApiTenantId,
  };

  // Phase 1–3 → domains（#6：先测后搬；企微飞书依赖 getFeishuBitableData 注入，禁止反向 import index）
  registerGrowthCouponRoutes(app, phaseAuthDeps);
  registerGrowthSyncFailureRoutes(app, phaseAuthDeps);
  registerGrowthWechatWorkRoutes(app, {
    ...phaseAuthDeps,
    resolveTenantIdForStore,
    getFeishuBitableData:
      deps.getFeishuBitableData ||
      (async () => {
        throw new Error('getFeishuBitableData_not_injected');
      }),
  });
  registerGrowthCampaignRoutes(app, {
    ...phaseAuthDeps,
    executeGrowthActionRecord,
  });
  registerGrowthContentCalendarRoutes(app, phaseAuthDeps);
  registerGrowthContentRoutes(app, phaseAuthDeps);
  registerGrowthPosRoutes(app, phaseAuthDeps);
  registerGrowthChurnRoutes(app, phaseAuthDeps);
  registerGrowthMenuHealthRoutes(app, phaseAuthDeps);
  registerGrowthAbRoutes(app, phaseAuthDeps);

  let __growthAbCronLast = '';
  let __growthContentCronLast = '';
  let __growthChurnCronLast = '';
  let __growthMenuCronLast = '';
  let __growthSnapshotCronLast = '';
  if (!globalThis.__growthPhase45Timers) {
    globalThis.__growthPhase45Timers = true;
    setInterval(async () => {
      const nowYmd = todayShanghaiYmd();
      try {
        for (const taskTenantId of await getActiveTenantIds(pool)) {
          await tenantContext.run(taskTenantId, async () => {
            const running = await pool.query(`SELECT * FROM ab_test_tasks WHERE status = 'running' ORDER BY id DESC LIMIT 20`);
            for (const task of running.rows || []) {
            // 手动录入类(绑定模式 或 任何模板测试)跳过 POS 归因刷新；仅旧的 price_test 走自动归因。
            const manualInput = isAbManualInput(task);
            if (!manualInput) await refreshAbTestResults(pool, task, taskTenantId).catch(() => null);
            if (safeDateOnly(task.end_date) <= nowYmd) {
              const evaluated = await evaluateAbTask(pool, task, taskTenantId).catch(() => null);
              const evTask = evaluated?.task;
              // 测试期已满+判出明确赢家+尚未采用 → 自动写回正式规则并生效，闭环不再需要人工点击。
              if (evaluated?.finalized && evTask && evTask.status === 'completed' && !evTask.promoted_rule_key) {
                const w = String(evTask.winner || '').toUpperCase();
                if (w === 'A' || w === 'B') {
                  await promoteAbWinner(pool, evTask, 'auto', taskTenantId).catch((e) => log.warn({ msg: 'ab_auto_promote_failed', err: e?.message }));
                }
              }
            }
            }
          });
        }
      } catch (e) {
        log.warn({ msg: 'ab_cron_failed', err: e?.message });
      }
      try {
        const now = new Date(Date.now() + 8 * 3600000);
        const weekday = now.getUTCDay();
        const hour = now.getUTCHours();
        if (weekday === 1 && hour >= 1 && __growthContentCronLast !== nowYmd) {
          __growthContentCronLast = nowYmd;
          for (const storeTenantId of await getActiveTenantIds(pool)) {
            await tenantContext.run(storeTenantId, async () => {
              const stores = await pool.query(`SELECT DISTINCT store_code FROM pos_order_items WHERE biz_date >= CURRENT_DATE - INTERVAL '30 days' AND store_code IS NOT NULL AND store_code <> '' LIMIT 20`);
              for (const row of stores.rows || []) {
              const suggestion = await generateWeeklyContentSuggestion(pool, cleanText(row.store_code, 128), nowYmd, 'weekly_cron', storeTenantId).catch(() => null);
              if (suggestion) await pushWeeklySuggestionToFeishu(pool, suggestion).catch(() => null);
              }
            });
          }
        }
      } catch (e) {
        log.warn({ msg: 'weekly_content_cron_failed', err: e?.message });
      }
      // Phase 7a: weekly churn scoring (Monday 02:00 CST = UTC weekday 1, hour 18)
      try {
        const now = new Date(Date.now() + 8 * 3600000);
        const weekday = now.getUTCDay();
        const hour = now.getUTCHours();
        if (weekday === 1 && hour >= 18 && __growthChurnCronLast !== nowYmd) {
          __growthChurnCronLast = nowYmd;
          let totalStores = 0;
          for (const storeTenantId of await getActiveTenantIds(pool)) {
            await tenantContext.run(storeTenantId, async () => {
              const storeRows = await pool.query(
                `SELECT DISTINCT store_code FROM growth_churn_predictions
                  WHERE prediction_date >= CURRENT_DATE - INTERVAL '30 days'
                 UNION
                 SELECT DISTINCT COALESCE(gcp.store_id, gc.last_store_id, '') AS store_code
                   FROM growth_customer_profiles gcp
                   FULL JOIN growth_customers gc ON gc.id = gcp.customer_id
                  WHERE COALESCE(gcp.store_id, gc.last_store_id, '') <> ''
                  LIMIT 20`
              );
              totalStores += storeRows.rows.length;
              for (const row of storeRows.rows || []) {
                await computeChurnScores(pool, cleanText(row.store_code, 128), storeTenantId).catch(() => null);
              }
            }).catch(() => null);
          }
          log.info({ msg: 'weekly_churn_scores_computed', stores: totalStores });
        }
      } catch (e) {
        log.warn({ msg: 'churn_cron_failed', err: e?.message });
      }
      // Phase 7b: monthly menu health report (1st of month at 03:00 CST = UTC day 1 of month, hour 19)
      try {
        const now = new Date(Date.now() + 8 * 3600000);
        const dayOfMonth = now.getUTCDate();
        const hour = now.getUTCHours();
        const curMonth = nowYmd.slice(0, 7);
        if (dayOfMonth === 1 && hour >= 19 && __growthMenuCronLast !== curMonth) {
          __growthMenuCronLast = curMonth;
          let totalStores = 0;
          for (const storeTenantId of await getActiveTenantIds(pool)) {
            await tenantContext.run(storeTenantId, async () => {
              const storeRows = await pool.query(
                `SELECT DISTINCT store_code FROM pos_order_items
                  WHERE biz_date >= CURRENT_DATE - INTERVAL '60 days'
                    AND store_code IS NOT NULL AND store_code <> ''
                  LIMIT 20`
              );
              totalStores += storeRows.rows.length;
              for (const row of storeRows.rows || []) {
                await generateMenuHealthReport(pool, cleanText(row.store_code, 128), curMonth, storeTenantId).catch(() => null);
              }
            }).catch(() => null);
          }
          log.info({ msg: 'monthly_menu_health_reports_generated', stores: totalStores });
        }
      } catch (e) {
        log.warn({ msg: 'menu_health_cron_failed', err: e?.message });
      }
      // Daily snapshot safety-net: 02:15 CST = UTC 18:15 (runs even if pos-feishu-sync missed)
      try {
        const now = new Date(Date.now() + 8 * 3600000);
        const hour = now.getUTCHours();
        if (hour >= 18 && __growthSnapshotCronLast !== nowYmd) {
          __growthSnapshotCronLast = nowYmd;
          let totalRows = 0;
          for (const tenantId of await getActiveTenantIds(pool)) {
            const rows = await tenantContext.run(tenantId, () => refreshSalesGrowthSnapshot(pool, 3, tenantId)).catch(e => {
              log.error({ msg: 'snapshot_cron_tenant_error', tenant_id: tenantId, err: e.message });
              return 0;
            });
            totalRows += rows;
          }
          log.info({ msg: 'snapshot_daily_refresh', rows: totalRows });
        }
      } catch (e) {
        log.warn({ msg: 'snapshot_cron_failed', err: e?.message });
      }
    }, 10 * 60 * 1000);
  }

  // ── POS Feishu sync cron: daily at 01:10 Asia/Shanghai ──
  const POS_SYNC_CRON_KEY = 'pos_feishu_sync';
  let lastPosSyncDate = '';
  function shouldRunPosSync() {
    const now = new Date(Date.now() + 8 * 3600000);
    const today = now.toISOString().slice(0, 10);
    const hour = now.getUTCHours();
    return hour === 17 && today !== lastPosSyncDate; // UTC 17:00 = CST 01:00
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
            'Authorization': 'Bearer ' + (process.env.MINIPROGRAM_SYNC_SECRET || ''),
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId
          },
          timeout: 300000
        });
        const data = resp.data;
        if (data && data.ok) {
          log.info({ msg: 'pos_sync_cron_success', tenant_id: tenantId, orders: data.orders_synced, items: data.items_synced, customers_linked: data.customers_linked });
          continue;
        }
        throw new Error(`tenant=${tenantId} ${data?.error || 'unknown_error'}`);
      }
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
