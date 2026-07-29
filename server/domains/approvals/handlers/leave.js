import { childLogger } from '../../../utils/logger.js';
import { fmtLeaveDate } from './shared.js';

const log = childLogger({ domain: 'approvals', handler: 'leave' });

export async function beforeUpdate(ctx) {
  const { row, remainingLeaveDaysRaw, username, updatedPayload } = ctx;
  if (String(row.type || '') !== 'leave') return;
  if (remainingLeaveDaysRaw != null && remainingLeaveDaysRaw !== '') {
    const remDays = Number(remainingLeaveDaysRaw);
    if (Number.isFinite(remDays)) {
      updatedPayload.remainingLeaveDays = remDays;
      updatedPayload.remainingLeaveDaysFilledBy = username;
    }
  }
}

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
    uniqUsernames,
    safeDateOnly,
    safeNumber,
    randomUUID,
    calcDateSpanDaysInclusive,
    notifyAdminsDualWriteFailure,
    invalidateSharedStateCache,
  } = deps;

  try {
    if (!updated || String(updated.type || '') !== 'leave') return;

    const state0 = (await getSharedState()) || {};
    const applicant = stateFindUserRecord(state0, updated.applicant_username) || {};
    const applicantName = String(applicant?.name || updated.applicant_username).trim() || updated.applicant_username;
    const applicantManager = String(applicant?.managerUsername || '').trim();

    let state = state0;
    const tp = String(updated.type || '').trim();
    const finalApproved = String(updated.status || '') === 'approved';
    const finalRejected = String(updated.status || '') === 'rejected';

    if (finalApproved && tp === 'leave') {
      const startDate = safeDateOnly(updated.payload?.startDate || updated.payload?.fromDate || updated.payload?.beginDate);
      const endDate = safeDateOnly(updated.payload?.endDate || updated.payload?.toDate || updated.payload?.finishDate);
      const reason = String(updated.payload?.reason || updated.payload?.leaveReason || '').trim();
      const reqDays = safeNumber(updated.payload?.days || updated.payload?.leaveDays);
      const autoDays = calcDateSpanDaysInclusive(startDate, endDate);
      const days = (reqDays != null && reqDays > 0) ? reqDays : (autoDays != null ? autoDays : null);

      const rec = {
        id: randomUUID(),
        approvalId: String(updated.id || ''),
        applicant: String(updated.applicant_username || '').trim(),
        applicantName,
        managerUsername: applicantManager,
        store: String(applicant?.store || '').trim(),
        department: String(applicant?.department || '').trim(),
        position: String(applicant?.position || '').trim(),
        startDate,
        endDate,
        days: days == null ? '' : days,
        reason,
        createdAt: hrmsNowISO(),
        status: 'approved'
      };
      const list = Array.isArray(state.leaveRecords) ? state.leaveRecords.slice() : [];
      list.unshift(rec);
      state = { ...state, leaveRecords: list };

      const tid = req.tenantId || req.user?.tenant_id || 'default';
      try {
        await pool.query(
          `INSERT INTO hrms_leave_records (id, username, name, store, brand, start_date, end_date, days, type, reason, status, approval_id, approved_by, approved_at, submitted_by, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved',$11,$12,$13,$14,$15)
           ON CONFLICT (id) DO UPDATE SET
             status='approved', approved_by=$12, approved_at=$13, days=$8`,
          [rec.id, String(applicant?.username || '').trim(), String(applicantName || '').trim(),
           String(applicant?.store || '').trim(), String(applicant?.brand || '').trim(),
           startDate, endDate, days == null ? 0 : days, String(updated.payload?.type || 'leave').trim(),
           reason, updated.id, username, new Date(hrmsNowISO()), username,
           tid]
        );
      } catch (e) {
        log.error({ msg: 'leave_records_dual_write_failed', err: e?.message });
        void notifyAdminsDualWriteFailure('hrms_leave_records（休假审批双写）', e);
      }
      if (typeof invalidateSharedStateCache === 'function') {
        invalidateSharedStateCache(tid);
      }

      const sd = fmtLeaveDate(startDate);
      const ed = fmtLeaveDate(endDate);
      const msg = `${applicantName}提交的休假申请${sd}至${ed}，已经审批通过。`;
      const recipients = uniqUsernames([updated.applicant_username, applicantManager].filter(Boolean));
      await appendNotifications(recipients.map((u) => makeNotif(u, '休假申请已通过', msg, { type: 'leave_result', approvalId: updated.id, leaveId: rec.id })));
    }

    if (finalRejected && tp === 'leave') {
      const startDate2 = safeDateOnly(updated.payload?.startDate || updated.payload?.fromDate || updated.payload?.beginDate);
      const endDate2 = safeDateOnly(updated.payload?.endDate || updated.payload?.toDate || updated.payload?.finishDate);
      const sd2 = fmtLeaveDate(startDate2);
      const ed2 = fmtLeaveDate(endDate2);
      const msg = `${applicantName}提交的休假申请${sd2}至${ed2}，因为${note || '相关原因'}没有审批通过。`;
      const recipients = uniqUsernames([updated.applicant_username, applicantManager].filter(Boolean));
      await appendNotifications(recipients.map((u) => makeNotif(u, '休假申请未通过', msg, { type: 'leave_result', approvalId: updated.id })));
    }

    if (String(updated.status || '') === 'pending' && nextAssignee && tp === 'leave') {
      const msg = `${applicantName} 提交了休假申请，需要您审批。`;
      await appendNotifications([makeNotif(nextAssignee, '休假申请待审批', msg, { type: 'leave_request', approvalId: updated.id })]);
    }
  } catch (e) { /* ignore */ }
}
