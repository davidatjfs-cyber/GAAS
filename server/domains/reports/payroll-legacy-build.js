/**
 * Payroll report — legacy fallback: attendance + adjustments → sumMap.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'reports', handler: 'payroll-legacy-build' });

export function payrollRowKey(st, userLower) {
  return `${String(st || '').trim()}||${String(userLower || '').trim()}`;
}

export function buildLegacyPointMaps(state0, month, safeNumber) {
  const pointStoreByUser = new Map();
  const pointSubsidyByUserStore = new Map();
  const pointRecords = Array.isArray(state0?.pointRecords) ? state0.pointRecords : [];
  pointRecords.forEach((r) => {
    const recMonth = String(r?.approvedAt || r?.createdAt || '').slice(0, 7);
    if (recMonth !== month) return;
    const u = String(r?.username || '').trim().toLowerCase();
    const st = String(r?.store || '').trim();
    if (!u) return;
    if (st && !pointStoreByUser.has(u)) pointStoreByUser.set(u, st);
    const amountFromRecord = safeNumber(r?.amount);
    const points = safeNumber(r?.points) || 0;
    const subsidyAmount = amountFromRecord != null ? amountFromRecord : Number((points * 0.5).toFixed(2));
    if (!subsidyAmount) return;
    const subsidyKey = `${st || 'ALL'}||${u}`;
    const prevSubsidy = safeNumber(pointSubsidyByUserStore.get(subsidyKey)) || 0;
    pointSubsidyByUserStore.set(subsidyKey, Number((prevSubsidy + subsidyAmount).toFixed(2)));
  });
  return { pointStoreByUser, pointSubsidyByUserStore };
}

export async function loadLegacyAttendanceRows(ctx, {
  state0,
  month,
  store,
  tenantId,
  peopleByLower,
  knownUsers,
}) {
  const {
    pool,
    buildAttendanceFromCheckinRecords,
    buildAttendanceFromReports,
    inDateRange,
  } = ctx;

  const start = `${month}-01`;
  const [yr, mo] = month.split('-').map(Number);
  const end = `${month}-${String(new Date(yr, mo, 0).getDate()).padStart(2, '0')}`;

  try {
    let conditions = [`check_time >= $1::date`, `check_time < ($2::date + interval '1 day')`];
    let params = [start, end];
    let idx = 3;
    if (store) {
      conditions.push(`store = $${idx}`);
      params.push(store);
      idx++;
    }
    params.push(tenantId || 'default');
    conditions.push(`tenant_id = $${idx}`);
    const where = 'where ' + conditions.join(' and ');
    const checkinSql = `select username, store, check_time, status from checkin_records ${where} order by check_time desc`;
    const db = typeof pool === 'function' ? pool() : pool;
    const checkinRows = await db.query(checkinSql, params);
    const displayNameByLower = new Map();
    peopleByLower.forEach((p, lower) => {
      displayNameByLower.set(lower, String(p?.name || p?.username || '').trim());
    });
    const normalizedCheckins = (checkinRows.rows || []).map((r) => ({
      ...r,
      display_name: displayNameByLower.get(String(r?.username || '').trim().toLowerCase()) || String(r?.username || '').trim(),
    }));
    return buildAttendanceFromCheckinRecords(normalizedCheckins, { start, end, knownUsers });
  } catch (e) {
    log.warn({ msg: 'payroll_checkin_attendance_fallback', err: e?.message || String(e) });
    let items = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
    items = items.filter((r) => inDateRange(String(r?.date || '').trim(), start, end));
    if (store) items = items.filter((r) => String(r?.store || '').trim() === store);
    return buildAttendanceFromReports(items);
  }
}

export async function buildLegacyPayrollSumMap(ctx, {
  state0,
  month,
  store,
  tenantId,
  allPeople,
  knownUsers,
  canonicalUsernameByLower,
  attendanceRows,
  pointStoreByUser,
  pointSubsidyByUserStore,
}) {
  const {
    pool,
    stateFindUserRecord,
    isLegacyTestUsername,
    clampNum,
    safeNumber,
  } = ctx;

  const sumMap = new Map();
  for (const r of attendanceRows) {
    const st = String(r?.store || '').trim();
    const uRaw = String(r?.username || '').trim();
    const u = uRaw.toLowerCase();
    if (!st || !u) continue;
    if (!knownUsers.has(u)) continue;
    const canonicalUser = canonicalUsernameByLower.get(u) || uRaw;
    const key = payrollRowKey(st, u);
    const prev = sumMap.get(key) || { store: st, username: canonicalUser, name: String(r?.name || '').trim(), days: 0 };
    prev.days += clampNum(r?.days, 0);
    if (!prev.name) prev.name = String(r?.name || '').trim();
    sumMap.set(key, prev);
  }

  const approvalMonthById = new Map();
  try {
    const db = typeof pool === 'function' ? pool() : pool;
    const arRows = await db.query(
      `SELECT id::text AS id, to_char(COALESCE(effective_date, created_at::date), 'YYYY-MM') AS ym
         FROM approval_requests WHERE type = 'reward_punishment' AND tenant_id = $1`,
      [tenantId || 'default']
    );
    for (const r of (arRows.rows || [])) approvalMonthById.set(String(r.id), String(r.ym || ''));
  } catch (e) {
    log.warn({ msg: 'payroll_load_approval_months_failed', err: e?.message || String(e) });
  }

  const adjustmentMap = new Map();
  const adjRows = Array.isArray(state0?.salaryAdjustments) ? state0.salaryAdjustments : [];
  for (const a of adjRows) {
    if (!a || typeof a !== 'object') continue;
    const st = String(a?.status || '').trim().toLowerCase();
    if (st && st !== 'approved') continue;
    const target = String(a?.targetUsername || '').trim();
    if (!target) continue;
    if (isLegacyTestUsername(target)) continue;
    const apprId = String(a?.approvalId || '').trim();
    const ym = (apprId && approvalMonthById.get(apprId)) || String(a?.createdAt || a?.effectiveAt || '').slice(0, 7);
    if (ym !== month) continue;
    let signed = safeNumber(a?.signedAmount);
    if (signed == null) {
      const raw = Math.abs(safeNumber(a?.amount) || 0);
      const tp = String(a?.type || a?.rpType || '').trim().toLowerCase();
      const isPunish = tp.includes('惩罚') || tp.includes('punish');
      signed = isPunish ? -raw : raw;
    }
    const key = target.toLowerCase();
    adjustmentMap.set(key, (adjustmentMap.get(key) || 0) + (signed || 0));

    const rec = stateFindUserRecord(state0, target) || {};
    const recStore = String(rec?.store || '').trim();
    const canonicalTarget = canonicalUsernameByLower.get(key) || target;
    if (!store || recStore === store) {
      const attKey = payrollRowKey(recStore, key);
      if (!sumMap.has(attKey)) {
        sumMap.set(attKey, {
          store: recStore,
          username: canonicalTarget,
          name: String(rec?.name || canonicalTarget).trim(),
          days: 0,
        });
      }
    }
  }

  const payrollAdjMap = state0?.payrollAdjustments && typeof state0.payrollAdjustments === 'object' ? state0.payrollAdjustments : {};

  Object.entries(payrollAdjMap).forEach(([k, v]) => {
    const key = String(k || '').trim();
    const m = key.match(/^(\d{4}-\d{2})\|\|(.+)\|\|(.+)$/);
    if (!m) return;
    const keyMonth = String(m[1] || '').trim();
    const keyStore = String(m[2] || '').trim();
    const keyUser = String(m[3] || '').trim();
    const keyUserLower = keyUser.toLowerCase();
    if (keyMonth !== month || !keyUser) return;
    if (isLegacyTestUsername(keyUser)) return;
    const subsidy = safeNumber(v?.subsidy ?? v?.amount) || 0;
    if (!subsidy) return;
    const rec = stateFindUserRecord(state0, keyUser) || {};
    const recStore = String(keyStore && keyStore !== 'ALL' ? keyStore : (rec?.store || pointStoreByUser.get(keyUserLower) || '')).trim();
    if (store && recStore !== store) return;
    const canonicalUser = canonicalUsernameByLower.get(keyUserLower) || keyUser;
    const attKey = payrollRowKey(recStore, keyUserLower);
    if (!sumMap.has(attKey)) {
      sumMap.set(attKey, {
        store: recStore,
        username: canonicalUser,
        name: String(rec?.name || canonicalUser).trim(),
        days: 0,
      });
    }
  });

  allPeople.forEach((p) => {
    const rowUser = String(p?.username || '').trim();
    const rowUserLower = rowUser.toLowerCase();
    if (!rowUser || !knownUsers.has(rowUserLower)) return;

    const rowStore = String(p?.store || pointStoreByUser.get(rowUserLower) || '').trim();
    if (store && rowStore !== store) return;

    const salary = ctx.findUserSalary(state0, rowUser);
    const hasSalary = salary != null;
    const hasAdjustment = adjustmentMap.has(rowUserLower);
    const pointSubsidyByStore = safeNumber(pointSubsidyByUserStore.get(`${rowStore || 'ALL'}||${rowUserLower}`)) || 0;
    const pointSubsidyAllStore = rowStore ? (safeNumber(pointSubsidyByUserStore.get(`ALL||${rowUserLower}`)) || 0) : 0;
    const hasPointSubsidy = (pointSubsidyByStore + pointSubsidyAllStore) > 0;
    if (!hasSalary && !hasAdjustment && !hasPointSubsidy) return;

    const canonicalUser = canonicalUsernameByLower.get(rowUserLower) || rowUser;
    const attKey = payrollRowKey(rowStore, rowUserLower);
    if (!sumMap.has(attKey)) {
      sumMap.set(attKey, {
        store: rowStore,
        username: canonicalUser,
        name: String(p?.name || rowUser).trim(),
        days: 0,
      });
    }
  });

  return { sumMap, adjustmentMap, payrollAdjMap };
}
