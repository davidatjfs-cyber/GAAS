/**
 * Checkin record listing and monthly summary business logic.
 */

function buildNameMap(state) {
  const usersArr = Array.isArray(state?.users) ? state.users : [];
  const empsArr = Array.isArray(state?.employees) ? state.employees : [];
  const nameMap = {};
  usersArr.forEach((u) => {
    if (u?.username) nameMap[String(u.username).toLowerCase()] = u.name || u.username;
  });
  empsArr.forEach((e) => {
    if (e?.username) nameMap[String(e.username).toLowerCase()] = e.name || e.username;
  });
  return { usersArr, empsArr, nameMap };
}

/**
 * GET /api/checkin/today
 */
export async function listTodayCheckins(ctx, { username }) {
  const { pool } = ctx;
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  try {
    const r = await pool.query(
      `select * from checkin_records where lower(username) = lower($1) and check_time::date = current_date order by check_time asc`,
      [username]
    );
    return { ok: true, records: r.rows || [] };
  } catch (_e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

/**
 * GET /api/checkin/records
 */
export async function listCheckinRecords(ctx, {
  username,
  role,
  filterUser,
  filterStore,
  filterName,
  start,
  end,
  filterStatus,
  tenantId,
}) {
  const {
    pool,
    getSharedState,
    safeDateOnly,
    loadActiveDutyRowsForUser,
    pickMyStoreFromState,
  } = ctx;

  if (!username) return { ok: false, status: 400, error: 'missing_user' };

  const startDate = typeof safeDateOnly === 'function' ? safeDateOnly(start) : start;
  const endDate = typeof safeDateOnly === 'function' ? safeDateOnly(end) : end;

  try {
    const state = (await getSharedState()) || {};
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role === 'admin' || role === 'hq_manager' || role === 'hr_manager') {
      if (filterUser) {
        conditions.push(`lower(username) = lower($${idx})`);
        params.push(filterUser);
        idx++;
      }
      if (filterStore) {
        conditions.push(`store = $${idx}`);
        params.push(filterStore);
        idx++;
      }
    } else if (role === 'store_manager') {
      let managerStores = [];
      try {
        const dutyRows = await loadActiveDutyRowsForUser(pool, username);
        managerStores = dutyRows.map((r) => String(r.store || '').trim()).filter(Boolean);
      } catch (_e) { /* ignore */ }
      if (!managerStores.length) {
        const myStore = pickMyStoreFromState(state, username);
        if (myStore) managerStores = [myStore];
      }
      if (managerStores.length > 1) {
        conditions.push(`store = ANY($${idx}::text[])`);
        params.push(managerStores);
        idx++;
      } else if (managerStores.length === 1) {
        conditions.push(`store = $${idx}`);
        params.push(managerStores[0]);
        idx++;
      } else {
        conditions.push(`lower(username) = lower($${idx})`);
        params.push(username);
        idx++;
      }
      if (filterUser) {
        conditions.push(`lower(username) = lower($${idx})`);
        params.push(filterUser);
        idx++;
      }
    } else {
      conditions.push(`lower(username) = lower($${idx})`);
      params.push(username);
      idx++;
    }

    if (filterName) {
      const users = Array.isArray(state?.users) ? state.users : [];
      const employees = Array.isArray(state?.employees) ? state.employees : [];
      const all = users.concat(employees);
      const matchedUsernames = all
        .filter((u) => String(u?.name || '').includes(filterName))
        .map((u) => String(u?.username || '').trim().toLowerCase())
        .filter(Boolean);
      if (matchedUsernames.length) {
        conditions.push(`lower(username) = any($${idx}::text[])`);
        params.push(matchedUsernames);
        idx++;
      } else {
        return { ok: true, records: [] };
      }
    }

    if (startDate) {
      conditions.push(`check_time::date >= $${idx}::date`);
      params.push(startDate);
      idx++;
    }
    if (endDate) {
      conditions.push(`check_time::date <= $${idx}::date`);
      params.push(endDate);
      idx++;
    }
    if (filterStatus) {
      conditions.push(`status = $${idx}`);
      params.push(filterStatus);
      idx++;
    }
    conditions.push(`tenant_id = $${idx}`);
    params.push(tenantId || 'default');

    const where = conditions.length ? 'where ' + conditions.join(' and ') : '';
    const r = await pool.query(
      `select * from checkin_records ${where} order by check_time desc limit 500`,
      params
    );
    const { nameMap } = buildNameMap(state);
    const rows = (r.rows || []).map((row) => ({
      ...row,
      display_name: nameMap[String(row.username || '').toLowerCase()] || row.username,
    }));
    return { ok: true, records: rows };
  } catch (_e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

/**
 * GET /api/checkin/summary
 */
export async function getCheckinSummary(ctx, {
  username,
  role,
  filterStore,
  month,
  tenantId,
}) {
  const {
    pool,
    getSharedState,
    pickMyStoreFromState,
    calcEmployeeMonthlyLeaveBalance,
  } = ctx;

  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!month) return { ok: false, status: 400, error: 'missing_month' };

  try {
    const state = (await getSharedState()) || {};
    const conditions = [`to_char(timezone('Asia/Shanghai', check_time), 'YYYY-MM') = $1`];
    const params = [month];
    let idx = 2;

    if (role === 'admin' || role === 'hq_manager') {
      if (filterStore) {
        conditions.push(`store = $${idx}`);
        params.push(filterStore);
        idx++;
      }
    } else if (role === 'store_manager') {
      const myStore = pickMyStoreFromState(state, username);
      if (myStore) {
        conditions.push(`store = $${idx}`);
        params.push(myStore);
        idx++;
      } else {
        conditions.push(`lower(username) = lower($${idx})`);
        params.push(username);
        idx++;
      }
    } else {
      conditions.push(`lower(username) = lower($${idx})`);
      params.push(username);
      idx++;
    }
    conditions.push(`tenant_id = $${idx}`);
    params.push(tenantId || 'default');

    const where = conditions.join(' and ');
    const r = await pool.query(
      `select username, (timezone('Asia/Shanghai', check_time))::date as day, type, status, check_time
       from checkin_records where ${where} order by username, check_time asc`,
      params
    );
    const { usersArr, empsArr, nameMap } = buildNameMap(state);
    const rows = (r.rows || []).map((row) => ({
      ...row,
      display_name: nameMap[String(row.username || '').toLowerCase()] || row.username,
    }));

    const leaveBalances = {};
    const allUsernames = new Set();
    rows.forEach((row) => allUsernames.add(String(row.username || '').toLowerCase()));

    allUsernames.forEach((uLower) => {
      const emp = empsArr.find((e) => String(e?.username || '').toLowerCase() === uLower)
        || usersArr.find((e) => String(e?.username || '').toLowerCase() === uLower);
      if (!emp) return;
      const uname = String(emp.username || '').trim();
      const bal = calcEmployeeMonthlyLeaveBalance(state, emp, month);
      if (!bal) return;
      leaveBalances[uname] = {
        baseLeave: bal.baseLeave,
        annualLeave: bal.annualLeave,
        usedLeave: bal.usedLeave,
        totalLeave: bal.totalLeave,
        cumulativeLeaveDays: bal.cumulativeLeaveDays,
        computedRemaining: bal.computedRemaining,
        remaining: bal.remaining,
        overridden: !!bal.overridden,
        cumulativeLeaveManualLock: !!bal.cumulativeLeaveManualLock,
        weeklyDetails: Array.isArray(bal.weeklyDetails) ? bal.weeklyDetails : [],
        lastAdjustment: bal.lastAdjustment || null,
      };
    });

    return { ok: true, records: rows, leaveBalances };
  } catch (_e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
