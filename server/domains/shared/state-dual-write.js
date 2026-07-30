/**
 * Full dual-write: hrms_state blob → authoritative domain tables.
 * Called after successful saveSharedState / merge commits.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'shared', handler: 'state-dual-write' });

export function createStateDualWriteHelpers({
  pool,
  resolveTenantIdDefault,
  // A1：employees 表权威；保留参数以兼容 index 注入，但不再整表回灌（见下方注释）。
  upsertEmployeesFromStateShape: _upsertEmployeesFromStateShape,
  hrmsNowISO,
  toNullableUuid,
  notifyAdminsDualWriteFailure,
}) {
  async function dualWriteStateToDB(state) {
    if (!state || typeof state !== 'object') return;
    try {
      // A1：employees 由窄 API / mergeSharedStateFields 写表+镜像。
      // 禁止在此把整份 state.employees 回灌表——并发 saveSharedState 会用过期镜像
      // 覆盖刚 PATCH 的 status（集成测 flake：inactive→active）。

      // 1. leaveRecords → hrms_leave_records 表
      const lrArr = Array.isArray(state.leaveRecords) ? state.leaveRecords : [];
      for (const lr of lrArr) {
        const rid = String(lr?.id || '').trim();
        if (!rid) continue;
        const startDate = String(lr?.startDate || '').trim();
        const endDate = String(lr?.endDate || '').trim();
        if (!startDate || !endDate) continue;
        await pool.query(
          `INSERT INTO hrms_leave_records (id, username, name, store, brand, start_date, end_date, days, type, reason, status, submitted_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET
             username=EXCLUDED.username, name=EXCLUDED.name, store=EXCLUDED.store,
             start_date=EXCLUDED.start_date, end_date=EXCLUDED.end_date, days=EXCLUDED.days,
             type=EXCLUDED.type, reason=EXCLUDED.reason, status=EXCLUDED.status, updated_at=NOW()`,
          [
            rid,
            String(lr?.applicant || '').trim(),
            String(lr?.applicantName || lr?.name || '').trim(),
            String(lr?.store || '').trim(),
            String(lr?.brand || '').trim(),
            startDate,
            endDate,
            lr?.days != null && lr?.days !== '' ? Number(lr.days) : 0,
            String(lr?.type || 'leave').trim(),
            String(lr?.reason || '').trim(),
            String(lr?.status || 'pending').trim(),
            String(lr?.createdAt || '').trim() || hrmsNowISO(),
            String(lr?.createdAt || '').trim() || hrmsNowISO(),
          ]
        );
      }

      // 3. salaryAdjustments → hrms_reward_punishment_records 表
      const saArr = Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments : [];
      for (const sa of saArr) {
        const rid = String(sa?.id || '').trim();
        if (!rid) continue;
        const rpType = String(sa?.type || '').trim();
        const isReward = rpType === '奖励' || rpType === 'reward';
        await pool.query(
          `INSERT INTO hrms_reward_punishment_records (id, username, name, store, brand, type, category, amount, reason, source, approval_id, status, created_by, created_at, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'approval',$10,$11,$12,$13,$14)
           ON CONFLICT (id) DO UPDATE SET
             username=EXCLUDED.username, name=EXCLUDED.name, type=EXCLUDED.type,
             amount=EXCLUDED.amount, reason=EXCLUDED.reason, status=EXCLUDED.status, updated_at=NOW()`,
          [
            rid,
            String(sa?.targetUsername || '').trim(),
            String(sa?.targetName || '').trim(),
            '',
            '',
            isReward ? 'reward' : 'punishment',
            rpType,
            Math.abs(Number(sa?.amount) || 0),
            String(sa?.reason || '').trim(),
            toNullableUuid(sa?.approvalId),
            String(sa?.status || 'active').trim(),
            String(sa?.applicantUsername || '').trim(),
            String(sa?.createdAt || '').trim() || hrmsNowISO(),
            resolveTenantIdDefault(),
          ]
        );
      }

      // 2026-07-30 移除：notifications → hrms_user_notifications 的回填曾经在这里，但
      // appendNotifications() 早已改为直接写 hrms_user_notifications（"权威"，不再 merge
      // blob，见 server/domains/notifications/append.js 顶部注释）——这里处理的
      // state.notifications 只是历史遗留在 blob 里的旧数组，每次任何地方调用
      // saveSharedState() 都会把这份旧数组原样重新跑一遍。而下面这条 INSERT 用的
      // `ON CONFLICT DO NOTHING` 没有指定冲突目标，hrms_user_notifications 表本身也没有
      // 除自增id外的唯一约束——`id`每次都是新值，永远不会真正命中冲突，等于完全没有去重，
      // 造成同一条通知反复被插入第二份重复记录（生产实测：'积分申请待审批'等通知从
      // 2026-07-21起持续每条2份，两份created_at相同但id相差几百，符合"每次某次全量
      // saveSharedState被调用就重插一次blob里的旧通知"这个机制）。同函数里
      // leaveRecords/salaryAdjustments 两段之所以没有这个问题，是因为它们用了自己的
      // id做真正的ON CONFLICT (id)冲突目标；notifications在blob里从来没有这样的稳定
      // 幂等键。直接删除这段回填——通知的写入路径已经完全收口到appendNotifications()，
      // 这里不需要、也不应该再从blob重新同步。
    } catch (e) {
      log.error({
        msg: 'dual_write_state_to_db_failed',
        err: e?.message || String(e),
        stack: e?.stack || null,
      });
      void notifyAdminsDualWriteFailure(
        '全量双写（employees / hrms_leave_records / hrms_reward_punishment_records）',
        e
      );
    }
  }

  return { dualWriteStateToDB };
}
