import { childLogger } from '../../../utils/logger.js';

const log = childLogger({ domain: 'approvals', handler: 'reward-punishment' });

export async function beforeUpdate(_ctx) {}

export async function afterDecide(ctx) {
  const {
    req,
    deps,
    updated,
    nextAssignee,
    note,
    username,
  } = ctx;
  const {
    pool,
    hrmsNowISO,
    makeNotif,
    appendNotifications,
    getSharedState,
    stateFindUserRecord,
    safeNumber,
    safeBizMonth,
    randomUUID,
    upsertPayrollLedgerEntry,
    notifyAdminsDualWriteFailure,
  } = deps;

  try {
    if (!updated || String(updated.type || '') !== 'reward_punishment') return;

    const state0 = (await getSharedState()) || {};
    const applicantUser = String(updated.applicant_username || '').trim();
    const applicant = stateFindUserRecord(state0, applicantUser) || {};
    const applicantName = String(applicant?.name || applicantUser).trim() || applicantUser;
    const finalApproved = String(updated.status || '') === 'approved';
    const finalRejected = String(updated.status || '') === 'rejected';
    let state = state0;

    const targetUsername = String(updated.payload?.targetUsername || updated.payload?.employeeUsername || '').trim();
    const targetRec = targetUsername ? (stateFindUserRecord(state, targetUsername) || {}) : {};
    const targetName = String(targetRec?.name || targetUsername).trim() || targetUsername || applicantName;
    const rpType = String(updated.payload?.rpType || updated.payload?.category || '').trim();
    const amount = safeNumber(updated.payload?.amount);
    const rpReason = String(updated.payload?.reason || '').trim();
    const rpResult = String(updated.payload?.result || '').trim();
    const isReward = rpType === '奖励' || rpType === 'reward';
    const typeLabel = isReward ? '奖励' : '惩罚';

    if (finalApproved) {
      const salaryAdj = {
        id: randomUUID(),
        approvalId: String(updated.id || ''),
        targetUsername: targetUsername || applicantUser,
        targetName,
        type: rpType || typeLabel,
        amount: Math.abs(amount || 0),
        signedAmount: isReward ? Math.abs(amount || 0) : -Math.abs(amount || 0),
        reason: rpReason,
        result: rpResult,
        applicantUsername: applicantUser,
        applicantName,
        createdAt: hrmsNowISO(),
        status: 'approved'
      };
      const adjList = Array.isArray(state.salaryAdjustments) ? state.salaryAdjustments.slice() : [];
      adjList.unshift(salaryAdj);
      state = { ...state, salaryAdjustments: adjList };

      try {
        await pool.query(
          `INSERT INTO hrms_reward_punishment_records (id, username, name, store, brand, type, category, points, amount, reason, source, approval_id, status, created_by, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approval',$11,'active',$12,$13)
           ON CONFLICT (id) DO UPDATE SET
             status='active', amount=$9, reason=$10`,
          [salaryAdj.id, targetUsername || applicantUser, targetName,
           String(targetRec?.store || '').trim(), String(targetRec?.brand || '').trim(),
           isReward ? 'reward' : 'punishment', rpType,
           isReward ? Math.abs(amount || 0) : -Math.abs(amount || 0),
           Math.abs(amount || 0), rpReason, updated.id, applicantUser,
           req.tenantId || req.user?.tenant_id || 'default']
        );
      } catch (e) {
        log.error({ msg: 'reward_punishment_records_dual_write_failed', err: e?.message });
        void notifyAdminsDualWriteFailure('hrms_reward_punishment_records（奖惩审批双写）', e);
      }

      try {
        const tidRp = req.tenantId || req.user?.tenant_id || 'default';
        const bizMonthRp = safeBizMonth(
          updated.payload?.bizMonth || updated.payload?.businessMonth || updated.payload?.occurMonth
          || updated.payload?.occurDate || updated.payload?.eventDate || updated.payload?.date
        ) || hrmsNowISO().slice(0, 7);
        const signed = isReward ? Math.abs(amount || 0) : -Math.abs(amount || 0);
        await upsertPayrollLedgerEntry({
          tenantId: tidRp,
          username: targetUsername || applicantUser,
          store: String(targetRec?.store || '').trim(),
          bizMonth: bizMonthRp,
          entryType: isReward ? 'reward' : 'punishment',
          amount: signed,
          title: typeLabel,
          reason: rpReason,
          approvalId: updated.id,
          createdBy: username
        });
      } catch (ledErr) {
        log.error({ msg: 'reward_punishment_payroll_ledger_failed', err: ledErr?.message });
      }

      const notifications = [];
      if (targetUsername) {
        const msgTarget = isReward
          ? `${targetName}，由于${rpReason || '工作表现优秀'}原因，本月你会收到${amount || 0}元的奖励，继续努力哦！`
          : `${targetName}，由于${rpReason || '相关原因'}原因，本月你会收到${amount || 0}元的处罚，希望可以加油改进！`;
        notifications.push(makeNotif(targetUsername, `${typeLabel}通知`, msgTarget, { type: 'reward_punishment_result', approvalId: updated.id }));
      }
      const msgApplicant = isReward
        ? `${targetName}的奖励申请已审批通过，金额${amount || 0}元已计入薪资表。`
        : `${targetName}的处罚申请已审批通过，金额${amount || 0}元已计入薪资表。`;
      notifications.push(makeNotif(applicantUser, `${typeLabel}申请已通过`, msgApplicant, { type: 'reward_punishment_result', approvalId: updated.id }));
      await appendNotifications(notifications);
    }

    if (finalRejected) {
      const msg = `对${targetName}的${typeLabel}申请因为${note || '相关原因'}没有审批通过。`;
      await appendNotifications([makeNotif(applicantUser, `${typeLabel}申请未通过`, msg, { type: 'reward_punishment_result', approvalId: updated.id })]);
    }

    if (String(updated.status || '') === 'pending' && nextAssignee) {
      const msg = `${applicantName} 提交了${typeLabel}申请（${targetName}），需要您审批。`;
      await appendNotifications([makeNotif(nextAssignee, `${typeLabel}申请待审批`, msg, { type: 'reward_punishment_request', approvalId: updated.id })]);
    }
  } catch (e) { /* ignore */ }
}
