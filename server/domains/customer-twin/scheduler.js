/**
 * 培训卡每日自动生成（默认 07:10 北京时间）。
 * 生成器按来源记录去重 upsert，因此每天只会把"新出现的真实客诉"变成待审核卡；
 * 有新增时向管理员发告警（飞书/企微渠道由 sendOpsAlert 决定）。
 */

import { childLogger } from '../../utils/logger.js';
import { generateIncidentCards, countPendingTwinCards } from './incident-generator.js';
import { syncDishData } from './feishu-dish-sync.js';

const log = childLogger({ domain: 'customer-twin', handler: 'scheduler' });
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function safeSetTimeout(fn, delay) {
  if (delay > MAX_TIMEOUT_MS) {
    return setTimeout(() => safeSetTimeout(fn, delay - MAX_TIMEOUT_MS), MAX_TIMEOUT_MS);
  }
  return setTimeout(fn, Math.max(delay, 0));
}

export function startCustomerTwinSchedulers(pool, sendOpsAlert) {
  if (globalThis.__customerTwinDailySchedulerStarted) return;
  globalThis.__customerTwinDailySchedulerStarted = true;

  const schedule = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(7, 10, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    safeSetTimeout(async () => {
      try {
        const before = await countPendingTwinCards(pool);
        const result = await generateIncidentCards(pool, { limitPerSource: 50 });
        const after = await countPendingTwinCards(pool);
        log.info({ msg: 'customer_twin_daily_generate_done', result, pending_before: before, pending_after: after });
        if (typeof sendOpsAlert === 'function' && after > before) {
          sendOpsAlert(
            `今日自动生成了 ${after - before} 张真实客诉培训卡（待审共 ${after} 张），请到平台的「培训卡审核」模块处理。`,
            { title: '培训卡审核' }
          ).catch(() => {});
        }
      } catch (e) {
        log.error({ msg: 'customer_twin_daily_generate_failed', err: e?.message || String(e) });
      } finally {
        schedule();
      }
    }, next - now);
  };
  schedule();

  // 菜品属性 + 新品研发记录每日同步（06:50，早于培训卡生成）
  if (globalThis.__customerTwinDishSyncSchedulerStarted) return;
  globalThis.__customerTwinDishSyncSchedulerStarted = true;
  const scheduleDish = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(6, 50, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    safeSetTimeout(async () => {
      try {
        const result = await syncDishData(pool);
        log.info({ msg: 'customer_twin_dish_sync_scheduled_done', result });
      } catch (e) {
        log.error({ msg: 'customer_twin_dish_sync_scheduled_failed', err: e?.message || String(e) });
        if (typeof sendOpsAlert === 'function') {
          sendOpsAlert(
            `⚠️ 【菜品测试数据同步失败】${String(e?.message || e).slice(0, 400)}`,
            { title: '菜品测试同步' }
          ).catch(() => {});
        }
      } finally {
        scheduleDish();
      }
    }, next - now);
  };
  scheduleDish();
}
