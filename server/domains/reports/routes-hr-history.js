/**
 * Salary-changes + promotion-records — /api/reports/*
 */
import {
  pool,
} from './helpers.js';

export function registerReportsHrHistoryRoutes(app, deps) {
  const {
    authRequired,
    getSharedState,
    parseMonth,
    stateFindUserRecord,
    stateOrDbFindUserRecord,
    isAdmin,
    isHq,
    randomUUID,
  } = deps;

  app.get('/api/reports/salary-changes', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });

    const qUser = String(req.query?.username || '').trim();
    const qStore = String(req.query?.store || '').trim();
    const qMonth = parseMonth(req.query?.month);
    const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200) || 200));

    try {
      const state = (await getSharedState()) || {};
      const mine = stateFindUserRecord(state, username) || {};
      const mineStore = String(mine?.store || '').trim();
      const targetUser = qUser || username;

      const isPrivileged = isAdmin(role) || isHq(role) || role === 'hr_manager';
      if (!isPrivileged) {
        if (role === 'store_manager') {
          const targetRec = stateFindUserRecord(state, targetUser) || {};
          const targetStore = String(targetRec?.store || '').trim();
          if (targetUser !== username && (!mineStore || !targetStore || mineStore !== targetStore)) {
            return res.status(403).json({ error: 'forbidden' });
          }
        } else if (targetUser !== username) {
          return res.status(403).json({ error: 'forbidden' });
        }
      }

      let rows = Array.isArray(state.salaryChangeHistory) ? state.salaryChangeHistory.slice() : [];
      const seenApprovalIds = new Set(rows.map((x) => String(x?.approvalId || '').trim()).filter(Boolean));

      // Backfill from historical formal promotion approvals (for records created before salaryChangeHistory was introduced)
      const legacyR = await pool.query(
        `select id, applicant_username, payload, chain, updated_at, created_at
         from approval_requests
         where type = 'promotion'
           and status = 'approved'
           and lower(coalesce(payload->>'promotionStage','')) = 'formal'
           and tenant_id = $1
         order by updated_at desc
         limit 2000`,
        [req.tenantId || req.user?.tenant_id || 'default']
      );
      const legacyRows = (legacyR.rows || []).map((r) => {
        const payload = r?.payload && typeof r.payload === 'object' ? r.payload : {};
        const promotedSalary = Number(payload?.promotedSalary);
        if (!Number.isFinite(promotedSalary) || promotedSalary <= 0) return null;
        const applicantUser = String(r?.applicant_username || '').trim();
        const applicantRec = stateFindUserRecord(state, applicantUser) || {};
        const chain = Array.isArray(r?.chain) ? r.chain : [];
        let approvedBy = '';
        let approvedAt = '';
        for (let i = chain.length - 1; i >= 0; i -= 1) {
          const step = chain[i] || {};
          if (String(step?.status || '').trim() === 'approved') {
            approvedBy = String(step?.assignee || '').trim();
            approvedAt = String(step?.decidedAt || '').trim();
            break;
          }
        }
        const fallbackApprovedAt = String(r?.updated_at || r?.created_at || '');
        return {
          id: randomUUID(),
          approvalId: String(r?.id || ''),
          source: 'promotion_formal_legacy',
          targetUsername: applicantUser,
          targetName: String(applicantRec?.name || applicantUser).trim() || applicantUser,
          store: String(payload?.store || applicantRec?.store || '').trim(),
          oldSalary: null,
          newSalary: Number(promotedSalary.toFixed(2)),
          delta: null,
          approvedBy,
          approvedAt: approvedAt || fallbackApprovedAt,
          reason: String(payload?.reason || '').trim(),
          chain
        };
      }).filter(Boolean);
      legacyRows.forEach((x) => {
        const aid = String(x?.approvalId || '').trim();
        if (!aid || seenApprovalIds.has(aid)) return;
        rows.push(x);
        seenApprovalIds.add(aid);
      });

      if (targetUser) {
        const t = targetUser.toLowerCase();
        rows = rows.filter((x) => String(x?.targetUsername || '').trim().toLowerCase() === t);
      }
      if (qStore) rows = rows.filter((x) => String(x?.store || '').trim() === qStore);
      if (qMonth) rows = rows.filter((x) => String(x?.approvedAt || x?.createdAt || '').slice(0, 7) === qMonth);

      rows.sort((a, b) => String(b?.approvedAt || b?.createdAt || '').localeCompare(String(a?.approvedAt || a?.createdAt || '')));
      rows = rows.slice(0, limit);
      return res.json({ items: rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/reports/promotion-records', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!(isAdmin(role) || role === 'hr_manager' || isHq(role))) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const qStore = String(req.query?.store || '').trim();
    const qMonth = parseMonth(req.query?.month);
    const limit = Math.max(1, Math.min(1000, Number(req.query?.limit || 300) || 300));

    try {
      const state = (await getSharedState()) || {};
      const r = await pool.query(
        `select id, applicant_username, payload, chain, created_at, updated_at
         from approval_requests
         where type = 'promotion'
           and status = 'approved'
           and lower(coalesce(payload->>'promotionStage','')) = 'formal'
           and tenant_id = $2
         order by updated_at desc
         limit $1`,
        [limit, req.tenantId || req.user?.tenant_id || 'default']
      );

      let items = [];
      for (const row of (r.rows || [])) {
        let payload = row?.payload || {};
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch (_) { payload = {}; }
        }
        if (!payload || typeof payload !== 'object') payload = {};
        const applicantUser = String(row?.applicant_username || '').trim();
        const applicant = await stateOrDbFindUserRecord(state, applicantUser) || {};
        const chain = Array.isArray(row?.chain) ? row.chain : [];
        let approvedBy = '';
        let approvedAt = '';
        for (let i = chain.length - 1; i >= 0; i -= 1) {
          const s = chain[i] || {};
          if (String(s?.status || '').trim() === 'approved') {
            approvedBy = String(s?.assignee || '').trim();
            approvedAt = String(s?.decidedAt || '').trim();
            break;
          }
        }
        items.push({
          approvalId: String(row?.id || ''),
          applicantUsername: applicantUser,
          applicantName: String(applicant?.name || applicantUser).trim() || applicantUser,
          store: String(payload?.store || applicant?.store || '').trim(),
          department: String(payload?.department || applicant?.department || '').trim(),
          fromPosition: String(payload?.currentPosition || applicant?.position || '').trim(),
          fromLevel: String(payload?.currentLevel || applicant?.level || '').trim(),
          toPosition: String(payload?.targetPosition || payload?.newPosition || '').trim(),
          toLevel: String(payload?.targetLevel || payload?.newLevel || '').trim(),
          promotedSalary: Number(payload?.promotedSalary || 0) || null,
          reason: String(payload?.reason || '').trim(),
          approvedBy,
          approvedAt: approvedAt || String(row?.updated_at || row?.created_at || ''),
          createdAt: String(row?.created_at || '')
        });
      }

      if (qStore) items = items.filter((x) => String(x?.store || '').trim() === qStore);
      if (qMonth) items = items.filter((x) => String(x?.approvedAt || '').slice(0, 7) === qMonth);
      items.sort((a, b) => String(b?.approvedAt || '').localeCompare(String(a?.approvedAt || '')));
      return res.json({ items });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

}
