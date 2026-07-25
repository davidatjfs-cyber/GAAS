/**
 * 审批生命周期纯逻辑（repair-onboarding / return / resubmit）。
 * 不接触 req/res；由 routes-lifecycle.js 注入 deps。
 */

import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'approvals', handler: 'service-lifecycle' });

export async function repairOnboardingEmployee({
  pool,
  getSharedState,
  mergeSharedStateFields,
  buildOnboardingEmployeeRecordFromPayload,
  id,
}) {
  const r0 = await pool.query(
    'select id, type, status, payload from approval_requests where id = $1 limit 1',
    [id]
  );
  const row = r0.rows?.[0];
  if (!row) return { error: 'not_found', status: 404 };
  if (String(row.type || '') !== 'onboarding') return { error: 'not_onboarding', status: 400 };
  if (String(row.status || '') !== 'approved') return { error: 'not_approved', status: 400 };
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const emp = payload?.employee && typeof payload.employee === 'object' ? payload.employee : {};
  const stateForId = (await getSharedState()) || {};
  const built = buildOnboardingEmployeeRecordFromPayload(emp, stateForId);
  if (!built.ok) {
    return { error: built.reason, status: 400, message: '审批单中缺少 employee.username，无法补录' };
  }
  await mergeSharedStateFields({ employees: [built.nextEmp] }, { employees: 'username' });
  return {
    ok: true,
    approvalId: row.id,
    username: built.newUsername,
    name: built.empName,
  };
}

export async function returnApproval({
  pool,
  getSharedState,
  saveSharedState,
  stateFindUserRecord,
  addStateNotification,
  makeNotif,
  approvalTypeLabel,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  hrmsNowISO,
  id,
  username,
  note,
}) {
  const r0 = await pool.query(
    'select id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, created_at, updated_at from approval_requests where id = $1 limit 1',
    [id]
  );
  const row = r0.rows?.[0] || null;
  if (!row) return { error: 'not_found', status: 404 };
  if (String(row.status || '') !== 'pending') return { error: 'not_pending', status: 400 };

  const chain = Array.isArray(row.chain) ? row.chain : [];
  const idx = chain.findIndex(
    (x) => String(x?.assignee || '').toLowerCase() === username.toLowerCase()
      && String(x?.status || '') === 'pending'
  );
  if (idx < 0) return { error: 'forbidden', status: 403 };

  const nowIso = hrmsNowISO();
  chain[idx] = { ...chain[idx], status: 'returned', decidedAt: nowIso, note };

  for (let i = 0; i < idx; i++) {
    if (chain[i] && String(chain[i].status || '') === 'approved') {
      chain[i] = { ...chain[i], status: 'queued', decidedAt: null, note: '' };
    }
  }
  for (let i = idx + 1; i < chain.length; i++) {
    if (chain[i]) chain[i] = { ...chain[i], status: 'queued', decidedAt: null, note: '' };
  }

  const updatedPayload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : {};
  updatedPayload.returnedAt = nowIso;
  updatedPayload.returnedBy = username;
  updatedPayload.returnNote = note;

  const r1 = await pool.query(
    `update approval_requests
     set status='returned', current_assignee_username=null, chain=$2::jsonb, payload=$3::jsonb, updated_at=now()
     where id=$1
     returning id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at`,
    [id, JSON.stringify(chain), JSON.stringify(updatedPayload)]
  );
  const updated = r1.rows?.[0] || null;

  try {
    const state0 = (await getSharedState()) || {};
    let stateN = state0;
    const applicantUser = String(row.applicant_username || '').trim();
    const applicant = stateFindUserRecord(stateN, applicantUser) || {};
    const applicantName = String(applicant?.name || applicantUser).trim() || applicantUser;
    const returnerRec = stateFindUserRecord(stateN, username) || {};
    const returnerName = String(returnerRec?.name || username).trim() || username;
    const label = approvalTypeLabel(String(row.type || ''));
    const msg = `${applicantName}，你提交的${label}申请被${returnerName}退回${note ? `，原因：${note}` : ''}。请修改后重新提交。`;
    stateN = addStateNotification(
      stateN,
      makeNotif(applicantUser, `${label}申请被退回`, msg, { type: `${row.type}_returned`, approvalId: id })
    );
    await saveSharedState(stateN);

    try {
      const fu = await lookupFeishuUserByUsername(applicantUser);
      if (fu?.open_id) {
        const feishuMsg = `📋 【HRMS 审批退回】\n\n${applicantName}，您的${label}申请被${returnerName}退回${note ? `，原因：${note}` : ''}。\n请修改后重新提交：https://nnyx.cc`;
        await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
      }
    } catch (e) {
      log.error({ msg: 'approval_return_feishu_notify_failed', err: e?.message || String(e) });
    }
  } catch (e) {
    log.error({ msg: 'approval_return_notification_failed', err: e?.message || String(e) });
  }

  return { ok: true, item: updated };
}

export async function resubmitApproval({
  pool,
  getSharedState,
  saveSharedState,
  stateFindUserRecord,
  addStateNotification,
  makeNotif,
  approvalTypeLabel,
  lookupFeishuUserByUsername,
  sendLarkMessage,
  hrmsNowISO,
  safeNumber,
  id,
  username,
  bodyPayload,
}) {
  const body = bodyPayload && typeof bodyPayload === 'object' ? bodyPayload : {};

  const r0 = await pool.query(
    'select id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, created_at, updated_at from approval_requests where id = $1 limit 1',
    [id]
  );
  const row = r0.rows?.[0] || null;
  if (!row) return { error: 'not_found', status: 404 };
  if (String(row.status || '') !== 'returned') return { error: 'not_returned', status: 400 };

  if (String(row.applicant_username || '').toLowerCase() !== username.toLowerCase()) {
    return { error: 'forbidden', status: 403 };
  }

  const updatedPayload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : {};

  if (String(row.type || '') === 'points') {
    const bodyItems = Array.isArray(body?.items) ? body.items : null;
    if (bodyItems && bodyItems.length === 0) {
      return { error: 'empty_items', status: 400, message: '积分条目不能为空' };
    }
    if (bodyItems && bodyItems.length > 0) {
      const state = (await getSharedState()) || {};
      const rules = Array.isArray(state?.pointRules) ? state.pointRules : [];
      const applicantRec = stateFindUserRecord(state, username) || {};
      const applicantStore = String(applicantRec?.store || '').trim();
      if (!applicantStore) {
        return { error: 'missing_store', status: 400, message: '缺少门店信息，无法校验积分事项' };
      }
      if (bodyItems.length > 20) {
        return { error: 'too_many_items', status: 400, message: '单次最多申请20条' };
      }
      const validatedItems = [];
      let totalPoints = 0;
      for (let i = 0; i < bodyItems.length; i++) {
        const it = bodyItems[i];
        const rid = String(it?.ruleId || '').trim();
        const rsn = String(it?.reason || '').trim();
        if (!rid) return { error: 'missing_rule', status: 400, message: `第${i + 1}条缺少事项` };
        if (!rsn) return { error: 'missing_reason', status: 400, message: `第${i + 1}条缺少理由` };
        const rule = rules.find((r) => String(r?.id || '').trim() === rid);
        if (!rule) return { error: 'invalid_rule', status: 400, message: `第${i + 1}条事项无效` };
        if (rule?.enabled === false) return { error: 'rule_disabled', status: 400, message: `第${i + 1}条事项已禁用` };
        const ruleStore = String(rule?.store || '').trim();
        if (ruleStore && ruleStore !== applicantStore) {
          return { error: 'rule_store_mismatch', status: 400, message: `第${i + 1}条事项门店不匹配` };
        }
        const rulePoints = safeNumber(rule?.points);
        if (rulePoints == null || rulePoints <= 0) {
          return { error: 'invalid_rule_points', status: 400, message: `第${i + 1}条积分无效` };
        }
        validatedItems.push({
          ruleId: rid,
          itemName: String(rule?.itemName || '').trim() || '积分事项',
          points: rulePoints,
          reason: rsn,
        });
        totalPoints += rulePoints;
      }
      updatedPayload.items = validatedItems;
      updatedPayload.totalPoints = totalPoints;
      updatedPayload.points = totalPoints;
      updatedPayload.itemName = validatedItems.length === 1
        ? validatedItems[0].itemName
        : `${validatedItems.length}项积分申请（共${totalPoints}分）`;
      delete updatedPayload.ruleId;
      delete updatedPayload.reason;
    }
    if (Array.isArray(body?.evidenceUrls)) {
      updatedPayload.evidenceUrls = body.evidenceUrls.map((x) => String(x || '').trim()).filter(Boolean);
    }
  }

  if (String(row.type || '') === 'onboarding') {
    const bodyEmp = body?.employee && typeof body.employee === 'object' ? body.employee : null;
    if (bodyEmp) {
      const existing = updatedPayload.employee && typeof updatedPayload.employee === 'object'
        ? updatedPayload.employee
        : {};
      updatedPayload.employee = { ...existing, ...bodyEmp };
    }
  }
  if (['leave', 'payment', 'offboarding', 'reward_punishment', 'promotion'].includes(String(row.type || ''))) {
    const bodyPatch = body?.patch && typeof body.patch === 'object' ? body.patch : null;
    if (bodyPatch) {
      Object.assign(updatedPayload, bodyPatch);
    }
  }

  const chain = Array.isArray(row.chain) ? row.chain : [];
  for (let i = 0; i < chain.length; i++) {
    chain[i] = { ...chain[i], status: i === 0 ? 'pending' : 'queued', decidedAt: null, note: '' };
  }
  const firstAssignee = chain.length > 0 ? String(chain[0]?.assignee || '').trim() : '';

  updatedPayload.resubmittedAt = hrmsNowISO();
  delete updatedPayload.returnedAt;
  delete updatedPayload.returnedBy;
  delete updatedPayload.returnNote;

  const r1 = await pool.query(
    `update approval_requests
     set status='pending', current_assignee_username=$2, chain=$3::jsonb, payload=$4::jsonb, updated_at=now()
     where id=$1
     returning id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at`,
    [id, firstAssignee || null, JSON.stringify(chain), JSON.stringify(updatedPayload)]
  );
  const updated = r1.rows?.[0] || null;

  try {
    const state0 = (await getSharedState()) || {};
    let stateN = state0;
    const applicantRec = stateFindUserRecord(stateN, username) || {};
    const applicantName = String(applicantRec?.name || username).trim() || username;
    const label = approvalTypeLabel(String(row.type || ''));
    if (firstAssignee) {
      const msg = `${applicantName}重新提交了${label}申请，请审批。`;
      stateN = addStateNotification(
        stateN,
        makeNotif(firstAssignee, `${label}申请待审批`, msg, { type: `${row.type}_resubmitted`, approvalId: id })
      );
      await saveSharedState(stateN);

      try {
        const fu = await lookupFeishuUserByUsername(firstAssignee);
        if (fu?.open_id) {
          const feishuMsg = `📋 【HRMS 审批通知】\n\n${applicantName}重新提交了${label}申请，请审批。\n审批地址：https://nnyx.cc`;
          await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
        }
      } catch (e) {
        log.error({ msg: 'approval_resubmit_feishu_notify_failed', err: e?.message || String(e) });
      }
    }
  } catch (e) {
    log.error({ msg: 'approval_resubmit_notification_failed', err: e?.message || String(e) });
  }

  return { ok: true, item: updated };
}
