export async function beforeUpdate(_ctx) {}

export async function afterDecide(ctx) {
  const {
    req,
    deps,
    updated,
    nextAssignee,
    note,
  } = ctx;
  const {
    hrmsNowISO,
    makeNotif,
    appendNotifications,
    getSharedState,
    mergeSharedStateFields,
    stateFindUserRecord,
  } = deps;

  try {
    if (!updated || String(updated.type || '') !== 'monthly_confirm') return;

    const state0 = (await getSharedState()) || {};
    const applicantUser = String(updated.applicant_username || '').trim();
    const applicant = stateFindUserRecord(state0, applicantUser) || {};
    const applicantName = String(applicant?.name || applicantUser).trim() || applicantUser;
    const payload = typeof updated.payload === 'string' ? JSON.parse(updated.payload) : (updated.payload || {});
    const confirmationId = String(payload?.confirmationId || '').trim();
    const mcMonth = String(payload?.month || '').trim();
    const mcStore = String(payload?.store || '').trim();

    if (String(updated.status || '') === 'approved' && confirmationId) {
      const confirmations = Array.isArray(state0.monthlyConfirmations) ? state0.monthlyConfirmations : [];
      const mc = confirmations.find(c => c.id === confirmationId);
      if (mc) {
        mc.status = 'approved';
        mc.approvedAt = hrmsNowISO();
        mc.history = mc.history || [];
        mc.history.push({ action: 'approved', by: 'system', at: hrmsNowISO() });
        await mergeSharedStateFields({ monthlyConfirmations: [mc] }, { monthlyConfirmations: 'id' });
      }

      const msg = `${mcMonth} ${mcStore || '全部门店'} 的月度考勤确认已通过审批。工资数据将自动生成。`;
      await appendNotifications([makeNotif(applicantUser, '月度考勤确认已通过', msg, { type: 'monthly_confirm_result', approvalId: updated.id })]);
    }

    if (String(updated.status || '') === 'rejected' && confirmationId) {
      const confirmations = Array.isArray(state0.monthlyConfirmations) ? state0.monthlyConfirmations : [];
      const mc = confirmations.find(c => c.id === confirmationId);
      if (mc) {
        mc.status = 'rejected';
        mc.history = mc.history || [];
        mc.history.push({ action: 'rejected', by: String(req.user?.username || ''), at: hrmsNowISO(), note });
        await mergeSharedStateFields({ monthlyConfirmations: [mc] }, { monthlyConfirmations: 'id' });
      }
      const msg = `${mcMonth} ${mcStore || '全部门店'} 的月度考勤确认被驳回${note ? `：${note}` : ''}`;
      await appendNotifications([makeNotif(applicantUser, '月度考勤确认被驳回', msg, { type: 'monthly_confirm_result', approvalId: updated.id })]);
    }

    if (String(updated.status || '') === 'pending' && nextAssignee) {
      const msg = `${applicantName} 提交了 ${mcMonth} ${mcStore || '全部门店'} 的月度考勤确认，需要您审批。`;
      await appendNotifications([makeNotif(nextAssignee, '月度考勤确认待审批', msg, { type: 'monthly_confirm_request', approvalId: updated.id })]);
    }
  } catch (e) { console.error('monthly_confirm post-approval error:', e); }
}
