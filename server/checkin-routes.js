/**
 * Attendance / Checkin routes (extracted from index.js — monolith split).
 * registerCheckinRoutes(app, deps) — behavior-preserving move.
 */
import { requireHrmsPermission } from './services/hrms-permission-engine.js';

export function registerCheckinRoutes(app, deps) {
  const {
    pool,
    authRequired,
    getSharedState,
    mergeSharedStateFields,
    safeDateOnly,
    loadActiveDutyRowsForUser,
    pickMyStoreFromState,
    stateFindUserRecord,
    dbFindEmployeeRecord,
    calcEmployeeMonthlyLeaveBalance,
    computeAttendanceMissingClockPenalties,
    hrmsAttendanceWindowMinutesForStore,
    hrmsDateKeyInShanghai,
    hrmsClockMinutesInShanghai,
    dailyReportRestDaysForEmployee,
    leaveBalanceOverrideKey,
    shiftMonth,
    hrmsNowISO,
    pickHrManagerUsername,
    appendNotifications,
    upsertEmployeeAttendanceMirrorFromCheckinRow,
    notifyAdminsDualWriteFailure,
    haversineDistance,
    resolveCheckinRadiusMeters,
    randomUUID,
  } = deps;

  // ─── Attendance / Checkin APIs ───────────────────────────────────────────────

  app.post('/api/checkin', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const type = String(req.body?.type || 'clock_in').trim();
    if (type !== 'clock_in' && type !== 'clock_out') return res.status(400).json({ error: 'invalid_type' });
    const lat = Number(req.body?.latitude) || 0;
    const lng = Number(req.body?.longitude) || 0;
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const truthyFlag = (v) =>
      v === true ||
      v === 1 ||
      String(v || '').toLowerCase() === 'true' ||
      String(v) === '1';
    const noGpsRequested =
      truthyFlag(b.noGps) ||
      truthyFlag(b.no_gps) ||
      truthyFlag(b.noLocation) ||
      truthyFlag(b.no_location);
    const faceMatch = !!req.body?.faceMatch;
    const faceScore = Number(req.body?.faceScore) || 0;
    const photoUrl = req.body?.photoUrl ? String(req.body.photoUrl) : null;
    const storeName = String(req.body?.store || req.user?.store || '').trim();

    try {
      // Prevent duplicate same-type check-in within 1 hour at the same store
      // Allow cross-store clock-ins (e.g. dual-store managers clocking in at each store)
      const dupCheckSql = storeName
        ? `select id from checkin_records where lower(username) = lower($1) and type = $2 and store = $3 and check_time > now() - interval '1 hour' limit 1`
        : `select id from checkin_records where lower(username) = lower($1) and type = $2 and check_time > now() - interval '1 hour' limit 1`;
      const dupCheckParams = storeName ? [username, type, storeName] : [username, type];
      const dupCheck = await pool.query(dupCheckSql, dupCheckParams);
      if (dupCheck.rows?.length) {
        const label = type === 'clock_in' ? '上班' : '下班';
        return res.status(400).json({ error: 'duplicate_checkin', message: `1小时内已${label}打卡，请勿重复操作` });
      }

      // 规则1：超过17:00不允许上班打卡
      if (type === 'clock_in') {
        const shNow = new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour12: false });
        const timeStr = shNow.split(', ')[1] || '';
        const parts = timeStr.split(':');
        const shHour = parseInt(parts[0] || '0', 10);
        const _shMin = parseInt(parts[1] || '0', 10);
        if (shHour >= 17) {
          return res.status(400).json({ error: 'late_clock_in', message: '超过17:00不允许上班打卡' });
        }
      }

      // 规则2：无上班打卡不允许下班打卡
      if (type === 'clock_out') {
        const todayClockIn = await pool.query(
          `SELECT id FROM checkin_records
           WHERE LOWER(username) = LOWER($1) AND type = 'clock_in'
             AND (timezone('Asia/Shanghai', check_time))::date = CURRENT_DATE
           LIMIT 1`,
          [username]
        );
        if (!todayClockIn.rows?.length) {
          return res.status(400).json({ error: 'no_clock_in', message: '今日无上班打卡记录，无法下班打卡' });
        }
      }

      if (noGpsRequested || (lat === 0 && lng === 0)) {
        return res.status(400).json({ error: 'no_gps', message: '因为未获取到有效定位，无法打卡' });
      }
      if (!faceMatch || !photoUrl || photoUrl.length < 80) {
        return res.status(400).json({
          error: 'no_face',
          message: '因为未开启摄像头或未采集到有效人脸照片，无法打卡'
        });
      }

      let distMeters = null;
      let status = 'normal';

      if (storeName) {
        // Look up store location
        try {
          const sr = await pool.query("select data from hrms_state where key = $1 limit 1", [req.tenantId || req.user?.tenant_id || 'default']);
          const state = sr.rows?.[0]?.data || {};
          const stores = Array.isArray(state.stores) ? state.stores : [];
          const store = stores.find(s => String(s?.name || '') === storeName);
          const radiusM = resolveCheckinRadiusMeters(store, state);
          const sLat = Number(store?.latitude || store?.location?.latitude || 0);
          const sLng = Number(store?.longitude || store?.location?.longitude || 0);
          if (sLat && sLng) {
            distMeters = haversineDistance(lat, lng, sLat, sLng);
            distMeters = Math.round(distMeters * 100) / 100;
            if (distMeters > radiusM) {
              status = 'out_of_range';
              return res.status(400).json({
                error: 'out_of_range',
                distance: Math.round(distMeters),
                allowedRadiusMeters: radiusM,
                message: `您距离门店${Math.round(distMeters)}米，超出打卡范围（${radiusM}米）`
              });
            }
          } else {
            status = 'no_store_location';
          }
        } catch (e) {
          status = 'no_store_location';
        }
      }

      if (!faceMatch && status === 'normal') status = 'face_fail';

      const r = await pool.query(
        `insert into checkin_records (username, store, type, check_time, latitude, longitude, distance_meters, face_match, face_score, photo_url, status, tenant_id)
         values ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9, $10, $11)
         returning *`,
        [username, storeName || null, type, lat, lng, distMeters, faceMatch, faceScore, photoUrl, status, req.tenantId || req.user?.tenant_id || 'default']
      );
      const inserted = r.rows[0];
      upsertEmployeeAttendanceMirrorFromCheckinRow(inserted, req.tenantId || req.user?.tenant_id || 'default').catch((e) => {
        console.error('[employee_attendance_records] dual-write failed (non-fatal):', e?.message);
        void notifyAdminsDualWriteFailure('employee_attendance_records（打卡写入镜像）', e);
      });
      return res.json({ ok: true, record: inserted });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // NOTE: /api/checkin/today, /api/checkin/records, /api/checkin/summary handlers
  // are defined later in this file (using shared state for name resolution).

  // NOTE: /api/checkin/monthly-confirm and /api/checkin/leave-balance handlers
  // are defined later in this file (using shared state).

  // ─── End Attendance APIs (first block) ──────────────────────────────────────

  app.get('/api/checkin/today', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    try {
      const r = await pool.query(
        `select * from checkin_records where lower(username) = lower($1) and check_time::date = current_date order by check_time asc`,
        [username]
      );
      return res.json({ records: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/checkin/records', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });

    const filterUser = String(req.query?.username || '').trim();
    const filterStore = String(req.query?.store || '').trim();
    const filterName = String(req.query?.name || '').trim();
    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    const filterStatus = String(req.query?.status || '').trim();

    try {
      const state = (await getSharedState()) || {};
      let conditions = [];
      let params = [];
      let idx = 1;

      if (role === 'admin' || role === 'hq_manager' || role === 'hr_manager') {
        // Admin, HQ manager, and HR manager can see all records
        if (filterUser) { conditions.push(`lower(username) = lower($${idx})`); params.push(filterUser); idx++; }
        if (filterStore) { conditions.push(`store = $${idx}`); params.push(filterStore); idx++; }
      } else if (role === 'store_manager') {
        // Dual-store managers: query duty bindings for all stores they're responsible for
        let managerStores = [];
        try {
          const dutyRows = await loadActiveDutyRowsForUser(pool, username);
          managerStores = dutyRows.map(r => String(r.store || '').trim()).filter(Boolean);
        } catch (_e) { /* ignore */ }
        if (!managerStores.length) {
          const myStore = pickMyStoreFromState(state, username);
          if (myStore) managerStores = [myStore];
        }
        if (managerStores.length > 1) {
          conditions.push(`store = ANY($${idx}::text[])`); params.push(managerStores); idx++;
        } else if (managerStores.length === 1) {
          conditions.push(`store = $${idx}`); params.push(managerStores[0]); idx++;
        } else {
          conditions.push(`lower(username) = lower($${idx})`); params.push(username); idx++;
        }
        if (filterUser) { conditions.push(`lower(username) = lower($${idx})`); params.push(filterUser); idx++; }
      } else {
        // Everyone else (employee, cashier) sees only their own
        conditions.push(`lower(username) = lower($${idx})`); params.push(username); idx++;
      }

      // Name search: find usernames matching the search name
      if (filterName) {
        const users = Array.isArray(state?.users) ? state.users : [];
        const employees = Array.isArray(state?.employees) ? state.employees : [];
        const all = users.concat(employees);
        const matchedUsernames = all
          .filter(u => String(u?.name || '').includes(filterName))
          .map(u => String(u?.username || '').trim().toLowerCase())
          .filter(Boolean);
        if (matchedUsernames.length) {
          conditions.push(`lower(username) = any($${idx}::text[])`);
          params.push(matchedUsernames);
          idx++;
        } else {
          // No match found, return empty
          return res.json({ records: [] });
        }
      }

      if (start) { conditions.push(`check_time::date >= $${idx}::date`); params.push(start); idx++; }
      if (end) { conditions.push(`check_time::date <= $${idx}::date`); params.push(end); idx++; }
      if (filterStatus) { conditions.push(`status = $${idx}`); params.push(filterStatus); idx++; }
      conditions.push(`tenant_id = $${idx}`); params.push(req.tenantId || req.user?.tenant_id || 'default'); idx++;

      const where = conditions.length ? 'where ' + conditions.join(' and ') : '';
      const r = await pool.query(
        `select * from checkin_records ${where} order by check_time desc limit 500`,
        params
      );
      // Build nameMap from shared state so frontend always gets real names (case-insensitive)
      const usersArr = Array.isArray(state?.users) ? state.users : [];
      const empsArr = Array.isArray(state?.employees) ? state.employees : [];
      const nameMap = {};
      usersArr.forEach(u => { if (u?.username) nameMap[String(u.username).toLowerCase()] = u.name || u.username; });
      empsArr.forEach(e => { if (e?.username) nameMap[String(e.username).toLowerCase()] = e.name || e.username; });
      const rows = (r.rows || []).map(row => ({
        ...row,
        display_name: nameMap[String(row.username || '').toLowerCase()] || row.username
      }));
      return res.json({ records: rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/checkin/:id/confirm', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const canConfirm = role === 'admin' || role === 'hq_manager' || role === 'store_manager';
    if (!canConfirm) return res.status(403).json({ error: 'forbidden' });
    const id = String(req.params?.id || '').trim();
    const newStatus = String(req.body?.status || 'confirmed').trim();
    const note = String(req.body?.note || '').trim() || null;
    try {
      const r = await pool.query(
        `update checkin_records set status = $1, confirmed_by = $2, confirmed_at = now(), note = coalesce($3, note) where id = $4 returning *`,
        [newStatus, username, note, id]
      );
      if (!r.rows?.length) return res.status(404).json({ error: 'not_found' });
      const updated = r.rows[0];
      upsertEmployeeAttendanceMirrorFromCheckinRow(updated, req.tenantId || req.user?.tenant_id || 'default').catch((e) => {
        console.error('[employee_attendance_records] confirm sync failed (non-fatal):', e?.message);
        void notifyAdminsDualWriteFailure('employee_attendance_records（打卡确认同步镜像）', e);
      });
      return res.json({ record: updated });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/checkin/summary', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const filterStore = String(req.query?.store || '').trim();
    const month = String(req.query?.month || '').trim();
    if (!month) return res.status(400).json({ error: 'missing_month' });

    try {
      const state = (await getSharedState()) || {};
      let conditions = [`to_char(timezone('Asia/Shanghai', check_time), 'YYYY-MM') = $1`];
      let params = [month];
      let idx = 2;

      if (role === 'admin' || role === 'hq_manager') {
        if (filterStore) { conditions.push(`store = $${idx}`); params.push(filterStore); idx++; }
      } else if (role === 'store_manager') {
        const myStore = pickMyStoreFromState(state, username);
        if (myStore) { conditions.push(`store = $${idx}`); params.push(myStore); idx++; }
        else { conditions.push(`lower(username) = lower($${idx})`); params.push(username); idx++; }
      } else {
        conditions.push(`lower(username) = lower($${idx})`); params.push(username); idx++;
      }
      conditions.push(`tenant_id = $${idx}`); params.push(req.tenantId || req.user?.tenant_id || 'default'); idx++;

      const where = conditions.join(' and ');
      const r = await pool.query(
        `select username, (timezone('Asia/Shanghai', check_time))::date as day, type, status, check_time
         from checkin_records where ${where} order by username, check_time asc`,
        params
      );
      // Attach display_name from shared state (case-insensitive)
      const usersArr = Array.isArray(state?.users) ? state.users : [];
      const empsArr = Array.isArray(state?.employees) ? state.employees : [];
      const nameMap = {};
      usersArr.forEach(u => { if (u?.username) nameMap[String(u.username).toLowerCase()] = u.name || u.username; });
      empsArr.forEach(e => { if (e?.username) nameMap[String(e.username).toLowerCase()] = e.name || e.username; });
      const rows = (r.rows || []).map(row => ({
        ...row,
        display_name: nameMap[String(row.username || '').toLowerCase()] || row.username
      }));

      // Calculate leave balance per employee for this month
      const leaveBalances = {};
      const allUsernames = new Set();
      rows.forEach(row => allUsernames.add(String(row.username || '').toLowerCase()));

      allUsernames.forEach(uLower => {
        const emp = empsArr.find(e => String(e?.username || '').toLowerCase() === uLower)
          || usersArr.find(e => String(e?.username || '').toLowerCase() === uLower);
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
          lastAdjustment: bal.lastAdjustment || null
        };
      });

      return res.json({ records: rows, leaveBalances });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/profile/attendance-overview', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    const month = String(req.query?.month || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'missing_month' });

    const parseDateOnly = (s) => {
      const v = String(s || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
      const d = new Date(v + 'T00:00:00');
      return Number.isFinite(d.getTime()) ? d : null;
    };
    const toDateOnly = (d) => {
      if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const shiftDate = (s, delta) => {
      const d = parseDateOnly(s);
      if (!d) return '';
      d.setDate(d.getDate() + delta);
      return toDateOnly(d);
    };
    const splitNameTokens = (raw) => {
      return String(raw || '')
        .split(/[，,、;；\n\r\t\s\/|]+/)
        .map(x => String(x || '').trim())
        .filter(Boolean);
    };
    const normalizeStaffUser = (item) => {
      return String(item?.user || item?.username || '').trim().toLowerCase();
    };
    const normalizeStaffName = (item) => {
      return String(item?.name || '').trim();
    };

    try {
      const state = (await getSharedState()) || {};
      const me = stateFindUserRecord(state, username) || {};
      const myStore = String(me?.store || '').trim();
      const myName = String(me?.name || '').trim();
      const meLower = username.toLowerCase();

      const [yearNum, monthNum] = month.split('-').map(Number);
      const monthStart = `${month}-01`;
      const monthEnd = `${month}-${String(new Date(yearNum, monthNum, 0).getDate()).padStart(2, '0')}`;

      let conditions = [`to_char(timezone('Asia/Shanghai', check_time), 'YYYY-MM') = $1`, `lower(username) = lower($2)`];
      let params = [month, username];
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

      const checkinByDay = new Map();
      checkinRows.forEach((row) => {
        const t = new Date(row.check_time);
        if (!Number.isFinite(t.getTime())) return;
        const dayKey = hrmsDateKeyInShanghai(t);
        if (!dayKey || !dayKey.startsWith(month)) return;
        const list = checkinByDay.get(dayKey) || [];
        list.push({
          type: String(row?.type || '').trim(),
          date: t
        });
        checkinByDay.set(dayKey, list);
      });

      const reportList = Array.isArray(state?.dailyReports) ? state.dailyReports : [];
      const scheduleByDay = new Map();
      const restByDay = new Map();

      reportList.forEach((rep) => {
        const repStore = String(rep?.store || '').trim();
        if (myStore && repStore && repStore !== myStore) return;

        const repDate = String(rep?.date || '').trim();
        if (!repDate) return;
        const data = rep?.data && typeof rep.data === 'object' ? rep.data : {};

        // 休息统计：按当天日报记录（优先结构化 staff list，兼容旧文本）
        if (repDate >= monthStart && repDate <= monthEnd) {
          let restedDays = dailyReportRestDaysForEmployee(data?.staff, meLower, myName);  // 支持半天 0.5

          // legacy fallback: comma-separated text names
          if (!(restedDays > 0)) {
            const frontRest = String(data?.staff?.frontRest || '').trim();
            const kitchenRest = String(data?.staff?.kitchenRest || '').trim();
            const tokens = splitNameTokens(frontRest).concat(splitNameTokens(kitchenRest));
            const tokenSet = new Set(tokens.map(x => x.toLowerCase()));
            const hitByToken = tokenSet.has(meLower) || (!!myName && tokenSet.has(myName.toLowerCase()));
            const hitByRaw = (!!myName && (frontRest.includes(myName) || kitchenRest.includes(myName)))
              || frontRest.toLowerCase().includes(meLower)
              || kitchenRest.toLowerCase().includes(meLower);
            if (hitByToken || hitByRaw) restedDays = 1;
          }

          if (restedDays > 0) {
            restByDay.set(repDate, Number(restedDays));
          }
        }

        // 排班统计：日报记录的是“次日排班”
        const targetDate = shiftDate(repDate, 1);
        if (!targetDate || targetDate < monthStart || targetDate > monthEnd) return;
        const next = data?.scheduleNextDay && typeof data.scheduleNextDay === 'object' ? data.scheduleNextDay : {};
        const planAll = Array.isArray(next?.staff) ? next.staff : [];
        const planMorning = Array.isArray(next?.morningStaff) ? next.morningStaff : [];
        const planAfternoon = Array.isArray(next?.afternoonStaff) ? next.afternoonStaff : [];

        const hasMatch = (list) => list.some((it) => {
          const u = normalizeStaffUser(it);
          const n = normalizeStaffName(it);
          if (u && u === meLower) return true;
          if (n && myName && n === myName) return true;
          return false;
        });

        const dayPlan = scheduleByDay.get(targetDate) || { planned: false, morning: false, afternoon: false };
        dayPlan.planned = dayPlan.planned || hasMatch(planAll) || hasMatch(planMorning) || hasMatch(planAfternoon);
        dayPlan.morning = dayPlan.morning || hasMatch(planMorning) || hasMatch(planAll);
        dayPlan.afternoon = dayPlan.afternoon || hasMatch(planAfternoon) || hasMatch(planAll);
        scheduleByDay.set(targetDate, dayPlan);
      });

      let absentCount = 0;
      let lateCount = 0;
      let earlyLeaveCount = 0;

      scheduleByDay.forEach((plan, dayKey) => {
        if (!plan?.planned) return;
        const logs = checkinByDay.get(dayKey) || [];
        if (!logs.length) {
          absentCount += 1;
          return;
        }

        const clockInTimes = logs
          .filter(x => x.type === 'clock_in')
          .map(x => x.date)
          .filter(d => d instanceof Date && Number.isFinite(d.getTime()));
        const clockOutTimes = logs
          .filter(x => x.type === 'clock_out')
          .map(x => x.date)
          .filter(d => d instanceof Date && Number.isFinite(d.getTime()));

        if (plan.morning && clockInTimes.length) {
          const firstIn = clockInTimes.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
          const lateMin = hrmsClockMinutesInShanghai(firstIn);
          if (Number.isFinite(lateMin) && lateMin > attWin.startMinutes) lateCount += 1;
        }

        if (plan.afternoon && clockOutTimes.length) {
          const lastOut = clockOutTimes.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
          const outMin = hrmsClockMinutesInShanghai(lastOut);
          if (Number.isFinite(outMin) && outMin < attWin.endMinutes) earlyLeaveCount += 1;
        }
      });

      let restDays = 0;
      restByDay.forEach((v) => {
        const n = Number(v || 0);
        if (Number.isFinite(n) && n > 0) restDays += n;
      });
      restDays = Number(restDays.toFixed(2));
      const _penaltyMap = await computeAttendanceMissingClockPenalties(month, myStore, req.tenantId || req.user?.tenant_id || 'default');
      const leaveBalance = calcEmployeeMonthlyLeaveBalance(state, me, month, {
        penalty: _penaltyMap.get(String(me?.username || '').trim().toLowerCase())
      });
      const monthRestRemaining = leaveBalance ? Number(leaveBalance.monthRemaining || 0) : Number((4 - restDays).toFixed(2));
      const cumulativeLeaveDays = leaveBalance ? Number(leaveBalance.cumulativeLeaveDays || 0) : 0;

      return res.json({
        month,
        username,
        name: myName || username,
        cumulativeLeaveDays: Number(cumulativeLeaveDays.toFixed(1)),
        cumulativeLeaveManualLock: !!leaveBalance?.cumulativeLeaveManualLock,
        absentCount,
        lateCount,
        earlyLeaveCount,
        restDays,
        monthRestRemaining,
        leave: leaveBalance ? {
          baseLeave: leaveBalance.baseLeave,
          annualLeave: leaveBalance.annualLeave,
          usedLeave: leaveBalance.usedLeave,
          totalLeave: leaveBalance.totalLeave,
          cumulativeLeaveDays: leaveBalance.cumulativeLeaveDays,
          monthRemaining: leaveBalance.monthRemaining,
          computedRemaining: leaveBalance.computedRemaining,
          remaining: leaveBalance.remaining,
          overridden: !!leaveBalance.overridden,
          cumulativeLeaveManualLock: !!leaveBalance.cumulativeLeaveManualLock,
          weeklyDetails: Array.isArray(leaveBalance.weeklyDetails) ? leaveBalance.weeklyDetails : [],
          lastAdjustment: leaveBalance.lastAdjustment || null
        } : null
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // API to manually override leave balance for an employee in a specific month
  app.post('/api/checkin/leave-balance', authRequired, async (req, res) => {
    const actor = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!(await requireHrmsPermission(req, res, 'reports.leave_owed.adjust', { getSharedState }))) return;
    const targetUsername = String(req.body?.username || '').trim();
    const month = String(req.body?.month || '').trim();
    const value = Number(req.body?.value);
    const mode = String(req.body?.mode || 'carryover').trim().toLowerCase();
    const note = String(req.body?.note || '').trim();
    if (!targetUsername || !month || !Number.isFinite(value)) {
      return res.status(400).json({ error: 'missing_params' });
    }
    if (mode !== 'remaining' && mode !== 'total_leave' && mode !== 'carryover') {
      return res.status(400).json({ error: 'invalid_mode' });
    }
    try {
      const state = (await getSharedState()) || {};
      const person = stateFindUserRecord(state, targetUsername) || await dbFindEmployeeRecord(targetUsername) || {};
      const before = calcEmployeeMonthlyLeaveBalance(state, person, month);
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
      const key = leaveBalanceOverrideKey(targetUsername, month);
      const legacyKeys = Object.keys(overrides).filter((k) => {
        const mm = String(k || '').match(/^(.+)_([0-9]{4}-[0-9]{2})$/);
        if (!mm) return false;
        if (String(mm[2] || '') !== month) return false;
        return String(mm[1] || '').trim().toLowerCase() === String(targetUsername || '').trim().toLowerCase() && k !== key;
      });
      for (const lk of legacyKeys) delete overrides[lk];

      overrides[key] = {
        mode,
        value: Number(value),
        updatedBy: actor,
        updatedAt: hrmsNowISO(),
        note
      };

      const logs = Array.isArray(state.leaveBalanceAdjustments) ? state.leaveBalanceAdjustments.slice() : [];
      const rec = {
        id: randomUUID(),
        key,
        month,
        targetUsername,
        targetName: String(person?.name || targetUsername).trim(),
        store: String(person?.store || '').trim(),
        oldValue,
        newValue: Number(value),
        mode,
        note,
        adjustedBy: actor,
        adjustedByRole: role,
        adjustedAt: hrmsNowISO()
      };
      logs.unshift(rec);

      const nextPatches = {
        leaveBalanceOverrides: overrides,
        leaveBalanceAdjustments: logs.slice(0, 5000)
      };
      // 累计假期（carryover）人工校准 = 当月「月初累计池」；同步写入「上月末」闭合键，使所有读快照/人工的口径一致，且当月内不再依赖公式滚动该池（次月1日定时快照会覆盖上月键，便于对账）
      if (mode === 'carryover') {
        const prevM = shiftMonth(month, -1);
        if (prevM) {
          const prevSnaps = state.leaveCumulativeCloseSnapshots && typeof state.leaveCumulativeCloseSnapshots === 'object'
            ? state.leaveCumulativeCloseSnapshots
            : {};
          const snapKey = leaveBalanceOverrideKey(targetUsername, prevM);
          nextPatches.leaveCumulativeCloseSnapshots = {
            ...prevSnaps,
            [snapKey]: {
              value: Number(Number(value).toFixed(2)),
              lockedAt: hrmsNowISO(),
              source: 'manual_carryover',
              closedMonth: prevM,
              openingMonth: month,
              note: note || ''
            }
          };
        }
      }

      await mergeSharedStateFields(nextPatches, { leaveBalanceAdjustments: 'id' });
      return res.json({ ok: true, key, value: Number(value), adjustment: rec });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // Monthly attendance confirmation flow
  app.post('/api/checkin/monthly-confirm', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (role !== 'store_manager' && role !== 'admin' && role !== 'hq_manager') {
      return res.status(403).json({ error: 'only_managers_can_confirm' });
    }
    const month = String(req.body?.month || '').trim();
    const store = String(req.body?.store || '').trim();
    const summary = req.body?.summary || {};
    if (!month) return res.status(400).json({ error: 'missing_month' });

    try {
      const state = (await getSharedState()) || {};
      const confirmations = Array.isArray(state.monthlyConfirmations) ? state.monthlyConfirmations : [];

      // Check if already submitted for this month+store
      const existing = confirmations.find(c => c.month === month && c.store === store && c.status !== 'rejected');
      if (existing) {
        return res.status(409).json({ error: 'already_submitted', id: existing.id });
      }

      const id = 'MC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
      const confirmation = {
        id,
        month,
        store: store || '',
        submitter: username,
        submitterRole: role,
        summary,
        status: 'pending_supervisor',
        createdAt: hrmsNowISO(),
        history: [{ action: 'submitted', by: username, at: hrmsNowISO() }]
      };

      // Create approval request for the monthly confirmation
      const applicant = stateFindUserRecord(state, username) || {};
      const applicantManager = String(applicant?.managerUsername || '').trim();
      const hrManagerUsername = pickHrManagerUsername(state);

      // Flow: store_manager submit → supervisor approve → HR confirm → auto-generate
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
              JSON.stringify({ month, store, summary, confirmationId: id }),
              'pending',
              JSON.stringify(chain),
              0,
              store || null,
              req.tenantId || req.user?.tenant_id || 'default'
            ]
          );
        } catch (dbErr) {
          console.error('Failed to create monthly confirm approval:', dbErr);
        }
      } else {
        confirmation.status = 'approved';
        confirmation.approvedAt = hrmsNowISO();
      }

      confirmations.push(confirmation);
      await mergeSharedStateFields({ monthlyConfirmations: [confirmation] }, { monthlyConfirmations: 'id' });

      // Send notification to first approver
      if (chain.length > 0) {
        await appendNotifications([{
          id: 'NOTIF-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          type: 'monthly_confirm',
          targetUser: chain[0],
          title: '【月度考勤确认】待审批',
          message: `${username} 提交了 ${month} ${store || '全部门店'} 的月度考勤确认，请审批。`,
          read: false,
          createdAt: hrmsNowISO()
        }]);
      }

      return res.json({ ok: true, confirmation });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/checkin/monthly-confirm', authRequired, async (req, res) => {
    const month = String(req.query?.month || '').trim();
    try {
      const state = (await getSharedState()) || {};
      const confirmations = Array.isArray(state.monthlyConfirmations) ? state.monthlyConfirmations : [];
      const filtered = month ? confirmations.filter(c => c.month === month) : confirmations;
      return res.json({ confirmations: filtered });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });
}
