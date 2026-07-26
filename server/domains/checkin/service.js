/**
 * Checkin / attendance — pure business logic (no req/res).
 * Returns { ok, status?, error?, message?, ...payload }.
 */

import { childLogger } from '../../utils/logger.js';
import {
  monthBounds,
  buildCheckinByDay,
  buildScheduleAndRestMaps,
  computeAttendanceCounts,
  sumRestDays,
  buildAttendanceOverviewPayload,
} from './attendance-overview-helpers.js';

const log = childLogger({ domain: 'checkin', handler: 'service' });

function defaultGetShanghaiHour() {
  const shNow = new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour12: false });
  const timeStr = shNow.split(', ')[1] || '';
  const parts = timeStr.split(':');
  return parseInt(parts[0] || '0', 10);
}

function truthyFlag(v) {
  return (
    v === true ||
    v === 1 ||
    String(v || '').toLowerCase() === 'true' ||
    String(v) === '1'
  );
}

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
 * POST /api/checkin
 */
export async function createCheckin(ctx, {
  username,
  type: typeRaw,
  latitude,
  longitude,
  body,
  faceMatch,
  faceScore,
  photoUrl,
  storeName,
  tenantId,
}) {
  const {
    pool,
    haversineDistance,
    resolveCheckinRadiusMeters,
    upsertEmployeeAttendanceMirrorFromCheckinRow,
    notifyAdminsDualWriteFailure,
  } = ctx;

  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  const type = String(typeRaw || 'clock_in').trim();
  if (type !== 'clock_in' && type !== 'clock_out') {
    return { ok: false, status: 400, error: 'invalid_type' };
  }

  const lat = Number(latitude) || 0;
  const lng = Number(longitude) || 0;
  const b = body && typeof body === 'object' ? body : {};
  const noGpsRequested =
    truthyFlag(b.noGps) ||
    truthyFlag(b.no_gps) ||
    truthyFlag(b.noLocation) ||
    truthyFlag(b.no_location);
  const faceOk = !!faceMatch;
  const faceScoreNum = Number(faceScore) || 0;
  const photo = photoUrl ? String(photoUrl) : null;
  const store = String(storeName || '').trim();
  const tid = tenantId || 'default';

  try {
    const dupCheckSql = store
      ? `select id from checkin_records where lower(username) = lower($1) and type = $2 and store = $3 and check_time > now() - interval '1 hour' limit 1`
      : `select id from checkin_records where lower(username) = lower($1) and type = $2 and check_time > now() - interval '1 hour' limit 1`;
    const dupCheckParams = store ? [username, type, store] : [username, type];
    const dupCheck = await pool.query(dupCheckSql, dupCheckParams);
    if (dupCheck.rows?.length) {
      const label = type === 'clock_in' ? '上班' : '下班';
      return {
        ok: false,
        status: 400,
        error: 'duplicate_checkin',
        message: `1小时内已${label}打卡，请勿重复操作`,
      };
    }

    if (type === 'clock_in') {
      const getHour = typeof ctx.getShanghaiHour === 'function' ? ctx.getShanghaiHour : defaultGetShanghaiHour;
      const shHour = getHour();
      if (shHour >= 17) {
        return { ok: false, status: 400, error: 'late_clock_in', message: '超过17:00不允许上班打卡' };
      }
    }

    if (type === 'clock_out') {
      const todayClockIn = await pool.query(
        `SELECT id FROM checkin_records
         WHERE LOWER(username) = LOWER($1) AND type = 'clock_in'
           AND (timezone('Asia/Shanghai', check_time))::date = CURRENT_DATE
         LIMIT 1`,
        [username]
      );
      if (!todayClockIn.rows?.length) {
        return {
          ok: false,
          status: 400,
          error: 'no_clock_in',
          message: '今日无上班打卡记录，无法下班打卡',
        };
      }
    }

    if (noGpsRequested || (lat === 0 && lng === 0)) {
      return { ok: false, status: 400, error: 'no_gps', message: '因为未获取到有效定位，无法打卡' };
    }
    if (!faceOk || !photo || photo.length < 80) {
      return {
        ok: false,
        status: 400,
        error: 'no_face',
        message: '因为未开启摄像头或未采集到有效人脸照片，无法打卡',
      };
    }

    let distMeters = null;
    let status = 'normal';

    if (store) {
      try {
        const sr = await pool.query('select data from hrms_state where key = $1 limit 1', [tid]);
        const state = sr.rows?.[0]?.data || {};
        const stores = Array.isArray(state.stores) ? state.stores : [];
        const storeRow = stores.find((s) => String(s?.name || '') === store);
        const radiusM = resolveCheckinRadiusMeters(storeRow, state);
        const sLat = Number(storeRow?.latitude || storeRow?.location?.latitude || 0);
        const sLng = Number(storeRow?.longitude || storeRow?.location?.longitude || 0);
        if (sLat && sLng) {
          distMeters = haversineDistance(lat, lng, sLat, sLng);
          distMeters = Math.round(distMeters * 100) / 100;
          if (distMeters > radiusM) {
            return {
              ok: false,
              status: 400,
              error: 'out_of_range',
              distance: Math.round(distMeters),
              allowedRadiusMeters: radiusM,
              message: `您距离门店${Math.round(distMeters)}米，超出打卡范围（${radiusM}米）`,
            };
          }
        } else {
          status = 'no_store_location';
        }
      } catch (_e) {
        status = 'no_store_location';
      }
    }

    if (!faceOk && status === 'normal') status = 'face_fail';

    const r = await pool.query(
      `insert into checkin_records (username, store, type, check_time, latitude, longitude, distance_meters, face_match, face_score, photo_url, status, tenant_id)
       values ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9, $10, $11)
       returning *`,
      [username, store || null, type, lat, lng, distMeters, faceOk, faceScoreNum, photo, status, tid]
    );
    const inserted = r.rows[0];
    upsertEmployeeAttendanceMirrorFromCheckinRow(inserted, tid).catch((e) => {
      log.error({ msg: 'employee_attendance_mirror_dual_write_failed', err: e?.message || String(e) });
      void notifyAdminsDualWriteFailure('employee_attendance_records（打卡写入镜像）', e);
    });
    return { ok: true, record: inserted };
  } catch (_e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
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
    idx++;

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
 * POST /api/checkin/:id/confirm
 */
export async function confirmCheckin(ctx, {
  username,
  role,
  id,
  status: newStatusRaw,
  note: noteRaw,
  tenantId,
}) {
  const {
    pool,
    upsertEmployeeAttendanceMirrorFromCheckinRow,
    notifyAdminsDualWriteFailure,
  } = ctx;

  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  const canConfirm = role === 'admin' || role === 'hq_manager' || role === 'store_manager';
  if (!canConfirm) return { ok: false, status: 403, error: 'forbidden' };

  const recordId = String(id || '').trim();
  const newStatus = String(newStatusRaw || 'confirmed').trim();
  const note = String(noteRaw || '').trim() || null;
  const tid = tenantId || 'default';

  try {
    const r = await pool.query(
      `update checkin_records set status = $1, confirmed_by = $2, confirmed_at = now(), note = coalesce($3, note) where id = $4 returning *`,
      [newStatus, username, note, recordId]
    );
    if (!r.rows?.length) return { ok: false, status: 404, error: 'not_found' };
    const updated = r.rows[0];
    upsertEmployeeAttendanceMirrorFromCheckinRow(updated, tid).catch((e) => {
      log.error({ msg: 'employee_attendance_mirror_confirm_sync_failed', err: e?.message || String(e) });
      void notifyAdminsDualWriteFailure('employee_attendance_records（打卡确认同步镜像）', e);
    });
    return { ok: true, record: updated };
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
    idx++;

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

/**
 * GET /api/profile/attendance-overview
 */
export async function getAttendanceOverview(ctx, {
  username,
  role,
  month,
  tenantId,
}) {
  const {
    pool,
    getSharedState,
    stateFindUserRecord,
    hrmsAttendanceWindowMinutesForStore,
    hrmsDateKeyInShanghai,
    hrmsClockMinutesInShanghai,
    dailyReportRestDaysForEmployee,
    computeAttendanceMissingClockPenalties,
    calcEmployeeMonthlyLeaveBalance,
  } = ctx;

  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return { ok: false, status: 400, error: 'missing_month' };
  }

  try {
    const state = (await getSharedState()) || {};
    const me = stateFindUserRecord(state, username) || {};
    const myStore = String(me?.store || '').trim();
    const myName = String(me?.name || '').trim();
    const meLower = username.toLowerCase();

    const { monthStart, monthEnd } = monthBounds(month);

    const conditions = [
      `to_char(timezone('Asia/Shanghai', check_time), 'YYYY-MM') = $1`,
      `lower(username) = lower($2)`,
    ];
    const params = [month, username];
    if (role === 'store_manager' && myStore) {
      conditions.push(`store = $3`);
      params.push(myStore);
    }

    const r = await pool.query(
      `select type, check_time from checkin_records where ${conditions.join(' and ')} order by check_time asc`,
      params
    );
    const checkinRows = Array.isArray(r.rows) ? r.rows : [];

    const attWin = hrmsAttendanceWindowMinutesForStore(myStore);
    const checkinByDay = buildCheckinByDay(checkinRows, month, hrmsDateKeyInShanghai);

    const reportList = Array.isArray(state?.dailyReports) ? state.dailyReports : [];
    const { scheduleByDay, restByDay } = buildScheduleAndRestMaps({
      reportList,
      myStore,
      meLower,
      myName,
      monthStart,
      monthEnd,
      dailyReportRestDaysForEmployee,
    });

    const { absentCount, lateCount, earlyLeaveCount } = computeAttendanceCounts({
      scheduleByDay,
      checkinByDay,
      attWin,
      hrmsClockMinutesInShanghai,
    });

    const restDays = sumRestDays(restByDay);
    const _penaltyMap = await computeAttendanceMissingClockPenalties(
      month,
      myStore,
      tenantId || 'default'
    );
    const leaveBalance = calcEmployeeMonthlyLeaveBalance(state, me, month, {
      penalty: _penaltyMap.get(String(me?.username || '').trim().toLowerCase()),
    });

    return buildAttendanceOverviewPayload({
      month,
      username,
      myName,
      leaveBalance,
      absentCount,
      lateCount,
      earlyLeaveCount,
      restDays,
    });
  } catch (_e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

/**
 * POST /api/checkin/leave-balance
 * Permission gate stays in routes (needs req/res).
 */
export async function setLeaveBalance(ctx, {
  actor,
  role,
  targetUsername,
  month,
  value: valueRaw,
  mode: modeRaw,
  note: noteRaw,
}) {
  const {
    getSharedState,
    mergeSharedStateFields,
    stateFindUserRecord,
    dbFindEmployeeRecord,
    calcEmployeeMonthlyLeaveBalance,
    leaveBalanceOverrideKey,
    shiftMonth,
    hrmsNowISO,
    randomUUID,
  } = ctx;

  const target = String(targetUsername || '').trim();
  const monthStr = String(month || '').trim();
  const value = Number(valueRaw);
  const mode = String(modeRaw || 'carryover').trim().toLowerCase();
  const note = String(noteRaw || '').trim();

  if (!target || !monthStr || !Number.isFinite(value)) {
    return { ok: false, status: 400, error: 'missing_params' };
  }
  if (mode !== 'remaining' && mode !== 'total_leave' && mode !== 'carryover') {
    return { ok: false, status: 400, error: 'invalid_mode' };
  }

  try {
    const state = (await getSharedState()) || {};
    const person = stateFindUserRecord(state, target) || await dbFindEmployeeRecord(target) || {};
    const before = calcEmployeeMonthlyLeaveBalance(state, person, monthStr);
    const oldValue = before
      ? Number((mode === 'total_leave'
        ? before.totalLeave
        : mode === 'carryover'
          ? before.cumulativeLeaveDays
          : before.remaining) || 0)
      : 0;

    const overrides = state.leaveBalanceOverrides && typeof state.leaveBalanceOverrides === 'object'
      ? { ...state.leaveBalanceOverrides }
      : {};
    const key = leaveBalanceOverrideKey(target, monthStr);
    const legacyKeys = Object.keys(overrides).filter((k) => {
      const mm = String(k || '').match(/^(.+)_([0-9]{4}-[0-9]{2})$/);
      if (!mm) return false;
      if (String(mm[2] || '') !== monthStr) return false;
      return String(mm[1] || '').trim().toLowerCase() === String(target || '').trim().toLowerCase() && k !== key;
    });
    for (const lk of legacyKeys) delete overrides[lk];

    overrides[key] = {
      mode,
      value: Number(value),
      updatedBy: actor,
      updatedAt: hrmsNowISO(),
      note,
    };

    const logs = Array.isArray(state.leaveBalanceAdjustments) ? state.leaveBalanceAdjustments.slice() : [];
    const rec = {
      id: randomUUID(),
      key,
      month: monthStr,
      targetUsername: target,
      targetName: String(person?.name || target).trim(),
      store: String(person?.store || '').trim(),
      oldValue,
      newValue: Number(value),
      mode,
      note,
      adjustedBy: actor,
      adjustedByRole: role,
      adjustedAt: hrmsNowISO(),
    };
    logs.unshift(rec);

    const nextPatches = {
      leaveBalanceOverrides: overrides,
      leaveBalanceAdjustments: logs.slice(0, 5000),
    };
    if (mode === 'carryover') {
      const prevM = shiftMonth(monthStr, -1);
      if (prevM) {
        const prevSnaps = state.leaveCumulativeCloseSnapshots && typeof state.leaveCumulativeCloseSnapshots === 'object'
          ? state.leaveCumulativeCloseSnapshots
          : {};
        const snapKey = leaveBalanceOverrideKey(target, prevM);
        nextPatches.leaveCumulativeCloseSnapshots = {
          ...prevSnaps,
          [snapKey]: {
            value: Number(Number(value).toFixed(2)),
            lockedAt: hrmsNowISO(),
            source: 'manual_carryover',
            closedMonth: prevM,
            openingMonth: monthStr,
            note: note || '',
          },
        };
      }
    }

    await mergeSharedStateFields(nextPatches, { leaveBalanceAdjustments: 'id' });
    return { ok: true, key, value: Number(value), adjustment: rec };
  } catch (_e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

/**
 * POST /api/checkin/monthly-confirm
 */
export async function confirmMonthlyAttendance(ctx, {
  username,
  role,
  month,
  store,
  summary,
  tenantId,
}) {
  const {
    pool,
    getSharedState,
    mergeSharedStateFields,
    stateFindUserRecord,
    pickHrManagerUsername,
    appendNotifications,
    hrmsNowISO,
  } = ctx;

  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (role !== 'store_manager' && role !== 'admin' && role !== 'hq_manager') {
    return { ok: false, status: 403, error: 'only_managers_can_confirm' };
  }
  const monthStr = String(month || '').trim();
  const storeStr = String(store || '').trim();
  if (!monthStr) return { ok: false, status: 400, error: 'missing_month' };

  try {
    const state = (await getSharedState()) || {};
    const confirmations = Array.isArray(state.monthlyConfirmations) ? state.monthlyConfirmations : [];

    const existing = confirmations.find((c) => c.month === monthStr && c.store === storeStr && c.status !== 'rejected');
    if (existing) {
      return { ok: false, status: 409, error: 'already_submitted', id: existing.id };
    }

    const id = 'MC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const confirmation = {
      id,
      month: monthStr,
      store: storeStr || '',
      submitter: username,
      submitterRole: role,
      summary: summary || {},
      status: 'pending_supervisor',
      createdAt: hrmsNowISO(),
      history: [{ action: 'submitted', by: username, at: hrmsNowISO() }],
    };

    const applicant = stateFindUserRecord(state, username) || {};
    const applicantManager = String(applicant?.managerUsername || '').trim();
    const hrManagerUsername = pickHrManagerUsername(state);

    const chain = [];
    if (applicantManager) chain.push(applicantManager);
    if (hrManagerUsername && hrManagerUsername !== applicantManager) chain.push(hrManagerUsername);

    if (chain.length > 0) {
      try {
        await pool.query(
          `INSERT INTO approval_requests (type, applicant_username, payload, status, approval_chain, current_step, store, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            'monthly_confirm',
            username,
            JSON.stringify({ month: monthStr, store: storeStr, summary: summary || {}, confirmationId: id }),
            'pending',
            JSON.stringify(chain),
            0,
            storeStr || null,
            tenantId || 'default',
          ]
        );
      } catch (dbErr) {
        log.error({ msg: 'monthly_confirm_approval_create_failed', err: dbErr?.message || String(dbErr) });
      }
    } else {
      confirmation.status = 'approved';
      confirmation.approvedAt = hrmsNowISO();
    }

    confirmations.push(confirmation);
    await mergeSharedStateFields({ monthlyConfirmations: [confirmation] }, { monthlyConfirmations: 'id' });

    if (chain.length > 0) {
      await appendNotifications([{
        id: 'NOTIF-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        type: 'monthly_confirm',
        targetUser: chain[0],
        title: '【月度考勤确认】待审批',
        message: `${username} 提交了 ${monthStr} ${storeStr || '全部门店'} 的月度考勤确认，请审批。`,
        read: false,
        createdAt: hrmsNowISO(),
      }]);
    }

    return { ok: true, confirmation };
  } catch (_e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}

/**
 * GET /api/checkin/monthly-confirm
 */
export async function getMonthlyConfirm(ctx, { month }) {
  const { getSharedState } = ctx;
  try {
    const state = (await getSharedState()) || {};
    const confirmations = Array.isArray(state.monthlyConfirmations) ? state.monthlyConfirmations : [];
    const monthStr = String(month || '').trim();
    const filtered = monthStr ? confirmations.filter((c) => c.month === monthStr) : confirmations;
    return { ok: true, confirmations: filtered };
  } catch (_e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
