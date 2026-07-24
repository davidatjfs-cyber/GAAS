/**
 * 审批生命周期路由（Wave 4c：create / return / resubmit + repair-onboarding）。
 * 行为保持：从 index.js 原样迁出；通过 deps 注入 index 闭包符号，禁止反向 import index。
 */
import { canAccessApprovalCenter } from '../../store-duty-bindings.js';
import {
  bindOnboardingPayloadDeps,
  buildOnboardingEmployeeRecordFromPayload,
} from './onboarding-payload.js';
import { createApproval } from './service-create.js';
import {
  repairOnboardingEmployee,
  returnApproval,
  resubmitApproval,
} from './service-lifecycle.js';

/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {object} deps
 */
export function registerApprovalLifecycleRoutes(app, authRequired, deps) {
  const {
    pool,
    getSharedState,
    saveSharedState,
    mergeSharedStateFields,
    hrmsNowISO,
    makeNotif,
    addStateNotification,
    appendNotifications,
    stateFindUserRecord,
    stateOrDbFindUserRecord,
    normalizeApprovalType,
    normalizeRoleForJwt,
    pickAdminUsername,
    pickHqManagerUsername,
    pickCashierUsername,
    pickHrManagerUsername,
    approvalTypeLabel,
    safeDateOnly,
    safeNumber,
    uniqUsernames,
    lookupFeishuUserByUsername,
    sendLarkMessage,
    getPaymentFlowForStore,
    pickStoreRoleUsernameByStore,
    isKitchenByRoleOrPosition,
    resolveDutyApproverForStore,
  } = deps;

  bindOnboardingPayloadDeps({ hrmsNowISO });

  app.post('/api/approvals', authRequired, async (req, res) => {
    const approvalType = normalizeApprovalType(req.body?.type);
    const currentUsername = String(req.user?.username || '').trim().toLowerCase();
    const _frontManagerPaymentCreate = approvalType === 'payment'
      && normalizeRoleForJwt(String(req.user?.role || '')) === 'front_manager';
    const _selfServiceApproval = ['offboarding', 'points', 'leave', 'promotion'].includes(approvalType);
    if (!_selfServiceApproval && !_frontManagerPaymentCreate
        && !canAccessApprovalCenter(req.user?.role, { dutyRows: [], currentStore: req.user?.current_store, primaryStore: req.user?.primary_store })) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (approvalType === 'offboarding' && normalizeRoleForJwt(String(req.user?.role || '')) === 'store_employee') {
      const payloadApplicant = String(req.body?.payload?.applicantUsername || req.body?.payload?.username || '').trim().toLowerCase();
      if (payloadApplicant && payloadApplicant !== currentUsername) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const type = normalizeApprovalType(req.body?.type);
    const rawPayload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    const payload = { ...rawPayload };
    let recurringFrequencyReward = '';
    if (type === 'reward_punishment') {
      recurringFrequencyReward = String(payload.recurringFrequency || '').trim().toLowerCase();
      delete payload.recurringFrequency;
    }
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!type) return res.status(400).json({ error: 'invalid_type' });

    const tenantId = req.tenantId || req.user?.tenant_id || 'default';
    const allowedStores = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];

    const result = await createApproval({
      pool,
      getSharedState,
      saveSharedState,
      stateFindUserRecord,
      stateOrDbFindUserRecord,
      pickAdminUsername,
      pickHqManagerUsername,
      pickCashierUsername,
      pickHrManagerUsername,
      approvalTypeLabel,
      safeDateOnly,
      safeNumber,
      uniqUsernames,
      lookupFeishuUserByUsername,
      sendLarkMessage,
      getPaymentFlowForStore,
      pickStoreRoleUsernameByStore,
      isKitchenByRoleOrPosition,
      resolveDutyApproverForStore,
      appendNotifications,
      makeNotif,
      hrmsNowISO,
      username,
      role,
      type,
      payload,
      recurringFrequencyReward,
      tenantId,
      allowedStores,
    });

    if (result.error) {
      const body = { error: result.error };
      if (result.message) body.message = result.message;
      if (result.id) body.id = result.id;
      return res.status(result.status).json(body);
    }
    return res.json({ item: result.item, label: result.label });
  });

  app.post('/api/admin/repair-onboarding-employee/:id', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!(role === 'admin' || role === 'hr_manager' || role === 'hq_manager')) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const result = await repairOnboardingEmployee({
        pool,
        getSharedState,
        mergeSharedStateFields,
        buildOnboardingEmployeeRecordFromPayload,
        id,
      });
      if (result.error) {
        const body = { error: result.error };
        if (result.message) body.message = result.message;
        return res.status(result.status).json(body);
      }
      return res.json({
        ok: true,
        approvalId: result.approvalId,
        username: result.username,
        name: result.name,
      });
    } catch (e) {
      console.error('[admin/repair-onboarding-employee]', e);
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/approvals/:id/return', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const id = String(req.params?.id || '').trim();
    const note = String(req.body?.note || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!id) return res.status(400).json({ error: 'missing_id' });

    try {
      const result = await returnApproval({
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
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json({ item: result.item });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/approvals/:id/resubmit', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const id = String(req.params?.id || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!id) return res.status(400).json({ error: 'missing_id' });

    try {
      const result = await resubmitApproval({
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
        bodyPayload: req.body,
      });
      if (result.error) {
        const body = { error: result.error };
        if (result.message) body.message = result.message;
        return res.status(result.status).json(body);
      }
      return res.json({ item: result.item });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
