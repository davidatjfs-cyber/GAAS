/**
 * 审批模块的简单路由（架构拆分阶段B，第一批：只拆低风险的部分）。
 *
 * create / return / resubmit / repair-onboarding 已拆至 domains/approvals/routes-lifecycle.js（Wave 4c）；
 * decide 在 domains/approvals/（P0-A1）。
 *
 * 依赖注入方式同 auth-routes.js：不从这里import index.js，而是通过 deps 参数接收
 * index.js里那些被广泛复用、不属于审批模块本身的工具函数。
 */
import { canAccessApprovalCenter } from './store-duty-bindings.js';

function canUserViewApprovalRow(user, row, state0, pickMyStoreFromState) {
  if (!user || !row) return false;
  const un = String(user.username || '').trim().toLowerCase();
  const role = String(user.role || '').trim();
  // Applicants can always view their own approval (checked before access-center guard)
  const appl = String(row.applicant_username || '').trim().toLowerCase();
  if (appl && appl === un) return true;
  if (!canAccessApprovalCenter(role, { dutyRows: [], currentStore: user.current_store, primaryStore: user.primary_store })) return false;
  if (['admin', 'hq_manager', 'cashier', 'hr_manager'].includes(role)) return true;
  if (role === 'store_production_manager' && String(row.type || '') === 'points') return false;
  const curr = String(row.current_assignee_username || '').trim().toLowerCase();
  if (curr && curr === un) return true;
  const chain = Array.isArray(row.chain) ? row.chain : [];
  for (const s of chain) {
    if (String(s?.assignee || '').trim().toLowerCase() === un) return true;
  }
  if (role === 'store_manager' && String(row.type || '') === 'points') {
    try {
      const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
      const store = String(p.store || '').trim();
      const myStore = String(pickMyStoreFromState(state0 || {}, user.username) || '').trim();
      if (store && myStore && store === myStore) return true;
    } catch (e) { /* ignore */ }
  }
  return false;
}

export function registerApprovalRoutes(app, authRequired, deps) {
  const {
    pool,
    getSharedState,

    stateOrDbFindUserRecord,
    pickMyStoreFromState,
    normalizeApprovalType,
    safeDateOnly,
    scheduleLeaveDomainSync,
  } = deps;

  app.get('/api/approvals', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const _viewQ = String(req.query?.view || 'assigned').trim();
    const _isEmployeeRole = role === 'store_employee' || role === 'employee' || role === 'front_manager' || role === 'front_supervisor';
    // Employees / front roles can view their own submitted approvals (view=created) for points workflow
    if (!(_isEmployeeRole && _viewQ === 'created') && !canAccessApprovalCenter(role, { dutyRows: [], currentStore: req.user?.current_store, primaryStore: req.user?.primary_store })) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const view = String(req.query?.view || 'assigned').trim();
    const status = String(req.query?.status || '').trim();
    const type = normalizeApprovalType(req.query?.type || '') || '';
    const storeQ = String(req.query?.store || '').trim();
    const approver = String(req.query?.approver || '').trim();
    const dateStart = safeDateOnly(req.query?.dateStart || req.query?.approvedStart);
    const dateEnd = safeDateOnly(req.query?.dateEnd || req.query?.approvedEnd);
    let dateField = String(req.query?.dateField || 'created').trim().toLowerCase();
    if (dateField !== 'created' && dateField !== 'updated') dateField = 'created';
    const searchRaw = String(req.query?.search || '').trim();
    const search = searchRaw.length > 200 ? searchRaw.slice(0, 200) : searchRaw;
    const limit = Math.min(500, Math.max(1, Number(req.query?.limit || 100)));

    const allowedViews = ['assigned', 'created', 'all', 'approved'];
    if (!allowedViews.includes(view)) return res.status(400).json({ error: 'invalid_view' });

    if (view === 'all') {
      const canSeeAll = (role === 'admin' || role === 'hq_manager' || role === 'cashier');
      const hrManagerRewardAll = (role === 'hr_manager' && type === 'reward_punishment');
      const storeManagerPaymentAll = (role === 'store_manager' && type === 'payment');
      if (!(canSeeAll || hrManagerRewardAll || storeManagerPaymentAll)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const clauses = [];
    const params = [];
    {
      params.push(req.tenantId || req.user?.tenant_id || 'default');
      clauses.push(`tenant_id = $${params.length}`);
    }
    if (view === 'assigned') {
      params.push(username);
      clauses.push(`(lower(current_assignee_username) = lower($${params.length}) OR (status = 'pending' AND EXISTS (SELECT 1 FROM jsonb_array_elements(chain) elem WHERE lower(elem->>'assignee') = lower($${params.length}) AND elem->>'status' = 'pending')))`);
    } else if (view === 'created') {
      params.push(username);
      clauses.push(`lower(applicant_username) = lower($${params.length})`);
    } else if (view === 'approved') {
      params.push(username);
      clauses.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(chain) elem WHERE lower(elem->>'assignee') = lower($${params.length}) AND elem->>'status' IN ('approved','rejected'))`);
    }

    if (type) {
      params.push(type);
      clauses.push(`type = $${params.length}`);
    }

    {
      let store = storeQ;
      if (role === 'store_manager' && type === 'payment') {
        // 多店店长：请款按「当前门店」过滤，且必须在可访问门店范围内（防越权查看范围外门店）；
        // 当前门店缺失或越权时回退到主店（在职档案门店）。
        let resolved = '';
        try { resolved = pickMyStoreFromState((await getSharedState()) || { /* ignore */ }, username) || ''; } catch (e) { /* ignore */ }
        const allowed = Array.isArray(req.user?.allowed_stores)
          ? req.user.allowed_stores.map((s) => String(s || '').trim()).filter(Boolean)
          : [];
        const cur = String(req.user?.current_store || '').trim();
        if (cur && (allowed.length === 0 || allowed.includes(cur))) resolved = cur;
        store = resolved;
        if (store) {
          params.push(store);
          clauses.push(`payload->>'store' = $${params.length}`);
        }
      } else if (storeQ) {
        params.push(storeQ);
        clauses.push(`payload->>'store' = $${params.length}`);
      }
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (approver) {
      params.push(approver);
      clauses.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(chain) elem WHERE lower(elem->>'assignee') = lower($${params.length}))`);
    }
    if (dateStart) {
      params.push(dateStart);
      if (dateField === 'updated') {
        clauses.push(`(timezone('Asia/Shanghai', updated_at))::date >= $${params.length}::date`);
      } else {
        clauses.push(`(timezone('Asia/Shanghai', created_at))::date >= $${params.length}::date`);
      }
    }
    if (dateEnd) {
      params.push(dateEnd);
      if (dateField === 'updated') {
        clauses.push(`(timezone('Asia/Shanghai', updated_at))::date <= $${params.length}::date`);
      } else {
        clauses.push(`(timezone('Asia/Shanghai', created_at))::date <= $${params.length}::date`);
      }
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      clauses.push(`(lower(coalesce(applicant_username, '')) like $${params.length} or lower(coalesce(current_assignee_username, '')) like $${params.length} or lower(coalesce(payload::text, '')) like $${params.length})`);
    }
    params.push(limit);

    const where = clauses.length ? ('where ' + clauses.join(' and ')) : '';

    try {
      const r = await pool.query(
        `select id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at
         from approval_requests
         ${where}
         order by created_at desc
         limit $${params.length}`,
        params
      );
      const state0 = (await getSharedState().catch(() => null)) || {};
      const decorate = async (row) => {
        const applicantRec = await stateOrDbFindUserRecord(state0, row?.applicant_username);
        const assigneeRec = await stateOrDbFindUserRecord(state0, row?.current_assignee_username);
        const chain = Array.isArray(row?.chain) ? row.chain : [];
        const chainDecorated = await Promise.all(chain.map(async (step) => {
          const rec = await stateOrDbFindUserRecord(state0, step?.assignee);
          return { ...step, assignee_name: String(rec?.name || step?.assignee || '').trim() };
        }));
        return {
          ...row,
          applicant_name: String(applicantRec?.name || row?.applicant_username || '').trim(),
          current_assignee_name: String(assigneeRec?.name || row?.current_assignee_username || '').trim(),
          chain: chainDecorated
        };
      };
      let filteredRows = r.rows || [];
      if ((view === 'assigned' || view === 'approved') && role === 'store_production_manager') {
        filteredRows = filteredRows.filter(row => String(row.type || '') !== 'points');
      }
      const items = await Promise.all(filteredRows.map(decorate));
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/approvals/:id', authRequired, async (req, res) => {
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const r = await pool.query(
        `select id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at
         from approval_requests where id = $1 limit 1`,
        [id]
      );
      const row = r.rows?.[0];
      if (!row) return res.status(404).json({ error: 'not_found' });
      const state0 = (await getSharedState().catch(() => null)) || {};
      if (!canUserViewApprovalRow(req.user, row, state0, pickMyStoreFromState)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const applicantRec = await stateOrDbFindUserRecord(state0, row?.applicant_username);
      const assigneeRec = await stateOrDbFindUserRecord(state0, row?.current_assignee_username);
      const chain = Array.isArray(row?.chain) ? row.chain : [];
      const chainDecorated = await Promise.all(chain.map(async (step) => {
        const rec = await stateOrDbFindUserRecord(state0, step?.assignee);
        return { ...step, assignee_name: String(rec?.name || step?.assignee || '').trim() };
      }));
      return res.json({
        item: {
          ...row,
          applicant_name: String(applicantRec?.name || row?.applicant_username || '').trim(),
          current_assignee_name: String(assigneeRec?.name || row?.current_assignee_username || '').trim(),
          chain: chainDecorated
        }
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/approvals/:id/read', authRequired, async (req, res) => {
    if (!canAccessApprovalCenter(req.user?.role, { dutyRows: [], currentStore: req.user?.current_store, primaryStore: req.user?.primary_store })) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const username = String(req.user?.username || '').trim();
    const id = String(req.params?.id || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      await pool.query(
        `insert into user_reads (username, module, item_key, read_at)
         values ($1,$2,$3, now())
         on conflict (username, module, item_key) do update set read_at = excluded.read_at`,
        [username, 'approval', id]
      );
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // Admin delete approval record（级联清理休假记录，避免重新申请产生重复）
  app.delete('/api/approvals/:id', authRequired, async (req, res) => {
    if (!canAccessApprovalCenter(req.user?.role, { dutyRows: [], currentStore: req.user?.current_store, primaryStore: req.user?.primary_store })) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const r = await pool.query('delete from approval_requests where id = $1 returning id, type, applicant_username', [id]);
      if (!r.rows?.length) return res.status(404).json({ error: 'not_found' });
      const deleted = r.rows[0];

      if (String(deleted.type || '').trim().toLowerCase() === 'leave') {
        let deletedLeaveRecordIds = [];
        try {
          const dlr = await pool.query('delete from hrms_leave_records where approval_id = $1 returning id', [id]);
          deletedLeaveRecordIds = (dlr.rows || []).map(r => String(r.id));
        } catch (e2) { console.error('[delete approval] cascade hrms_leave_records:', e2?.message); }

        try {
          const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
          const sr = await pool.query("select data from hrms_state where key = $1 limit 1", [tenantIdQ]);
          const sd = sr.rows?.[0]?.data;
          if (sd && Array.isArray(sd.leaveRecords)) {
            const before = sd.leaveRecords.length;
            sd.leaveRecords = sd.leaveRecords.filter(lr => {
              if (String(lr.approvalId || '') === id) return false;
              if (deletedLeaveRecordIds.includes(String(lr.id || ''))) return false;
              return true;
            });
            if (sd.leaveRecords.length < before) {
              await pool.query("update hrms_state set data = $1 where key = $2", [sd, tenantIdQ]);
            }
          }
        } catch (e3) { console.error('[delete approval] cascade state.leaveRecords:', e3?.message); }

        try { scheduleLeaveDomainSync(); } catch (_) { /* ignore */ }
      }

      return res.json({ ok: true, deleted });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // A2：PUT/GET /api/approval-flows 已迁至 domains/flow-config/routes.js（hr_rating_configs 权威）
}
