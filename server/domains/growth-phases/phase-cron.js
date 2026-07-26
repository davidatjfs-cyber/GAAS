/**
 * Growth phase 4–9 background crons — P5.4 peel from registerPhaseRoutes.
 */
import { getActiveTenantIds, tenantContext } from '../../utils/database.js';
import { refreshSalesGrowthSnapshot } from '../growth-pos/ingest.js';
import {
  evaluateAbTask,
  isAbManualInput,
  promoteAbWinner,
  refreshAbTestResults,
  safeDateOnly,
  todayShanghaiYmd,
} from '../growth-ab/service.js';
import {
  generateWeeklyContentSuggestion,
  pushWeeklySuggestionToFeishu,
} from '../growth-content/service.js';
import { computeChurnScores } from '../growth-churn/service.js';
import { generateMenuHealthReport } from '../growth-menu-health/service.js';
import { cleanText } from '../growth-phase-auth.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'growth-phases', handler: 'phase-cron' });

async function runAbCronTick(pool, nowYmd) {
  for (const taskTenantId of await getActiveTenantIds(pool)) {
    await tenantContext.run(taskTenantId, async () => {
      const running = await pool.query(`SELECT * FROM ab_test_tasks WHERE status = 'running' ORDER BY id DESC LIMIT 20`);
      for (const task of running.rows || []) {
        const manualInput = isAbManualInput(task);
        if (!manualInput) await refreshAbTestResults(pool, task, taskTenantId).catch(() => null);
        if (safeDateOnly(task.end_date) <= nowYmd) {
          const evaluated = await evaluateAbTask(pool, task, taskTenantId).catch(() => null);
          const evTask = evaluated?.task;
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
}

async function runWeeklyContentCronTick(pool, nowYmd) {
  const now = new Date(Date.now() + 8 * 3600000);
  const weekday = now.getUTCDay();
  const hour = now.getUTCHours();
  if (weekday !== 1 || hour < 1) return false;
  for (const storeTenantId of await getActiveTenantIds(pool)) {
    await tenantContext.run(storeTenantId, async () => {
      const stores = await pool.query(`SELECT DISTINCT store_code FROM pos_order_items WHERE biz_date >= CURRENT_DATE - INTERVAL '30 days' AND store_code IS NOT NULL AND store_code <> '' LIMIT 20`);
      for (const row of stores.rows || []) {
        const suggestion = await generateWeeklyContentSuggestion(pool, cleanText(row.store_code, 128), nowYmd, 'weekly_cron', storeTenantId).catch(() => null);
        if (suggestion) await pushWeeklySuggestionToFeishu(pool, suggestion).catch(() => null);
      }
    });
  }
  return true;
}

async function runWeeklyChurnCronTick(pool) {
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

async function runMonthlyMenuHealthCronTick(pool, curMonth) {
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

async function runDailySnapshotCronTick(pool) {
  let totalRows = 0;
  for (const tenantId of await getActiveTenantIds(pool)) {
    const rows = await tenantContext.run(tenantId, () => refreshSalesGrowthSnapshot(pool, 3, tenantId)).catch((e) => {
      log.error({ msg: 'snapshot_cron_tenant_error', tenant_id: tenantId, err: e.message });
      return 0;
    });
    totalRows += rows;
  }
  log.info({ msg: 'snapshot_daily_refresh', rows: totalRows });
}

export function startGrowthPhaseCrons(pool) {
  let __growthAbCronLast = '';
  let __growthContentCronLast = '';
  let __growthChurnCronLast = '';
  let __growthMenuCronLast = '';
  let __growthSnapshotCronLast = '';
  if (globalThis.__growthPhase45Timers) return;
  globalThis.__growthPhase45Timers = true;

  setInterval(async () => {
    const nowYmd = todayShanghaiYmd();
    try {
      await runAbCronTick(pool, nowYmd);
    } catch (e) {
      log.warn({ msg: 'ab_cron_failed', err: e?.message });
    }
    try {
      if (__growthContentCronLast !== nowYmd && await runWeeklyContentCronTick(pool, nowYmd)) {
        __growthContentCronLast = nowYmd;
      }
    } catch (e) {
      log.warn({ msg: 'weekly_content_cron_failed', err: e?.message });
    }
    try {
      const now = new Date(Date.now() + 8 * 3600000);
      const weekday = now.getUTCDay();
      const hour = now.getUTCHours();
      if (weekday === 1 && hour >= 18 && __growthChurnCronLast !== nowYmd) {
        __growthChurnCronLast = nowYmd;
        await runWeeklyChurnCronTick(pool);
      }
    } catch (e) {
      log.warn({ msg: 'churn_cron_failed', err: e?.message });
    }
    try {
      const now = new Date(Date.now() + 8 * 3600000);
      const dayOfMonth = now.getUTCDate();
      const hour = now.getUTCHours();
      const curMonth = nowYmd.slice(0, 7);
      if (dayOfMonth === 1 && hour >= 19 && __growthMenuCronLast !== curMonth) {
        __growthMenuCronLast = curMonth;
        await runMonthlyMenuHealthCronTick(pool, curMonth);
      }
    } catch (e) {
      log.warn({ msg: 'menu_health_cron_failed', err: e?.message });
    }
    try {
      const now = new Date(Date.now() + 8 * 3600000);
      const hour = now.getUTCHours();
      if (hour >= 18 && __growthSnapshotCronLast !== nowYmd) {
        __growthSnapshotCronLast = nowYmd;
        await runDailySnapshotCronTick(pool);
      }
    } catch (e) {
      log.warn({ msg: 'snapshot_cron_failed', err: e?.message });
    }
  }, 10 * 60 * 1000);
}
