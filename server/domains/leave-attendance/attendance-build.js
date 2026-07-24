import {
  hrmsClockMinutesInShanghai,
  hrmsAttendanceWindowMinutesForStore,
} from './clock-window.js';

export function isCountableCheckinStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return !s || s === 'normal' || s === 'confirmed' || s === 'no_gps';
}

export function shanghaiDateOnly(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
}

/** 上海时区当天 YYYY-MM-DD（与 safeDateOnly / offboarding 日期比较口径一致） */
export function shanghaiTodayDateOnly() {
  return shanghaiDateOnly(new Date());
}

export function normalizeAttendanceRegisterLineDetails(raw) {
  let lines = raw;
  if (typeof lines === 'string') {
    try { lines = JSON.parse(lines); } catch (e) { lines = []; }
  }
  return Array.isArray(lines) ? lines : [];
}

export function sortIsoDateList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((x) => String(x || '').trim()).filter(Boolean))).sort();
}

export function createAttendanceBuildHelpers({ clampNum, safeDateOnly, isLegacyTestUsername }) {
  function buildAttendanceFromReports(items) {
    const out = [];
    const map = new Map();

    const add = (store, date, staffArr) => {
      const list = Array.isArray(staffArr) ? staffArr : [];
      for (const it of list) {
        const user = String(it?.user || it?.username || '').trim();
        if (!user) continue;
        const name = String(it?.name || '').trim();
        const days = clampNum(it?.days, 1);
        const key = `${store}||${date}||${user}`;
        const prev = map.get(key);
        if (prev) {
          prev.days = clampNum(prev.days, 0) + (Number.isFinite(days) ? days : 1);
        } else {
          const rec = { store, date, username: user, name, days: Number.isFinite(days) ? days : 1 };
          map.set(key, rec);
          out.push(rec);
        }
      }
    };

    (Array.isArray(items) ? items : []).forEach(r => {
      const store = String(r?.store || '').trim();
      const date = String(r?.date || '').trim();
      if (!store || !date) return;
      const data = r?.data && typeof r.data === 'object' ? r.data : {};
      add(store, date, data?.staff?.front);
      add(store, date, data?.staff?.kitchen);
    });

    out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.store).localeCompare(String(b.store)) || String(a.username).localeCompare(String(b.username)));
    return out;
  }

  function buildAttendanceFromCheckinRecords(rows, options = {}) {
    const out = [];
    const map = new Map();
    const start = safeDateOnly(options?.start);
    const end = safeDateOnly(options?.end);
    const knownUsers = options?.knownUsers instanceof Set ? options.knownUsers : null;

    for (const row of (Array.isArray(rows) ? rows : [])) {
      const user = String(row?.username || '').trim();
      const userLower = user.toLowerCase();
      if (!user || isLegacyTestUsername(userLower)) continue;
      if (knownUsers && !knownUsers.has(userLower)) continue;
      if (!isCountableCheckinStatus(row?.status)) continue;
      const date = shanghaiDateOnly(row?.check_time);
      if (!date) continue;
      if (start && date < start) continue;
      if (end && date > end) continue;
      const store = String(row?.store || '').trim();
      if (!store) continue;
      const key = `${store}||${date}||${userLower}`;
      if (map.has(key)) continue;
      const rec = {
        store,
        date,
        username: user,
        name: String(row?.display_name || row?.name || user).trim(),
        days: 1
      };
      map.set(key, rec);
      out.push(rec);
    }

    out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.store).localeCompare(String(b.store)) || String(a.username).localeCompare(String(b.username)));
    return out;
  }

  function buildAttendanceSummaryRows(registerRows, checkinDetails) {
    const summaryMap = new Map();
    const checkinDayMap = new Map();

    const ensureSummary = (storeRaw, usernameRaw, nameRaw) => {
      const store = String(storeRaw || '').trim();
      const username = String(usernameRaw || '').trim();
      const name = String(nameRaw || username || '').trim();
      const identity = username ? username.toLowerCase() : name.toLowerCase();
      if (!identity) return null;
      const key = `${store}||${identity}`;
      let row = summaryMap.get(key);
      if (!row) {
        row = {
          store,
          username,
          name,
          actualDates: new Set(),
          absentDates: new Set(),
          lateDates: new Set(),
          restDates: new Set(),
          restOffsetDates: new Set(),
          anomalyPunches: 0,
          punchDays: new Set(),
          workFrac: new Map(),   // 日期 -> 上班天数（半天=0.5），来自台账 declared_days
          restFrac: new Map()    // 日期 -> 休息天数（半天=0.5）
        };
        summaryMap.set(key, row);
      } else {
        if (!row.username && username) row.username = username;
        if ((!row.name || row.name === row.username) && name) row.name = name;
        if (!row.store && store) row.store = store;
      }
      return row;
    };

    for (const regRow of (Array.isArray(registerRows) ? registerRows : [])) {
      const reportDate = String(regRow?.report_date || '').slice(0, 10);
      const store = String(regRow?.store || '').trim();
      if (!reportDate) continue;
      const lines = normalizeAttendanceRegisterLineDetails(regRow?.line_details);
      for (const line of lines) {
        const username = String(line?.username || line?.user || '').trim();
        const name = String(line?.display_name || line?.name || username).trim();
        const row = ensureSummary(store, username, name);
        if (!row) continue;
        const kind = String(line?.kind || '').trim();
        const declared = Number(line?.declared_days);
        const frac = Number.isFinite(declared) && declared > 0 ? declared : 1;
        if (kind === 'work') {
          row.actualDates.add(reportDate);
          row.workFrac.set(reportDate, (Number(row.workFrac.get(reportDate)) || 0) + frac);
        } else if (kind === 'absent') {
          row.absentDates.add(reportDate);
        } else if (kind === 'rest' || kind === 'leave_only') {
          row.restDates.add(reportDate);
          row.restOffsetDates.add(reportDate);
          row.restFrac.set(reportDate, (Number(row.restFrac.get(reportDate)) || 0) + frac);
        }
      }
    }

    for (const checkin of (Array.isArray(checkinDetails) ? checkinDetails : [])) {
      const username = String(checkin?.username || '').trim();
      const name = String(checkin?.display_name || checkin?.name || username).trim();
      const store = String(checkin?.store || '').trim();
      const date = shanghaiDateOnly(checkin?.check_time);
      const row = ensureSummary(store, username, name);
      if (!row || !date) continue;

      const dayKey = `${store}||${(username || name).trim().toLowerCase()}||${date}`;
      let day = checkinDayMap.get(dayKey);
      if (!day) {
        day = { store, date, firstIn: null, hasCountable: false, anomalyPunches: 0 };
        checkinDayMap.set(dayKey, day);
      }

      const status = String(checkin?.status || '').trim();
      if (isCountableCheckinStatus(status)) {
        day.hasCountable = true;
        row.punchDays.add(date);
        if (!row.actualDates.has(date) && !row.absentDates.has(date) && !row.restDates.has(date)) {
          row.actualDates.add(date);
        }
        if (String(checkin?.type || '').trim() === 'clock_in') {
          const dt = new Date(checkin.check_time);
          if (Number.isFinite(dt.getTime()) && (!day.firstIn || dt.getTime() < day.firstIn.getTime())) {
            day.firstIn = dt;
          }
        }
      }

      if (status && !['normal', 'no_gps', 'confirmed'].includes(status)) {
        day.anomalyPunches += 1;
      }
    }

    for (const row of summaryMap.values()) {
      const identity = String(row.username || row.name || '').trim().toLowerCase();
      if (!identity) continue;
      for (const [key, day] of checkinDayMap.entries()) {
        if (!key.startsWith(`${row.store}||${identity}||`)) continue;
        row.anomalyPunches += Number(day?.anomalyPunches || 0);
        if (day?.hasCountable && day?.firstIn && row.actualDates.has(day.date)) {
          const attWin = hrmsAttendanceWindowMinutesForStore(row.store);
          const firstInMinutes = hrmsClockMinutesInShanghai(day.firstIn);
          if (Number.isFinite(firstInMinutes) && firstInMinutes > attWin.startMinutes) {
            row.lateDates.add(day.date);
          }
        }
      }
    }

    return Array.from(summaryMap.values())
      .map((row) => {
        const actualDates = sortIsoDateList(Array.from(row.actualDates));
        const absentDates = sortIsoDateList(Array.from(row.absentDates));
        const lateDates = sortIsoDateList(Array.from(row.lateDates));
        const restDates = sortIsoDateList(Array.from(row.restDates));
        const restOffsetDates = sortIsoDateList(Array.from(row.restOffsetDates));
        // 半天精度：台账有 declared_days 用其分数，无台账记录（仅打卡推断）按整天计
        const sumFrac = (dates, fracMap) => Number(dates.reduce(
          (s, d) => s + (fracMap.has(d) ? Number(fracMap.get(d)) || 0 : 1), 0).toFixed(2));
        return {
          store: row.store,
          username: row.username,
          name: row.name || row.username,
          actualAttendanceDays: sumFrac(actualDates, row.workFrac),
          absenceDays: absentDates.length,
          lateDays: lateDates.length,
          restDays: sumFrac(restDates, row.restFrac),
          anomalyPunches: Number(row.anomalyPunches || 0),
          checkinDays: row.punchDays.size,
          actualDates,
          absentDates,
          lateDates,
          restDates,
          restOffsetDates
        };
      })
      .sort((a, b) => {
        if (String(a.store || '') !== String(b.store || '')) {
          return String(a.store || '').localeCompare(String(b.store || ''), 'zh-Hans-CN');
        }
        if (Number(b.absenceDays || 0) !== Number(a.absenceDays || 0)) {
          return Number(b.absenceDays || 0) - Number(a.absenceDays || 0);
        }
        if (Number(b.lateDays || 0) !== Number(a.lateDays || 0)) {
          return Number(b.lateDays || 0) - Number(a.lateDays || 0);
        }
        return String(a.name || a.username || '').localeCompare(String(b.name || b.username || ''), 'zh-Hans-CN');
      });
  }

  return {
    buildAttendanceFromReports,
    isCountableCheckinStatus,
    shanghaiDateOnly,
    buildAttendanceFromCheckinRecords,
    normalizeAttendanceRegisterLineDetails,
    sortIsoDateList,
    buildAttendanceSummaryRows,
  };
}
