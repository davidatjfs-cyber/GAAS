export async function beforeUpdate(ctx) {
  const { row, departureType, updatedPayload, nextStatus, deps } = ctx;
  if (String(row.type || '') !== 'offboarding') return;

  const { safeDateOnly } = deps;

  if (ctx.beforeChain) {
    if (departureType && (departureType === 'voluntary' || departureType === 'involuntary')) {
      updatedPayload.departureType = departureType;
    }
    return;
  }

  if (nextStatus === 'approved') {
    const resignDate = safeDateOnly(updatedPayload?.resignDate || updatedPayload?.date || updatedPayload?.resignationDate);
    if (resignDate) ctx.effectiveDate = resignDate;
  }
}

export async function afterDecide(ctx) {
  const {
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
    uniqUsernames,
    safeDateOnly,
    shanghaiTodayDateOnly,
  } = deps;

  try {
    if (!updated || String(updated.type || '') !== 'offboarding') return;

    const state0 = (await getSharedState()) || {};
    const applicant = stateFindUserRecord(state0, updated.applicant_username) || {};
    const applicantName = String(applicant?.name || updated.applicant_username).trim() || updated.applicant_username;
    const applicantManager = String(applicant?.managerUsername || '').trim();

    let state = state0;
    const tp = String(updated.type || '').trim();
    const finalApproved = String(updated.status || '') === 'approved';
    const finalRejected = String(updated.status || '') === 'rejected';

    if ((finalApproved || finalRejected) && tp === 'offboarding') {
      const resignDate = safeDateOnly(updated.payload?.resignDate || updated.payload?.date || updated.payload?.resignationDate);
      const todayWall = hrmsNowISO().slice(0, 10);
      const todaySh = shanghaiTodayDateOnly();
      const title = finalApproved ? '离职申请已通过' : '离职申请被拒绝';
      const disableNow = finalApproved && (!resignDate || (todaySh && resignDate && String(todaySh) >= String(resignDate)));
      const msg = finalApproved
        ? (disableNow
          ? `${applicantName} 离职申请已通过，离职日期：${resignDate || todayWall}。系统已关闭 HRMS 登录、数据库账号与飞书绑定（registered）。`
          : `${applicantName} 离职申请已通过，离职日期：${resignDate || '-'}。将于该日起自动关闭 HRMS 登录与飞书绑定（当前仍可登录至离职日前一日）。`)
        : `${applicantName} 离职申请被拒绝${note ? `：${note}` : ''}`;
      const recipients = finalApproved
        ? uniqUsernames([updated.applicant_username, applicantManager])
        : uniqUsernames([updated.applicant_username]);
      await appendNotifications(recipients.map((u) => makeNotif(u, title, msg, { type: 'offboarding_result', approvalId: updated.id })));

      if (finalApproved) {
        const applicantUser = String(updated.applicant_username || '').trim();
        const employeesList = Array.isArray(state.employees) ? state.employees : [];
        const empIdx = employeesList.findIndex(e => String(e?.username || '').toLowerCase() === applicantUser.toLowerCase());
        const effectiveResign = resignDate || todayWall;
        const patches = {};
        const idFields = {};
        if (empIdx >= 0) {
          const cur = employeesList[empIdx] || {};
          const nextEmp = disableNow
            ? { ...cur, offboardingApproved: true, offboardingDate: effectiveResign, status: '离职' }
            : { ...cur, offboardingApproved: true, offboardingDate: effectiveResign };
          const nextEmployees = employeesList.slice();
          nextEmployees[empIdx] = nextEmp;
          state = { ...state, employees: nextEmployees };
          patches.employees = [nextEmp];
          idFields.employees = 'username';
        }
        const usersList = Array.isArray(state.users) ? state.users : [];
        const userIdx = usersList.findIndex(u2 => String(u2?.username || '').toLowerCase() === applicantUser.toLowerCase());
        if (userIdx >= 0 && disableNow) {
          const nextUsers = usersList.slice();
          nextUsers[userIdx] = { ...nextUsers[userIdx], status: '离职' };
          state = { ...state, users: nextUsers };
          patches.users = [nextUsers[userIdx]];
          idFields.users = 'username';
        }
        if (Object.keys(patches).length) {
          await mergeSharedStateFields(patches, idFields);
        }
      }
    }

    if (String(updated.status || '') === 'pending' && nextAssignee && tp === 'offboarding') {
      const msg = `${applicantName} 提交了离职申请，需要您审批。`;
      const notif = makeNotif(nextAssignee, '离职申请待审批', msg, { type: 'offboarding_request', approvalId: updated.id });
      await appendNotifications([notif]);
    }
  } catch (e) { /* ignore */ }
}
