/**
 * @param {import('express').Express} app
 * @param {(req,res,next)=>void} authRequired
 * @param {{
 *   pool: import('pg').Pool,
 *   getSharedState: ()=>Promise<object|null>,
 *   hrmsNowISO: ()=>string,
 *   safeMonthOnly: (v: unknown)=>string|null,
 *   safeDateOnly: (v: unknown)=>string|null,
 *   safeUuid: (v: unknown)=>string|null,
 *   safeNumber: (v: unknown)=>number|null,
 * }} deps
 */
export function registerPaymentRoutes(app, authRequired, deps) {
  const {
    pool,
    getSharedState,
    hrmsNowISO,
    safeMonthOnly,
    safeDateOnly,
    safeUuid,
    safeNumber,
  } = deps;

  app.get('/api/payments/budget-summary', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });

    const store = String(req.query?.store || '').trim();
    const month = safeMonthOnly(req.query?.month);
    const category = String(req.query?.category || '').trim();
    const excludeId = safeUuid(req.query?.excludeId);

    if (!store || !month || !category) {
      return res.status(400).json({ error: 'missing_params', message: 'store/month/category required' });
    }

    try {
      const state0 = (await getSharedState()) || {};
      const budgets = Array.isArray(state0.paymentBudgets) ? state0.paymentBudgets : [];
      const key = `${store}__${month}__${category}`.toLowerCase();
      const budgetRow = budgets.find(b => {
        const s = String(b?.store || '').trim();
        const m = String(b?.month || '').trim();
        const c = String(b?.category || '').trim();
        if (!s || !m || !c) return false;
        return `${s}__${m}__${c}`.toLowerCase() === key;
      }) || null;

      const budgetAmount = safeNumber(budgetRow?.amount);

      // Find all secondary categories under this primary category
      const ps = state0.paymentSettings || {};
      const secondaryCats = Array.isArray(ps.secondaryCategories) ? ps.secondaryCategories : [];
      const matchingSecondary = secondaryCats
        .filter(s => String(s?.primary || '').trim().toLowerCase() === category.toLowerCase())
        .map(s => String(s?.name || '').trim())
        .filter(Boolean);
      // Include the primary category itself and all its secondary categories for matching
      const allCats = [category, ...matchingSecondary];
      const uniqueCats = [...new Set(allCats.map(c => c.toLowerCase()))];

      // Build parameterized query for category IN list
      const params = [store, month];
      let excludeClause = '';
      if (excludeId) {
        params.push(excludeId);
        excludeClause = ` and id <> $${params.length}`;
      }
      const catPlaceholders = uniqueCats.map((_, i) => `$${params.length + i + 1}`).join(',');
      params.push(...uniqueCats);
      params.push(req.tenantId || req.user?.tenant_id || 'default');
      const tenantClause = ` and tenant_id = $${params.length}`;

      const r = await pool.query(
        `select status, coalesce(sum(nullif(payload->>'amount','')::numeric), 0)::float as amt
       from approval_requests
       where type = 'payment'
         and status in ('pending','approved','paid')
         and (payload->>'store') = $1
         and lower(payload->>'category') in (${catPlaceholders})
         and substring(payload->>'date', 1, 7) = $2
         ${excludeClause}
         ${tenantClause}
       group by status`,
        params
      );

      let usedPending = 0;
      let usedApproved = 0;
      let usedPaid = 0;
      for (const row of (r.rows || [])) {
        const st = String(row?.status || '').trim();
        const amt = safeNumber(row?.amt) || 0;
        if (st === 'pending') usedPending = amt;
        else if (st === 'approved') usedApproved = amt;
        else if (st === 'paid') usedPaid = amt;
      }
      const usedTotal = (usedPending || 0) + (usedApproved || 0) + (usedPaid || 0);
      const remaining = budgetAmount == null ? null : (budgetAmount - usedTotal);

      return res.json({
        store,
        month,
        category,
        budget: budgetAmount == null ? null : budgetAmount,
        usedPending,
        usedApproved,
        usedPaid,
        usedTotal,
        remaining
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/payments/:id/pay', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const id = String(req.params?.id || '').trim();
    const note = String(req.body?.note || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!id) return res.status(400).json({ error: 'missing_id' });
    if (!(role === 'admin' || role === 'hq_manager' || role === 'hr_manager' || role === 'cashier')) return res.status(403).json({ error: 'forbidden' });

    try {
      const r0 = await pool.query(
        'select id, type, status, payload from approval_requests where id = $1 limit 1',
        [id]
      );
      const row = r0.rows?.[0] || null;
      if (!row) return res.status(404).json({ error: 'not_found' });
      if (String(row.type || '') !== 'payment') return res.status(400).json({ error: 'invalid_type' });
      if (String(row.status || '') !== 'approved') return res.status(400).json({ error: 'not_approved' });

      const nowIso = hrmsNowISO();
      const nextPayload = {
        ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
        paidAt: nowIso,
        paidBy: username,
        payNote: note
      };

      const r1 = await pool.query(
        `update approval_requests
       set status = 'paid', payload = $2::jsonb, executed_at = now(), updated_at = now()
       where id = $1
       returning id, type, status, applicant_username, current_assignee_username, chain, payload, effective_date, executed_at, created_at, updated_at`,
        [id, JSON.stringify(nextPayload)]
      );
      return res.json({ item: r1.rows?.[0] || null });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/payments/export', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (role !== 'admin') return res.status(403).json({ error: 'forbidden' });

    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    if (!start || !end) return res.status(400).json({ error: 'missing_date_range' });

    try {
      const r = await pool.query(
        `select id, status, applicant_username, created_at, updated_at, executed_at, payload
       from approval_requests
       where type = 'payment'
         and (payload->>'date') >= $1
         and (payload->>'date') <= $2
         and tenant_id = $3
       order by (payload->>'date') desc, created_at desc`,
        [start, end, req.tenantId || req.user?.tenant_id || 'default']
      );
      const rows = r.rows || [];

      const esc = (v) => {
        const s = String(v == null ? '' : v);
        const out = s.replace(/"/g, '""');
        return '"' + out + '"';
      };
      const headers = ['id', 'date', 'store', 'category', 'amount', 'payee', 'urgency', 'status', 'applicant', 'created_at', 'paid_at', 'paid_by', 'note', 'pay_note'];
      const lines = [headers.join(',')];
      for (const it of rows) {
        const p = it?.payload && typeof it.payload === 'object' ? it.payload : {};
        lines.push([
          esc(it?.id),
          esc(p?.date),
          esc(p?.store),
          esc(p?.category),
          esc(p?.amount),
          esc(p?.payee),
          esc(p?.urgency),
          esc(it?.status),
          esc(it?.applicant_username),
          esc(it?.created_at),
          esc(p?.paidAt || it?.executed_at),
          esc(p?.paidBy),
          esc(p?.note),
          esc(p?.payNote)
        ].join(','));
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="payments_${start}_${end}.csv"`);
      return res.send('\ufeff' + lines.join('\n'));
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
