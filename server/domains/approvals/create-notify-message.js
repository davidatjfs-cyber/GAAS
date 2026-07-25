/**
 * createApproval 待审批通知文案（纯函数，可单测）。
 */

export function buildCreateApprovalNotifyMessage({
  type,
  label,
  applicantName,
  payload,
  state,
  stateFindUserRecord,
  safeDateOnly,
  safeNumber,
}) {
  let msg = `${applicantName} 提交了${label}申请，请审批。`;
  if (type === 'offboarding') {
    const resignDate = safeDateOnly(payload?.resignDate || payload?.date || payload?.resignationDate);
    if (resignDate) msg = `${applicantName} 提交了离职申请，期望离职日期：${resignDate}`;
  }
  if (type === 'leave') {
    const startDate = safeDateOnly(payload?.startDate || payload?.fromDate || payload?.beginDate);
    const endDate = safeDateOnly(payload?.endDate || payload?.toDate || payload?.finishDate);
    if (startDate && endDate) msg = `${applicantName} 提交了休假申请：${startDate} 至 ${endDate}`;
  }
  if (type === 'onboarding') {
    const emp = payload?.employee && typeof payload.employee === 'object' ? payload.employee : {};
    const empName = String(emp?.name || '').trim() || '新员工';
    msg = `${applicantName} 提交了新员工「${empName}」的入职申请，请审批。`;
  }
  if (type === 'promotion') {
    const newLevel = String(payload?.newLevel || payload?.level || '').trim();
    msg = `${applicantName} 提交了晋升申请${newLevel ? `（目标级别：${newLevel}）` : ''}，请审批。`;
  }
  if (type === 'reward_punishment') {
    const targetUser = String(payload?.targetUsername || payload?.employeeUsername || '').trim();
    const targetRec = targetUser ? (stateFindUserRecord(state, targetUser) || {}) : {};
    const targetName = String(targetRec?.name || targetUser).trim() || applicantName;
    const rpType = String(payload?.rpType || payload?.category || '').trim();
    msg = `${applicantName} 提交了${rpType || '奖惩'}申请（${targetName}），请审批。`;
  }
  if (type === 'points') {
    const itemName = String(payload?.itemName || '积分事项').trim();
    const points = safeNumber(payload?.points) || 0;
    msg = `${applicantName} 提交了积分申请（${itemName}，${points}分），请审批。`;
  }
  return msg;
}
