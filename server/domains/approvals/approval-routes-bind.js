/**
 * P5.4 peel: approval list/detail/read/delete route bindings from registerApprovalRoutes.
 */
import { canAccessApprovalCenter } from '../../store-duty-bindings.js';
import { approvalTypeLabel } from './normalize-helpers.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'approvals', handler: 'approval-routes' });

export function canUserViewApprovalRow(user, row, state0, pickMyStoreFromState) {
  if (!user || !row) return false;
  const un = String(user.username || '').trim().toLowerCase();
  const role = String(user.role || '').trim();
  const appl = String(row.applicant_username || '').trim().toLowerCase();
  if (appl && appl === un) return true;
  if (
    !canAccessApprovalCenter(role, {
      dutyRows: [],
      currentStore: user.current_store,
      primaryStore: user.primary_store,
    })
  ) {
    return false;
  }
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
    } catch (_e) {
      /* ignore */
    }
  }
  return false;
}

async function decorateApprovalRow(state0, row, stateOrDbFindUserRecord) {
  const applicantRec = await stateOrDbFindUserRecord(state0, row?.applicant_username);
  const assigneeRec = await stateOrDbFindUserRecord(state0, row?.current_assignee_username);
  const chain = Array.isArray(row?.chain) ? row.chain : [];
  const chainDecorated = await Promise.all(
    chain.map(async (step) => {
      const rec = await stateOrDbFindUserRecord(state0, step?.assignee);
      return { ...step, assignee_name: String(rec?.name || step?.assignee || '').trim() };
    })
  );
  return {
    ...row,
    type_label: approvalTypeLabel(row?.type),
    applicant_name: String(applicantRec?.name || row?.applicant_username || '').trim(),
    current_assignee_name: String(assigneeRec?.name || row?.current_assignee_username || '').trim(),
    chain: chainDecorated,
  };
}

export function bindApprovalListRoute(app, authRequired, deps) {
  const {
    pool,
    getSharedState,
    stateOrDbFindUserRecord,
    pickMyStoreFromState,
    normalizeApprovalType,
    safeDateOnly,
  } = deps;

  app.get('/api/approvals', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const _viewQ = String(req.query?.view || 'assigned').trim();
    const _isEmployeeRole =
      role === 'store_employee' || role === 'employee' || role === 'front_manager' || role === 'front_supervisor';
    if (
      !(_isEmployeeRole && _viewQ === 'created') &&
      !canAccessApprovalCenter(role, {
        dutyRows: [],
        currentStore: req.user?.current_store,
        primaryStore: req.user?.primary_store,
      })
    ) {
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
      const canSeeAll = role === 'admin' || role === 'hq_manager' || role === 'cashier';
      const hrManagerRewardAll = role === 'hr_manager' && type === 'reward_punishment';
      const storeManagerPaymentAll = role === 'store_manager' && type === 'payment';
      if (!(canSeeAll || hrManagerRewardAll || storeManagerPaymentAll)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const clauses = [];
    const params = [];
    params.push(req.tenantId || req.user?.tenant_id || 'default');
    clauses.push(`tenant_id = $${params.length}`);
    if (view === 'assigned') {
      params.push(username);
      clauses.push(
        `(lower(current_assignee_username) = lower($${params.length}) OR (status = 'pending' AND EXISTS (SELECT 1 FROM jsonb_array_elements(chain) elem WHERE lower(elem->>'assignee') = lower($${params.length}) AND elem->>'status' = 'pending')))`
      );
    } else if (view === 'created') {
      params.push(username);
      clauses.push(`lower(applicant_username) = lower($${params.length})`);
    } else if (view === 'approved') {
      params.push(username);
      clauses.push(
        `EXISTS (SELECT 1 FROM jsonb_array_elements(chain) elem WHERE lower(elem->>'assignee') = lower($${params.length}) AND elem->>'status' IN ('approved','rejected'))`
      );
    }

    if (type) {
      params.push(type);
      clauses.push(`type = $${params.length}`);
    }

    {
      let store = storeQ;
      if (role === 'store_manager' && type === 'payment') {
        let resolved = '';
        try {
          resolved = pickMyStoreFromState((await getSharedState()) || {}, username) || '';
        } catch (_e) {
          /* ignore */
        }
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
      clauses.push(
        `EXISTS (SELECT 1 FROM jsonb_array_elements(chain) elem WHERE lower(elem->>'assignee') = lower($${params.length}))`
      );
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
      clauses.push(
        `(lower(coalesce(applicant_username, '')) like $${params.length} or lower(coalesce(current_assignee_username, '')) like $${params.length} or lower(coalesce(payload::text, '')) like $${params.length})`
      );
    }
    params.push(limit);

    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';

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
      let filteredRows = r.rows || [];
      if ((view === 'assigned' || view === 'approved') && role === 'store_production_manager') {
        filteredRows = filteredRows.filter((row) => String(row.type || '') !== 'points');
      }
      const items = await Promise.all(
        filteredRows.map((row) => decorateApprovalRow(state0, row, stateOrDbFindUserRecord))
      );
      return res.json({ items });
    } catch (_e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}

export function bindApprovalDetailRoute(app, authRequired, deps) {
  const { pool, getSharedState, stateOrDbFindUserRecord, pickMyStoreFromState } = deps;

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
      const item = await decorateApprovalRow(state0, row, stateOrDbFindUserRecord);
      return res.json({ item });
    } catch (_e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}

export function bindApprovalReadRoute(app, authRequired, deps) {
  const { pool } = deps;

  app.post('/api/approvals/:id/read', authRequired, async (req, res) => {
    if (
      !canAccessApprovalCenter(req.user?.role, {
        dutyRows: [],
        currentStore: req.user?.current_store,
        primaryStore: req.user?.primary_store,
      })
    ) {
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
         on conflict (username, module, item_key, tenant_id) do update set read_at = excluded.read_at`,
        [username, 'approval', id]
      );
      return res.json({ ok: true });
    } catch (_e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}

export function bindApprovalDeleteRoute(app, authRequired, deps) {
  const { pool, scheduleLeaveDomainSync } = deps;

  app.delete('/api/approvals/:id', authRequired, async (req, res) => {
    if (
      !canAccessApprovalCenter(req.user?.role, {
        dutyRows: [],
        currentStore: req.user?.current_store,
        primaryStore: req.user?.primary_store,
      })
    ) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
    const id = String(req.params?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'missing_id' });
    try {
      const r = await pool.query(
        'delete from approval_requests where id = $1 returning id, type, applicant_username',
        [id]
      );
      if (!r.rows?.length) return res.status(404).json({ error: 'not_found' });
      const deleted = r.rows[0];

      if (String(deleted.type || '').trim().toLowerCase() === 'leave') {
        let deletedLeaveRecordIds = [];
        try {
          const dlr = await pool.query('delete from hrms_leave_records where approval_id = $1 returning id', [id]);
          deletedLeaveRecordIds = (dlr.rows || []).map((row) => String(row.id));
        } catch (e2) {
          log.error({
            msg: 'delete_approval_cascade_leave_records_failed',
            err: e2?.message || String(e2),
          });
        }

        try {
          const tenantIdQ = req.tenantId || req.user?.tenant_id || 'default';
          const sr = await pool.query('select data from hrms_state where key = $1 limit 1', [tenantIdQ]);
          const sd = sr.rows?.[0]?.data;
          if (sd && Array.isArray(sd.leaveRecords)) {
            const before = sd.leaveRecords.length;
            sd.leaveRecords = sd.leaveRecords.filter((lr) => {
              if (String(lr.approvalId || '') === id) return false;
              if (deletedLeaveRecordIds.includes(String(lr.id || ''))) return false;
              return true;
            });
            if (sd.leaveRecords.length < before) {
              await pool.query('update hrms_state set data = $1 where key = $2', [sd, tenantIdQ]);
            }
          }
        } catch (e3) {
          log.error({
            msg: 'delete_approval_cascade_state_leave_records_failed',
            err: e3?.message || String(e3),
          });
        }

        try {
          scheduleLeaveDomainSync();
        } catch (_) {
          /* ignore */
        }
      }

      return res.json({ ok: true, deleted });
    } catch (_e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
