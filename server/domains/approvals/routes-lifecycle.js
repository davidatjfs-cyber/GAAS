/**
 * 审批生命周期路由（Wave 4c：create / return / resubmit + repair-onboarding）。
 * 行为保持：从 index.js 原样迁出；通过 deps 注入 index 闭包符号，禁止反向 import index。
 */
import { canAccessApprovalCenter } from '../../store-duty-bindings.js';
import {
  buildConfiguredApprovalAssignees,
  resolveStoreApprovalRoleUsername,
} from '../../approval-assignee-resolution.js';
import { getPromotionTrackProgress, getCrossTrackTechnicianStatus } from '../../training.js';
import { resolveTenantIdDefault } from '../../utils/database.js';
import {
  bindOnboardingPayloadDeps,
  buildOnboardingEmployeeRecordFromPayload,
} from './onboarding-payload.js';

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
     // 'points' has its own role check inside; 'offboarding' allows self-service resignation
     // 前厅经理可发起请款申请（仅 payment，本人为申请人，审批链照常 门店店长→徐彬→李艳玲）
     const _frontManagerPaymentCreate = approvalType === 'payment'
       && normalizeRoleForJwt(String(req.user?.role || '')) === 'front_manager';
     // 员工本人自助发起的审批类型（申请人恒为登录者本人，见下方 insert 的 applicant_username=username），
     // 无需「审批中心」权限：离职(offboarding)、积分(points)、休假(leave)、晋升(promotion)。
     // 否则普通员工(store_employee)会被 canAccessApprovalCenter 拦截，提交即 403——
     // 休假/升职申请此前一直无法提交即此根因（仅 offboarding/points 被豁免，漏了 leave/promotion）。
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

    try {
      if (type === 'onboarding') {
        const empUser = String((payload?.employee?.username) || '').trim().toLowerCase();
        if (empUser) {
          const existing = await pool.query(
            `select id from approval_requests where type = 'onboarding' and status = 'pending' and lower(payload->'employee'->>'username') = $1 and tenant_id = $2 limit 1`,
            [empUser, req.tenantId || req.user?.tenant_id || 'default']
          );
          if ((existing.rows || []).length) {
            return res.status(409).json({ error: 'duplicate_pending', id: existing.rows[0].id });
          }
        }
      } else if (type !== 'payment' && type !== 'points' && type !== 'reward_punishment') {
        const existing = await pool.query(
          'select id from approval_requests where lower(applicant_username) = lower($1) and type = $2 and status = $3 and tenant_id = $4 limit 1',
          [username, type, 'pending', req.tenantId || req.user?.tenant_id || 'default']
        );
        if ((existing.rows || []).length) {
          return res.status(409).json({ error: 'duplicate_pending', id: existing.rows[0].id });
        }
      }

      let state = (await getSharedState()) || {};
      const applicant = stateFindUserRecord(state, username) || {};
      const applicantManager = String(applicant?.managerUsername || '').trim();
      const adminUsername = await pickAdminUsername(state);
      const hqManagerUsername = await pickHqManagerUsername(state);
      const cashierUsername = await pickCashierUsername(state);
      const hrManagerUsername = await pickHrManagerUsername(state);

      let assignees = [];

      // validations (independent of configured flow)
      if (type === 'onboarding') {
        if (role !== 'store_manager') {
          return res.status(403).json({ error: 'forbidden' });
        }
        if (!applicantManager) {
          return res.status(400).json({ error: 'missing_manager' });
        }
        const emp = payload?.employee && typeof payload.employee === 'object' ? payload.employee : {};
        const newUsername = String(emp?.username || '').trim();
        if (!newUsername) return res.status(400).json({ error: 'missing_employee_username' });
        const joinDate = safeDateOnly(emp?.joinDate || emp?.hireDate || emp?.startDate || emp?.entryDate || emp?.onboardDate || emp?.joiningDate);
        if (!joinDate) return res.status(400).json({ error: 'missing_join_date' });
        payload.employee = { ...emp, joinDate };
        const exists = stateFindUserRecord(state, newUsername);
        if (exists) return res.status(400).json({ error: 'employee_username_exists' });
      } else if (type === 'offboarding') {
        if (!applicantManager) {
          return res.status(400).json({ error: 'missing_manager' });
        }
        const applicantFull = (await stateOrDbFindUserRecord(state, username)) || applicant || {};
        const appStore = String(payload.store || applicantFull.store || '').trim();
        if (appStore) payload.store = appStore;
        payload.applicantName = String(applicantFull.name || payload.name || payload.applicantName || '').trim() || username;
        payload.applicantPosition = String(applicantFull.position || payload.applicantPosition || payload.position || '').trim() || '';
        payload.applicantDepartment = String(applicantFull.department || payload.applicantDepartment || '').trim() || '';
        payload.applicantLevel = String(applicantFull.level || payload.applicantLevel || '').trim() || '';
        const join0 = safeDateOnly(
          applicantFull.joinDate || applicantFull.hireDate || applicantFull.startDate
          || payload.applicantJoinDate || payload.joinDate || payload.hireDate || payload.entryDate
        );
        if (join0) payload.applicantJoinDate = join0;
      } else if (type === 'leave') {
        if (!applicantManager) {
          return res.status(400).json({ error: 'missing_manager' });
        }
        const startDate = safeDateOnly(payload?.startDate || payload?.fromDate || payload?.beginDate);
        const endDate = safeDateOnly(payload?.endDate || payload?.toDate || payload?.finishDate);
        if (!startDate || !endDate) {
          return res.status(400).json({ error: 'missing_leave_date' });
        }
      } else if (type === 'promotion') {
        if (!applicantManager) {
          return res.status(400).json({ error: 'missing_manager' });
        }
        const stage = String(payload?.promotionStage || 'qualification').trim().toLowerCase();
        if (!['qualification', 'formal'].includes(stage)) {
          return res.status(400).json({ error: 'invalid_promotion_stage' });
        }
        const reason = String(payload?.reason || '').trim();
        if (!reason) return res.status(400).json({ error: 'missing_reason' });
        payload.promotionStage = stage;
        if (stage === 'formal') {
          const trackId = String(payload?.promotionTrackId || '').trim();
          if (!trackId) return res.status(400).json({ error: 'missing_promotion_track' });
          const tracks = Array.isArray(state?.promotionTracks) ? state.promotionTracks : [];
          const track = tracks.find(t => String(t?.id || '').trim() === trackId && String(t?.applicantUsername || '').trim().toLowerCase() === username.toLowerCase());
          if (!track) return res.status(400).json({ error: 'invalid_promotion_track' });
          // 唯一渠道：考核结果由系统根据培训认证进度自动判定，去掉人工考核环节
          if (Array.isArray(track?.requiredTopicIds)) {
            const progress = await getPromotionTrackProgress(track.applicantUsername, track.requiredTopicIds);
            if (!progress.passed) return res.status(400).json({ error: 'track_not_passed' });
          } else if (String(track?.assessmentStatus || '').trim() !== 'passed') {
            return res.status(400).json({ error: 'track_not_passed' });
          }
        } else if (stage === 'qualification') {
          // 储备厨师长资格申请前提：须在任一专业线(炒锅/砧板/烧味卤水/刺身)达最高技师级，且第二条线达L2
          const targetPosition = String(payload?.targetPosition || payload?.newPosition || '').trim();
          const targetLevel = String(payload?.targetLevel || payload?.newLevel || '').trim();
          if (targetPosition === '出品经理' && targetLevel === '储备') {
            const crossTrack = await getCrossTrackTechnicianStatus(username);
            if (!crossTrack.eligible) {
              return res.status(400).json({ error: 'cross_track_prerequisite_not_met' });
            }
          }
        }
      } else {
        if (type === 'payment') {
          if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager' || role === 'cashier' || role === 'front_manager')) {
            return res.status(403).json({ error: 'forbidden' });
          }

          const store = String(payload?.store || '').trim();
          const date = safeDateOnly(payload?.date || payload?.applyDate || payload?.requestDate);
          const amount = safeNumber(payload?.amount);
          const category = String(payload?.category || payload?.project || '').trim();
          if (!store) return res.status(400).json({ error: 'missing_store' });
          // 前厅经理仅可为本人所属门店请款，禁止跨店请款（服务端强校验，防止前端被绕过）
          if (role === 'front_manager') {
            const ownStore = String(applicant?.store || '').trim();
            const allowed = Array.isArray(req.user?.allowed_stores)
              ? req.user.allowed_stores.map(s => String(s || '').trim()).filter(Boolean)
              : [];
            const allowedSet = new Set([ownStore, ...allowed].filter(Boolean));
            if (allowedSet.size && !allowedSet.has(store)) {
              return res.status(403).json({ error: 'store_not_allowed' });
            }
          }
          if (!date) return res.status(400).json({ error: 'missing_date' });
          if (amount == null || amount <= 0) return res.status(400).json({ error: 'missing_amount' });
          if (!category) return res.status(400).json({ error: 'missing_category' });
          // 请款历史上被排除在 duplicate_pending 之外，连点/重复请求会产生多笔「内容相同」的待审单
          try {
            const dupPay = await pool.query(
              `SELECT id FROM approval_requests
               WHERE type = 'payment' AND status = 'pending'
                 AND lower(applicant_username) = lower($1)
                 AND trim(both from coalesce(payload->>'store','')) = trim(both from $2::text)
                 AND left(trim(both from coalesce(payload->>'date', payload->>'applyDate', payload->>'requestDate','')), 10) = $3::text
                 AND (nullif(replace(trim(both from coalesce(payload->>'amount','')), ',', ''), '')::numeric) = $4::numeric
                 AND trim(both from coalesce(payload->>'category', payload->>'project','')) = trim(both from $5::text)
                 AND tenant_id = $6
               LIMIT 1`,
              [username, store, date, amount, category, req.tenantId || req.user?.tenant_id || 'default']
            );
            if ((dupPay.rows || []).length) {
              return res.status(409).json({ error: 'duplicate_pending', id: dupPay.rows[0].id });
            }
          } catch (dupErr) {
            console.warn('[approvals] payment duplicate check failed:', dupErr?.message);
          }
        } else if (type === 'reward_punishment') {
          if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager')) {
            return res.status(403).json({ error: 'forbidden' });
          }
          const targetUsername = String(payload?.targetUsername || payload?.employeeUsername || '').trim();
          const reason = String(payload?.reason || '').trim();
          const result = String(payload?.result || '').trim();
          const amount = safeNumber(payload?.amount);
          if (!targetUsername) return res.status(400).json({ error: 'missing_target' });
          if (!reason) return res.status(400).json({ error: 'missing_reason' });
          if (!result) return res.status(400).json({ error: 'missing_result' });
          if (amount == null || amount <= 0) return res.status(400).json({ error: 'missing_amount' });
          const tgtRec = stateFindUserRecord(state, targetUsername) || {};
          if (!String(payload?.store || '').trim() && String(tgtRec?.store || '').trim()) {
            payload.store = String(tgtRec.store).trim();
          }
          if (recurringFrequencyReward && recurringFrequencyReward !== 'monthly') {
            return res.status(400).json({ error: 'invalid_recurring_frequency' });
          }
          if (recurringFrequencyReward === 'monthly') {
            const rpT0 = String(payload?.rpType || '').trim();
            if (!(rpT0 === '奖励' || rpT0 === 'reward')) {
              return res.status(400).json({ error: 'recurring_reward_only' });
            }
          }
        } else if (type === 'points') {
          if (!(role === 'store_employee' || role === 'employee' || role === 'front_manager' || role === 'front_supervisor' || role === 'store_production_manager')) {
            return res.status(403).json({ error: 'forbidden' });
          }
          if (!applicantManager) {
            return res.status(400).json({ error: 'missing_manager' });
          }
          const applicantStore = String(applicant?.store || '').trim();
          if (!applicantStore) return res.status(400).json({ error: 'missing_store' });

          // Daily submission limit: 1 per day per employee
          // Use CURRENT_DATE (server-side, respects pg timezone) to avoid JS Date timezone mismatch
          try {
            // 同一天「新建」积分单限 1 次；退回后再次激活（resubmit）会在 payload 写入 resubmittedAt，此类记录不计入占用额度，
            // 避免员工修正退回单后当天无法再提交新的积分申请。
            const dupCheck = await pool.query(
              `SELECT id FROM approval_requests
               WHERE type='points'
                 AND lower(applicant_username)=lower($1)
                 AND created_at >= CURRENT_DATE
                 AND status != 'returned'
                 AND (payload->>'resubmittedAt') IS NULL
                 AND tenant_id = $2
               LIMIT 1`,
              [username, req.tenantId || req.user?.tenant_id || 'default']
            );
            if (dupCheck.rows?.length > 0) {
              return res.status(400).json({ error: 'daily_limit', message: '每天只能提交1次积分申请，今天已提交过' });
            }
          } catch (e) { /* ignore check error, allow submission */ }

          const rules = Array.isArray(state?.pointRules) ? state.pointRules : [];
          // Support batch items array OR single ruleId+reason (backward compat)
          const rawItems = Array.isArray(payload?.items) ? payload.items : [];
          if (rawItems.length > 0) {
            // Batch mode
            if (rawItems.length > 20) return res.status(400).json({ error: 'too_many_items', message: '单次最多申请20条' });
            const validatedItems = [];
            let totalPoints = 0;
            for (let i = 0; i < rawItems.length; i++) {
              const it = rawItems[i];
              const rid = String(it?.ruleId || '').trim();
              const rsn = String(it?.reason || '').trim();
              if (!rid) return res.status(400).json({ error: 'missing_rule', message: `第${i + 1}条缺少事项` });
              if (!rsn) return res.status(400).json({ error: 'missing_reason', message: `第${i + 1}条缺少理由` });
              const rule = rules.find(r => String(r?.id || '').trim() === rid);
              if (!rule) return res.status(400).json({ error: 'invalid_rule', message: `第${i + 1}条事项无效` });
              if (rule?.enabled === false) return res.status(400).json({ error: 'rule_disabled', message: `第${i + 1}条事项已禁用` });
              const ruleStore = String(rule?.store || '').trim();
              if (ruleStore && ruleStore !== applicantStore) return res.status(400).json({ error: 'rule_store_mismatch', message: `第${i + 1}条事项门店不匹配` });
              const rulePoints = safeNumber(rule?.points);
              if (rulePoints == null || rulePoints <= 0) return res.status(400).json({ error: 'invalid_rule_points', message: `第${i + 1}条积分无效` });
              validatedItems.push({ ruleId: rid, itemName: String(rule?.itemName || '').trim() || '积分事项', points: rulePoints, reason: rsn });
              totalPoints += rulePoints;
            }
            payload.items = validatedItems;
            payload.totalPoints = totalPoints;
            payload.points = totalPoints;
            payload.itemName = validatedItems.length === 1 ? validatedItems[0].itemName : `${validatedItems.length}项积分申请（共${totalPoints}分）`;
          } else {
            // Single item mode (backward compat)
            const ruleId = String(payload?.ruleId || '').trim();
            const reason = String(payload?.reason || '').trim();
            if (!ruleId) return res.status(400).json({ error: 'missing_rule' });
            if (!reason) return res.status(400).json({ error: 'missing_reason' });
            const rule = rules.find(r => String(r?.id || '').trim() === ruleId);
            if (!rule) return res.status(400).json({ error: 'invalid_rule' });
            if (rule?.enabled === false) return res.status(400).json({ error: 'rule_disabled' });
            const ruleStore = String(rule?.store || '').trim();
            if (ruleStore && ruleStore !== applicantStore) return res.status(400).json({ error: 'rule_store_mismatch' });
            const rulePoints = safeNumber(rule?.points);
            if (rulePoints == null || rulePoints <= 0) return res.status(400).json({ error: 'invalid_rule_points' });
            payload.itemName = String(rule?.itemName || payload?.itemName || '').trim() || '积分事项';
            payload.points = rulePoints;
            payload.ruleId = ruleId;
          }
          payload.store = applicantStore;
          payload.applicantName = String(applicant?.name || '').trim() || username;
          payload.applicantPosition = String(applicant?.position || '').trim() || '';
          payload.applicantDepartment = String(applicant?.department || '').trim() || '';
          payload.applicantLevel = String(applicant?.level || '').trim() || '';
          payload.evidenceUrls = Array.isArray(payload?.evidenceUrls) ? payload.evidenceUrls.map(x => String(x || '').trim()).filter(Boolean) : [];
        } else if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'store_manager' || role === 'cashier')) {
          return res.status(403).json({ error: 'forbidden' });
        }
        if (!adminUsername) return res.status(500).json({ error: 'missing_admin' });
      }

      // try configured flow first
      const applicantStore = String(applicant?.store || payload?.store || '').trim();
      const ctx = {
        state,
        applicantUsername: username,
        applicantStore,
        managerUsername: applicantManager,
        adminUsername,
        hqManagerUsername,
        hrManagerUsername,
        cashierUsername
      };
      const applicantRole = String(applicant?.role || role || '').trim().toLowerCase();
      const applicantStoreLower = String(applicant?.store || '').trim().toLowerCase();
      const isHeadquarterApplicant =
        applicantRole === 'admin'
        || applicantRole === 'hq_manager'
        || applicantRole === 'hr_manager'
        || applicantRole === 'cashier'
        || applicantRole.startsWith('custom_')
        || (applicantStoreLower.includes('总部') || applicantStoreLower.includes('headquarter') || applicantStoreLower.includes('hq'));

      if (type === 'payment') {
        // Priority: approvalFlows.payment config (流程设置) > paymentFlowByStore > default
        const configured = await buildConfiguredApprovalAssignees(state, type, ctx, resolveDutyApproverForStore);
        if (configured.length) {
          assignees = configured;
        } else {
          const store = String(payload?.store || '').trim();
          const flow = getPaymentFlowForStore(state, store);
          if (flow.approvers.length) {
            assignees = flow.approvers;
          } else {
            assignees = [applicantManager, cashierUsername, adminUsername].filter(Boolean);
          }
        }
      } else if (type === 'leave') {
        // 休假审批按人员归属固定：
        // 门店员工：直属上级 → 总部营运 → 总部人事
        // 总部人员：直属上级 → 总部人事
        assignees = isHeadquarterApplicant
          ? [applicantManager, hrManagerUsername].filter(Boolean)
          : [applicantManager, hqManagerUsername, hrManagerUsername].filter(Boolean);
      } else if (type === 'promotion') {
        const stage = String(payload?.promotionStage || 'qualification').trim().toLowerCase();
        if (stage === 'qualification') {
          const applicantPosition = String(applicant?.position || payload?.currentPosition || '').trim();
          const applicantDepartment = String(applicant?.department || payload?.department || '').trim();
          const kitchenApplicant = isKitchenByRoleOrPosition(applicantRole, applicantPosition, applicantDepartment);
          const applicantStoreName = String(applicant?.store || payload?.store || '').trim();
          const storeManagerByStore = await resolveStoreApprovalRoleUsername(
            state,
            applicantStoreName,
            ['store_manager'],
            resolveDutyApproverForStore
          );
          const productionManagerByStore = pickStoreRoleUsernameByStore(state, applicantStoreName, ['store_production_manager']);
          if (kitchenApplicant) {
            // 后厨：出品经理 → 店长
            assignees = [productionManagerByStore, storeManagerByStore].filter(Boolean);
          } else {
            // 前厅：店长
            assignees = [storeManagerByStore].filter(Boolean);
          }
        } else {
          // 正式晋升：店长 → 总部营运 → 人事经理
          const applicantStoreName = String(applicant?.store || payload?.store || '').trim();
          const storeManagerByStore = await resolveStoreApprovalRoleUsername(
            state,
            applicantStoreName,
            ['store_manager'],
            resolveDutyApproverForStore
          );
          assignees = [storeManagerByStore, hqManagerUsername, hrManagerUsername].filter(Boolean);
        }
      } else {
        const configured = await buildConfiguredApprovalAssignees(state, type, ctx, resolveDutyApproverForStore);
        if (configured.length) {
          assignees = configured;
        } else {
          // default fallback per business flow specs
          if (type === 'onboarding') {
            // 入职: 直属上级 → 人事经理 → 管理员
            assignees = [applicantManager, hrManagerUsername, adminUsername].filter(Boolean);
          } else if (type === 'offboarding') {
            // 离职: 直属上级 → 总部营运 → 人事经理
            assignees = [applicantManager, hqManagerUsername, hrManagerUsername].filter(Boolean);
          } else if (type === 'reward_punishment') {
            // 奖惩: 直属上级 → 人事经理
            assignees = [applicantManager, hrManagerUsername].filter(Boolean);
          } else if (type === 'points') {
            // 积分: 门店店长 → 总部营运 → 人事经理（仅店长可见）
            // 门店无在岗店长时（如监管兼管的门店），回退到职责绑定中 can_approve_hrms 的负责人
            const storeManagerForPoints = await resolveStoreApprovalRoleUsername(
              state,
              applicantStore,
              ['store_manager'],
              resolveDutyApproverForStore
            );
            assignees = [storeManagerForPoints, hqManagerUsername, hrManagerUsername].filter(Boolean);
          } else {
            assignees = [applicantManager, adminUsername].filter(Boolean);
          }
        }
      }

      const seen = new Set();
      const uniq = [];
      (assignees || []).forEach(a => {
        const k = String(a || '').trim().toLowerCase();
        if (!k || seen.has(k)) return;
        seen.add(k);
        uniq.push(String(a || '').trim());
      });
      if (!uniq.length) return res.status(400).json({ error: 'missing_assignee' });

      const chain = uniq.map((a, idx) => ({
        step: idx + 1,
        assignee: a,
        status: idx === 0 ? 'pending' : 'queued',
        decidedAt: null,
        note: ''
      }));

      const currentAssignee = chain[0]?.assignee || null;

      const r = await pool.query(
        `insert into approval_requests (type, status, applicant_username, current_assignee_username, chain, payload, tenant_id, created_at, updated_at)
         values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7, now(), now())
         returning id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at`,
        [type, 'pending', username, currentAssignee, JSON.stringify(chain), JSON.stringify(payload), req.tenantId || req.user?.tenant_id || 'default']
      );
      const item = r.rows?.[0] || null;

      // 正式晋升申请提交后，标记资格记录已进入正式晋升流程
      try {
        if (item && type === 'promotion') {
          const stage = String(payload?.promotionStage || '').trim().toLowerCase();
          const trackId = String(payload?.promotionTrackId || '').trim();
          if (stage === 'formal' && trackId) {
            const tracks = Array.isArray(state?.promotionTracks) ? state.promotionTracks.slice() : [];
            const idxTrack = tracks.findIndex(t => String(t?.id || '').trim() === trackId);
            if (idxTrack >= 0) {
              tracks[idxTrack] = {
                ...tracks[idxTrack],
                formalApplied: true,
                formalApprovalId: String(item?.id || ''),
                updatedAt: hrmsNowISO()
              };
              state = { ...state, promotionTracks: tracks };
              await saveSharedState(state);
            }
          }
        }
      } catch (e) { /* ignore */ }

      try {
        if (item) {
          let _nextState = state;
          const label = approvalTypeLabel(type);
          const title = `${label}申请待审批`;
          const applicantName = String(applicant?.name || username).trim() || username;

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

          const recipients = uniqUsernames([currentAssignee]);
          const notifs = recipients.map((u) =>
            makeNotif(u, title, msg, { type: `${type}_request`, approvalId: item.id })
          );
          await appendNotifications(notifs);

          // 飞书通知：异步通知第一个审批人
          (async () => {
            try {
              if (currentAssignee) {
                const fu = await lookupFeishuUserByUsername(currentAssignee);
                if (fu?.open_id) {
                  const feishuMsg = `📋 【HRMS 待审批提醒】\n\n${msg}\n\n请登录 HRMS 系统处理：https://nnyx.cc`;
                  await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
                }
              }
            } catch (feishuErr) {
              console.error('[approval] feishu notify error:', feishuErr?.message);
            }
          })();
        }
      } catch (e) { /* ignore */ }

      if (type === 'reward_punishment' && recurringFrequencyReward === 'monthly' && item?.id) {
        const rpT = String(payload?.rpType || '').trim();
        if (rpT === '奖励' || rpT === 'reward') {
          try {
            const ymSh = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
            const snap = JSON.parse(JSON.stringify(payload));
            await pool.query(
              `insert into recurring_reward_templates (active, created_by, frequency, payload, last_generated_ym, updated_at, tenant_id)
               values (true, $1, 'monthly', $2::jsonb, $3, now(), $4)`,
              [username, JSON.stringify(snap), ymSh, resolveTenantIdDefault()]
            );
            console.log('[recurring-reward] saved monthly template for applicant', username);
          } catch (re) {
            console.error('[recurring-reward] save template failed:', re?.message || re);
          }
        }
      }

      return res.json({ item, label: approvalTypeLabel(type) });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/admin/repair-onboarding-employee/:id', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!(role === 'admin' || role === 'hr_manager' || role === 'hq_manager')) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const r0 = await pool.query(
        'select id, type, status, payload from approval_requests where id = $1 limit 1',
        [id]
      );
      const row = r0.rows?.[0];
      if (!row) return res.status(404).json({ error: 'not_found' });
      if (String(row.type || '') !== 'onboarding') return res.status(400).json({ error: 'not_onboarding' });
      if (String(row.status || '') !== 'approved') return res.status(400).json({ error: 'not_approved' });
      const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
      const emp = payload?.employee && typeof payload.employee === 'object' ? payload.employee : {};
      const stateForId = (await getSharedState()) || {};
      const built = buildOnboardingEmployeeRecordFromPayload(emp, stateForId);
      if (!built.ok) return res.status(400).json({ error: built.reason, message: '审批单中缺少 employee.username，无法补录' });
      await mergeSharedStateFields({ employees: [built.nextEmp] }, { employees: 'username' });
      return res.json({
        ok: true,
        approvalId: row.id,
        username: built.newUsername,
        name: built.empName
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
      const r0 = await pool.query(
        'select id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, created_at, updated_at from approval_requests where id = $1 limit 1',
        [id]
      );
      const row = r0.rows?.[0] || null;
      if (!row) return res.status(404).json({ error: 'not_found' });
      if (String(row.status || '') !== 'pending') return res.status(400).json({ error: 'not_pending' });

      // Verify the current user is in the approval chain and is a pending assignee
      const chain = Array.isArray(row.chain) ? row.chain : [];
      const idx = chain.findIndex(x => String(x?.assignee || '').toLowerCase() === username.toLowerCase() && String(x?.status || '') === 'pending');
      if (idx < 0) return res.status(403).json({ error: 'forbidden' });

      const nowIso = hrmsNowISO();
      // Mark the current step as returned
      chain[idx] = { ...chain[idx], status: 'returned', decidedAt: nowIso, note };

      // Reset all previous approved steps back to queued so the chain restarts on resubmit
      for (let i = 0; i < idx; i++) {
        if (chain[i] && String(chain[i].status || '') === 'approved') {
          chain[i] = { ...chain[i], status: 'queued', decidedAt: null, note: '' };
        }
      }
      // Reset any remaining queued steps
      for (let i = idx + 1; i < chain.length; i++) {
        if (chain[i]) chain[i] = { ...chain[i], status: 'queued', decidedAt: null, note: '' };
      }

      // Save the returned payload with return metadata
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

      // Notify applicant that the request was returned
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
        stateN = addStateNotification(stateN, makeNotif(applicantUser, `${label}申请被退回`, msg, { type: `${row.type}_returned`, approvalId: id }));
        await saveSharedState(stateN);

        // 飞书通知申请人
        try {
          const fu = await lookupFeishuUserByUsername(applicantUser);
          if (fu?.open_id) {
            const feishuMsg = `📋 【HRMS 审批退回】\n\n${applicantName}，您的${label}申请被${returnerName}退回${note ? `，原因：${note}` : ''}。\n请修改后重新提交：https://nnyx.cc`;
            await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
          }
        } catch (e) { console.error('[approval-return] feishu notify error:', e?.message); }
      } catch (e) { console.error('[approval-return] notification error:', e?.message); }

      return res.json({ item: updated });
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
      const r0 = await pool.query(
        'select id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, created_at, updated_at from approval_requests where id = $1 limit 1',
        [id]
      );
      const row = r0.rows?.[0] || null;
      if (!row) return res.status(404).json({ error: 'not_found' });
      if (String(row.status || '') !== 'returned') return res.status(400).json({ error: 'not_returned' });

      // Only the original applicant can resubmit
      if (String(row.applicant_username || '').toLowerCase() !== username.toLowerCase()) {
        return res.status(403).json({ error: 'forbidden' });
      }

      const updatedPayload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : {};

      // 积分退回后重新提交：允许随请求更新 items（理由等），校验规则与新建申请一致
      if (String(row.type || '') === 'points') {
        const bodyItems = Array.isArray(req.body?.items) ? req.body.items : null;
        if (bodyItems && bodyItems.length === 0) {
          return res.status(400).json({ error: 'empty_items', message: '积分条目不能为空' });
        }
        if (bodyItems && bodyItems.length > 0) {
          const state = (await getSharedState()) || {};
          const rules = Array.isArray(state?.pointRules) ? state.pointRules : [];
          const applicantRec = stateFindUserRecord(state, username) || {};
          const applicantStore = String(applicantRec?.store || '').trim();
          if (!applicantStore) return res.status(400).json({ error: 'missing_store', message: '缺少门店信息，无法校验积分事项' });
          if (bodyItems.length > 20) return res.status(400).json({ error: 'too_many_items', message: '单次最多申请20条' });
          const validatedItems = [];
          let totalPoints = 0;
          for (let i = 0; i < bodyItems.length; i++) {
            const it = bodyItems[i];
            const rid = String(it?.ruleId || '').trim();
            const rsn = String(it?.reason || '').trim();
            if (!rid) return res.status(400).json({ error: 'missing_rule', message: `第${i + 1}条缺少事项` });
            if (!rsn) return res.status(400).json({ error: 'missing_reason', message: `第${i + 1}条缺少理由` });
            const rule = rules.find(r => String(r?.id || '').trim() === rid);
            if (!rule) return res.status(400).json({ error: 'invalid_rule', message: `第${i + 1}条事项无效` });
            if (rule?.enabled === false) return res.status(400).json({ error: 'rule_disabled', message: `第${i + 1}条事项已禁用` });
            const ruleStore = String(rule?.store || '').trim();
            if (ruleStore && ruleStore !== applicantStore) return res.status(400).json({ error: 'rule_store_mismatch', message: `第${i + 1}条事项门店不匹配` });
            const rulePoints = safeNumber(rule?.points);
            if (rulePoints == null || rulePoints <= 0) return res.status(400).json({ error: 'invalid_rule_points', message: `第${i + 1}条积分无效` });
            validatedItems.push({ ruleId: rid, itemName: String(rule?.itemName || '').trim() || '积分事项', points: rulePoints, reason: rsn });
            totalPoints += rulePoints;
          }
          updatedPayload.items = validatedItems;
          updatedPayload.totalPoints = totalPoints;
          updatedPayload.points = totalPoints;
          updatedPayload.itemName = validatedItems.length === 1 ? validatedItems[0].itemName : `${validatedItems.length}项积分申请（共${totalPoints}分）`;
          delete updatedPayload.ruleId;
          delete updatedPayload.reason;
        }
        if (Array.isArray(req.body?.evidenceUrls)) {
          updatedPayload.evidenceUrls = req.body.evidenceUrls.map(x => String(x || '').trim()).filter(Boolean);
        }
      }

      // onboarding: allow updating employee fields on resubmit
      if (String(row.type || '') === 'onboarding') {
        const bodyEmp = req.body?.employee && typeof req.body.employee === 'object' ? req.body.employee : null;
        if (bodyEmp) {
          const existing = updatedPayload.employee && typeof updatedPayload.employee === 'object' ? updatedPayload.employee : {};
          updatedPayload.employee = { ...existing, ...bodyEmp };
        }
      }
      // other types: allow patching top-level payload fields on resubmit
      if (['leave', 'payment', 'offboarding', 'reward_punishment', 'promotion'].includes(String(row.type || ''))) {
        const bodyPatch = req.body?.patch && typeof req.body.patch === 'object' ? req.body.patch : null;
        if (bodyPatch) {
          Object.assign(updatedPayload, bodyPatch);
        }
      }

      // Reset the chain: all steps back to pending/queued, first step becomes pending
      const chain = Array.isArray(row.chain) ? row.chain : [];
      for (let i = 0; i < chain.length; i++) {
        chain[i] = { ...chain[i], status: i === 0 ? 'pending' : 'queued', decidedAt: null, note: '' };
      }
      const firstAssignee = chain.length > 0 ? String(chain[0]?.assignee || '').trim() : '';

      // Clean up return metadata from payload
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

      // Notify the first assignee about the resubmission
      try {
        const state0 = (await getSharedState()) || {};
        let stateN = state0;
        const applicantRec = stateFindUserRecord(stateN, username) || {};
        const applicantName = String(applicantRec?.name || username).trim() || username;
        const label = approvalTypeLabel(String(row.type || ''));
        if (firstAssignee) {
          const msg = `${applicantName}重新提交了${label}申请，请审批。`;
          stateN = addStateNotification(stateN, makeNotif(firstAssignee, `${label}申请待审批`, msg, { type: `${row.type}_resubmitted`, approvalId: id }));
          await saveSharedState(stateN);

          // 飞书通知审批人
          try {
            const fu = await lookupFeishuUserByUsername(firstAssignee);
            if (fu?.open_id) {
              const feishuMsg = `📋 【HRMS 审批通知】\n\n${applicantName}重新提交了${label}申请，请审批。\n审批地址：https://nnyx.cc`;
              await sendLarkMessage(fu.open_id, feishuMsg, { skipDedup: true });
            }
          } catch (e) { console.error('[approval-resubmit] feishu notify error:', e?.message); }
        }
      } catch (e) { console.error('[approval-resubmit] notification error:', e?.message); }

      return res.json({ item: updated });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
