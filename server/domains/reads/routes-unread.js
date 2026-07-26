/**
 * GET /api/unread-counts — per-module unread badges (Wave 4m extract).
 */
export function registerUnreadCountsRoute(app, authRequired, deps) {
  const {
    pool,
    getSharedState,
    stateFindUserRecord,
    dbFindEmployeeRecord,
  } = deps;

  app.get('/api/unread-counts', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });

    try {
      const readsR = await pool.query('select module, item_key from user_reads where username = $1', [username]);
      const readMap = new Map();
      (readsR.rows || []).forEach(r => {
        const m = String(r?.module || '').trim();
        const k = String(r?.item_key || '').trim();
        if (!m || !k) return;
        if (!readMap.has(m)) readMap.set(m, new Set());
        readMap.get(m).add(k);
      });

      const approvalsUnreadR = await pool.query(
        `select count(*)::int as cnt
         from approval_requests ar
         left join user_reads ur
           on ur.username = $1 and ur.module = 'approval' and ur.item_key = ar.id::text
         where ar.status = 'pending'
           and lower(ar.current_assignee_username) = lower($1)
           and ar.tenant_id = $2
           and ur.item_key is null`,
        [username, req.tenantId || req.user?.tenant_id || 'default']
      );
      const approvals = approvalsUnreadR.rows?.[0]?.cnt || 0;

      const state = (await getSharedState()) || {};
      const me = stateFindUserRecord(state, username) || await dbFindEmployeeRecord(username) || {};
      const myStore = String(me?.store || '').trim();
      const myDept = String(me?.department || '').trim();
      const myPos = String(me?.position || '').trim();

      const isRead = (module, key) => {
        const s = readMap.get(module);
        return s ? s.has(String(key || '').trim()) : false;
      };

      const tasks = Array.isArray(state.trainingTasks) ? state.trainingTasks : [];
      let training = 0;
      for (const t of tasks) {
        const id = String(t?.id || '').trim();
        if (!id) continue;
        if (String(t?.status || '') === 'cancelled') continue;
        const scope = t?.scope && typeof t.scope === 'object' ? t.scope : {};
        const scopeType = String(scope?.type || '').trim();
        const matchScope =
          scopeType === 'all' ||
          (scopeType === 'store' && String(scope?.store || '').trim() && String(scope.store).trim() === myStore) ||
          (scopeType === 'department' && String(scope?.department || '').trim() && String(scope.department).trim() === myDept) ||
          (scopeType === 'user' && String(scope?.user || '').trim() && String(scope.user).trim() === username);

        const assignedTo = String(t?.assignedTo || '').trim();
        const assignedUsers = Array.isArray(t?.assignedUsers) ? t.assignedUsers.map(x => String(x || '').trim()) : [];
        const matchAssigned = assignedTo === username || assignedUsers.includes(username);
        if (!matchScope && !matchAssigned) continue;
        if (isRead('training', id)) continue;
        training += 1;
      }

      const assignments = Array.isArray(state.examAssignments) ? state.examAssignments : [];
      const toArr = (v) => {
        if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
        const s = String(v || '').trim();
        return s ? [s] : [];
      };
      let exam = 0;
      for (const a of assignments) {
        const id = String(a?.id || '').trim();
        if (!id) continue;
        const scope = a?.scope && typeof a.scope === 'object' ? a.scope : (a?.audience && typeof a.audience === 'object' ? a.audience : {});
        const t = String(scope?.type || 'all').trim();
        let match = true;
        if (t === 'store') match = toArr(scope?.stores || scope?.store || scope?.value).includes(myStore);
        if (t === 'position') match = toArr(scope?.positions || scope?.position || scope?.value).includes(myPos);
        if (t === 'user') match = toArr(scope?.users || scope?.user || scope?.value).includes(username);
        if (!match) continue;
        if (isRead('exam', id)) continue;
        exam += 1;
      }

      const notifications = Array.isArray(state.notifications) ? state.notifications : [];
      let dashboard = 0;
      for (const n of notifications) {
        const key = String(n?.id || '').trim();
        if (!key) continue;

        const targetUser = String(n?.targetUser || '').trim();
        if (targetUser) {
          if (targetUser !== username) continue;
        } else {
          const scope = n?.scope && typeof n.scope === 'object' ? n.scope : null;
          const t = String(scope?.type || 'all').trim();
          if (t === 'all') {
            // visible
          } else if (t === 'store') {
            if (String(scope?.store || '').trim() !== myStore) continue;
          } else if (t === 'position') {
            if (String(scope?.position || '').trim() !== myPos) continue;
          } else if (t === 'user') {
            const list = Array.isArray(scope?.usernames) ? scope.usernames.map(x => String(x || '').trim()) : [];
            if (!list.includes(username)) continue;
          } else {
            continue;
          }
        }

        if (isRead('dashboard', key)) continue;
        dashboard += 1;
      }

      let rewards = 0;
      try {
        const rwR = await pool.query(
          `SELECT count(*)::int as cnt
           FROM approval_requests ar
           LEFT JOIN user_reads ur
             ON ur.username = $1 AND ur.module = 'rewards' AND ur.item_key = ar.id::text
           WHERE ar.type = 'reward_punishment'
             AND ar.status IN ('approved','paid')
             AND (ar.payload->>'targetUser' = $1 OR ar.submitted_by = $1)
             AND ar.tenant_id = $2
             AND ur.item_key IS NULL`,
          [username, req.tenantId || req.user?.tenant_id || 'default']
        );
        rewards = rwR.rows?.[0]?.cnt || 0;
      } catch (e) { /* ignore */ }

      let payment = 0;
      try {
        const pmR = await pool.query(
          `SELECT count(*)::int as cnt
           FROM approval_requests ar
           LEFT JOIN user_reads ur
             ON ur.username = $1 AND ur.module = 'payment' AND ur.item_key = ar.id::text
           WHERE ar.type = 'payment'
             AND ar.status = 'pending'
             AND (lower(ar.current_assignee_username) = lower($1) OR lower(ar.submitted_by) = lower($1))
             AND ar.tenant_id = $2
             AND ur.item_key IS NULL`,
          [username, req.tenantId || req.user?.tenant_id || 'default']
        );
        payment = pmR.rows?.[0]?.cnt || 0;
      } catch (e) { /* ignore */ }

      let opsTasks = 0;
      try {
        const opR = await pool.query(
          `select count(*)::int as cnt
           from ops_tasks t
           left join user_reads ur
             on ur.username = $1 and ur.module = 'ops_tasks' and ur.item_key = t.id::text
           where t.status in ('open', 'overdue')
             and lower(t.assignee_username) = lower($1)
             and ur.item_key is null`,
          [username]
        );
        opsTasks = opR.rows?.[0]?.cnt || 0;
      } catch (e) { /* ignore */ }

      return res.json({ approvals, training, exam, dashboard, rewards, payment, opsTasks });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
