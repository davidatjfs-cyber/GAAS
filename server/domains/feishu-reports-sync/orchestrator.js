/**
 * 飞书表格同步：主同步编排 + 每日/每周定时调度器。
 * 从 server/feishu-sync.js 拆出（behavior-preserving extract）。
 */
import { resolveTenantIdDefault, runForActiveTenants } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';
import { getFeishuAccessToken } from './api.js';
import { notifyFeishuSyncFailure } from './notify.js';
import { loadTenantFeishuConfig, withTableMeta } from './config.js';
import { syncKitchenReports, syncMeetingReports, syncMaterialReports } from './report-sync.js';
import { syncSopSteps } from './sop-sync.js';
import { syncDishLibraryCosts } from './dish-library-sync.js';

const log = childLogger({ domain: 'feishu-sync' });

export async function syncAllFeishuTables(tenantId = resolveTenantIdDefault()) {
  try {
    log.info({ msg: 'feishu_tables_sync_start' });
    const integration = await loadTenantFeishuConfig(tenantId);
    if (!integration) {
      log.warn({ msg: 'skip_tenant_missing_integration', tenant_id: tenantId });
      return { ok: false, skipped: 'integration_not_configured' };
    }
    const accessToken = await getFeishuAccessToken(integration);
    const tables = integration.tables || {};

    // 1. 同步收档报告
    await syncKitchenReports(withTableMeta('closing_reports', tables.closing_reports), accessToken, 'closing', tenantId);

    // 2. 同步开档报告
    await syncKitchenReports(withTableMeta('opening_reports', tables.opening_reports), accessToken, 'opening', tenantId);

    // 3. 同步例会报告
    await syncMeetingReports(withTableMeta('meeting_reports', tables.meeting_reports), accessToken, tenantId);

    // 4. 同步马己仙原料收货日报
    await syncMaterialReports(withTableMeta('material_majixian', tables.material_majixian), accessToken, 'majixian', tenantId);

    // 5. 同步洪潮原料收货日报
    await syncMaterialReports(withTableMeta('material_hongchao', tables.material_hongchao), accessToken, 'hongchao', tenantId);

    // 6. 同步SOP步骤库（厨房打点卡数据源）
    await syncSopSteps(tenantId);

    log.info({ msg: 'feishu_tables_sync_done' });

  } catch (error) {
    log.error({ msg: 'feishu_sync_failed', err: error?.message || String(error) });
    notifyFeishuSyncFailure('全量 syncAllFeishuTables', error);
  }
}

/** setTimeout 回调本体（不含重新排程），独立导出以便直接单测。 */
export async function runDailyFeishuSyncOnce() {
  try {
    await runForActiveTenants((tenantId) => syncAllFeishuTables(tenantId));
    log.info({ msg: 'daily_sync_done' });
  } catch (error) {
    log.error({ msg: 'daily_sync_failed', err: error?.message || String(error) });
    notifyFeishuSyncFailure('每日凌晨定时', error);
  }
}

function shanghaiNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
}

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * setInterval 回调本体，独立导出以便直接单测：
 * state.lastKey 承载原闭包变量 lastWeeklyDishSyncKey 的去重语义；nowSh 可注入以避免测试依赖真实时间。
 */
export async function runWeeklyDishLibrarySyncOnce(state, nowSh = shanghaiNow()) {
  try {
    if (nowSh.getDay() === 6 && nowSh.getHours() === 0 && nowSh.getMinutes() < 5) {
      const runKey = localDateKey(nowSh);
      if (runKey !== state.lastKey) {
        state.lastKey = runKey;
        const dishRows = await runForActiveTenants((tenantId) => syncDishLibraryCosts(tenantId));
        const dishOk = dishRows.every((row) => row?.ok);
        if (dishOk) {
          log.info({ msg: 'weekly_dish_library_sync_done' });
        }
        // 失败时已在 syncDishLibraryCosts 内 notifyFeishuSyncFailure
      }
    }
  } catch (error) {
    log.error({ msg: 'weekly_dish_library_sync_failed', err: error?.message || String(error) });
    notifyFeishuSyncFailure('每周菜品库调度', error);
  }
}

export function startDailyFeishuSync() {
  // 计算下次凌晨1点的时间
  const scheduleNextSync = () => {
    const now = new Date();
    const nextSync = new Date();
    nextSync.setDate(now.getDate() + (now.getHours() >= 1 ? 1 : 0));
    nextSync.setHours(1, 0, 0, 0);

    const delay = nextSync.getTime() - now.getTime();

    log.info({ msg: 'next_sync_at', at: nextSync.toLocaleString() });

    setTimeout(async () => {
      await runDailyFeishuSyncOnce();
      // 安排下一次同步
      scheduleNextSync();
    }, delay);
  };

  // 启动调度器
  scheduleNextSync();
  log.info({ msg: 'daily_sync_scheduler_started', schedule: '01:00 CST' });

  // 每周六 00:00（Asia/Shanghai）同步菜品库（每周一次）
  const weeklyDishSyncState = { lastKey: '' };
  setInterval(() => { runWeeklyDishLibrarySyncOnce(weeklyDishSyncState); }, 60 * 1000);
  log.info({ msg: 'weekly_dish_library_scheduler_started', schedule: 'Sat 00:00 CST' });
}
