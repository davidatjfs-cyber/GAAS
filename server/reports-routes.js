/**
 * Core business reports routes (extracted from index.js — monolith split).
 * registerReportsRoutes(app, deps) — behavior-preserving move.
 *
 * NOTE: This covers the "core business reports" cluster only — the
 * inventory-forecast/sales-raw sub-cluster under /api/reports/* stays in
 * index.js for a future, separate extraction.
 */

import {
  requireHrmsPermission,
  checkHrmsPermission,
  getTenantEnforcementMode,
  legacyCanAccessAnalyticsReports,
} from './services/hrms-permission-engine.js';

/** 离职日期统一为 YYYY-MM-DD，兼容 2026/4/5、ISO 前缀等，供本月离职判定 */
function normalizeEmployeeDepartureDateForTurnover(emp) {
  const raw = String(emp?.offboardingDate || emp?.resignedAt || '').trim();
  if (!raw) return '';
  const mIso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mIso) return mIso[1];
  const mSlash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (mSlash) {
    const y = mSlash[1];
    const mo = String(mSlash[2]).padStart(2, '0');
    const d = String(mSlash[3]).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  const mCn = raw.match(/^(\d{4})[年\-](\d{1,2})[月\-](\d{1,2})/);
  if (mCn) {
    return `${mCn[1]}-${String(mCn[2]).padStart(2, '0')}-${String(mCn[3]).padStart(2, '0')}`;
  }
  return '';
}

/** 洪潮「大宁久光店」与「久光店」等双轨店名与报表所选门店对齐 */
function employeeStoreMatchesTurnoverReportFilter(empStore, reportStore) {
  const rs = String(reportStore || '').trim();
  if (!rs) return true;
  const es = String(empStore || '').trim();
  if (!es) return false;
  return resolveAgentCanonicalStore(es) === resolveAgentCanonicalStore(rs);
}

/** 视为已离职：含 inactive/disabled 且已有离职日期（与账号停用口径一致）；或离职已审批（offboardingApproved）且有离职日期 */
function isEmployeeDepartedForTurnoverReport(emp) {
  const st = String(emp?.status || '').trim().toLowerCase();
  if (['离职', 'resigned', 'terminated', 'offboarded', 'left', 'departed'].includes(st)) return true;
  if (st === 'inactive' || st === 'disabled') {
    return !!normalizeEmployeeDepartureDateForTurnover(emp);
  }
  const approved = emp?.offboardingApproved === true || emp?.offboardingApproved === 'true' || emp?.offboardingApproved === 1;
  if (approved && normalizeEmployeeDepartureDateForTurnover(emp)) return true;
  return false;
}

/** 视为在职：active/onboard/probation，且未通过离职审批 */
function isEmployeeActiveLikeForTurnoverReport(emp) {
  const st = String(emp?.status || '').trim().toLowerCase();
  if (!st || st === 'active' || st === 'onboard' || st === 'probation') {
    const approved = emp?.offboardingApproved === true || emp?.offboardingApproved === 'true' || emp?.offboardingApproved === 1;
    if (approved && normalizeEmployeeDepartureDateForTurnover(emp)) return false;
    return true;
  }
  return false;
}

/**
 * 关键人才：与报表 A 区文案一致——① 档案勾选 coreTalent；② 职级 level ≥ 3（数字或可解析数字）；
 * ③ 职务/部门含管理类关键词；④ 店长/总部管理/出品与前厅负责人等 role。
 */
function isEmployeeCoreTalentForTurnoverReport(emp) {
  if (!emp || typeof emp !== 'object') return false;
  const c = emp.coreTalent;
  if (c === true || c === 'true' || c === 1) return true;

  const lvStr = String(emp.level ?? '').trim();
  if (lvStr) {
    let n = NaN;
    if (/^\d+$/.test(lvStr)) n = parseInt(lvStr, 10);
    else {
      const m = lvStr.match(/^L\s*(\d+)$/i) || lvStr.match(/(\d+)/);
      if (m) n = parseInt(m[1], 10);
    }
    if (Number.isFinite(n) && n >= 3) return true;
  }

  const blob = `${String(emp.position || '')} ${String(emp.department || '')}`;
  if (/经理|主管|店长|总监|负责人|厨师长|副店长|店助|店总|前厅经理|营运|督导|部长|主任|副理|值班经理|副厨|主厨|领班/i.test(blob)) {
    return true;
  }

  const r = String(emp.role || '').trim().toLowerCase();
  if (['store_manager', 'hq_manager', 'store_production_manager', 'front_manager'].includes(r)) return true;

  return false;
}

/** 离职员工是否不应计入指定薪资月。
 *  规则：以员工信息表里的 status 为准（管理员手动改的离职状态优先于 offboardingDate）：
 *  status 非 inactive/离职 → 一律保留（含已审但离职日未到者）；
 *  status=inactive/离职 → 当月有实际出勤才保留（末月结算），无出勤即排除。
 *  不再依赖 offboardingDate，避免审批时填的（可能与实际离职日不一致的）日期导致误判。 */
function isEmployeeDepartedForPayroll(emp, month, attendanceDays) {
  const m = safeMonthOnly(month);
  if (!m || !emp || typeof emp !== 'object') return false;
  const status = String(emp?.status || '').trim().toLowerCase();
  const inactive = status === 'inactive' || status === '离职';
  if (!inactive) return false;
  if (Number(attendanceDays) > 0) return false; // 已离职但当月有实际出勤 → 末月结算保留
  return true; // 已离职且当月无出勤 → 排除
}

// Module-level bindings needed by the standalone helper functions above
// (they are defined outside registerReportsRoutes, so they close over these).
let pool;
let safeMonthOnly;
let resolveAgentCanonicalStore;
let getSharedStateRef;

async function requireReportPerm(req, res, permission, store) {
  return requireHrmsPermission(req, res, permission, {
    store,
    getSharedState: getSharedStateRef,
  });
}

async function legacyAnalyticsGate(req, res, store) {
  const mode = await getTenantEnforcementMode(req.tenantId || req.user?.tenant_id);
  if (mode !== 'legacy') {
    return requireReportPerm(req, res, 'module.reports', store);
  }
  if (!legacyCanAccessAnalyticsReports(req.user?.role)) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

export function registerReportsRoutes(app, deps) {
  const {
    authRequired,
    getSharedState,
    mergeSharedStateFields,
    safeDateOnly,
    parseMonth,
    pickMyStoreFromState,
    stateFindUserRecord,
    stateOrDbFindUserRecord,
    dbListEmployeesForReports,
    calcEmployeeMonthlyLeaveBalance,
    computeAttendanceMissingClockPenalties,
    buildAttendanceFromCheckinRecords,
    buildAttendanceFromReports,
    buildAttendanceSummaryRows,
    summarizeDailyRegisterForEmployee,
    filterDailyRegisterRowsByEmployee,
    expandAgentStoreLabels,
    isLegacyTestUsername,
    canAccessBusinessReports: _canAccessBusinessReports,
    canAccessAnalyticsReports: _canAccessAnalyticsReports,
    canAccessDailyAttendanceRegister: _canAccessDailyAttendanceRegister,
    isAdmin,
    isHq,
    inDateRange,
    clampNum,
    safeNumber,
    findUserSalary,
    hrmsNowISO,
    randomUUID,
    sendWeeklyReports,
    sendMonthlyReports,
    sendTestReportsToUser,
    buildPayrollForMonth,
  } = deps;
  pool = deps.pool;
  safeMonthOnly = deps.safeMonthOnly;
  resolveAgentCanonicalStore = deps.resolveAgentCanonicalStore;
  getSharedStateRef = getSharedState;

  // 手动触发 BI 周报 / 月报（仅管理员，用于测试）
  app.post('/api/reports/bi/trigger-weekly', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
      await sendWeeklyReports(req.tenantId || req.user?.tenant_id || 'default');
      return res.json({ ok: true, triggered: 'weekly' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/reports/bi/trigger-monthly', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
      await sendMonthlyReports(req.tenantId || req.user?.tenant_id || 'default');
      return res.json({ ok: true, triggered: 'monthly' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/reports/bi/test-send', authRequired, async (req, res) => {
    try {
      const role = String(req.user?.role || '').trim();
      if (role !== 'admin') return res.status(403).json({ error: 'admin_only' });
      const targetUsername = String(req.body?.username || '').trim();
      if (!targetUsername) return res.status(400).json({ error: 'missing_username' });
      const result = await sendTestReportsToUser(targetUsername, req.tenantId || req.user?.tenant_id || 'default');
      return res.json(result);
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/reports/business', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQBiz = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.business.view', storeQBiz))) return;

    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    if (!start || !end) return res.status(400).json({ error: 'missing_range' });
    const storeQ = String(req.query?.store || '').trim();

    try {
      const state0 = (await getSharedState()) || {};
      const myStore = pickMyStoreFromState(state0, username);
      const _allowedStores10245 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore10245 = String(req.user?.current_store || '').trim();
      const store = role === 'store_manager'
        ? (storeQ && _allowedStores10245.includes(storeQ) ? storeQ : (_currentStore10245 || myStore))
        : storeQ;
      let items = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
      items = items.filter(r => inDateRange(String(r?.date || '').trim(), start, end));
      if (store) items = items.filter(r => String(r?.store || '').trim() === store);

      const emptyAgg = (st) => ({
        store: st, days: 0, budget: 0, gross: 0, actual: 0,
        discount: 0, discountDine: 0, discountDelivery: 0,
        rechargeCount: 0, rechargeAmount: 0,
        newWechatMembers: 0,
        dineRevenue: 0, dineOrders: 0, dineTraffic: 0,
        segNoon: 0, segAfternoon: 0, segNight: 0,
        catWaterAmt: 0, catWaterQty: 0, catSoupAmt: 0, catSoupQty: 0,
        catRoastAmt: 0, catRoastQty: 0, catWokAmt: 0, catWokQty: 0,
        elemeOrders: 0, elemeRevenue: 0, elemeActual: 0, elemeTarget: 0,
        meituanOrders: 0, meituanRevenue: 0, meituanActual: 0, meituanTarget: 0,
        badDianping: 0, badMeituan: 0, badEleme: 0,
        laborTotal: 0,
        dianpingRatingSum: 0,
        dianpingRatingCount: 0
      });

      const byStore = new Map();
      items.forEach(r => {
        const st = String(r?.store || '').trim();
        if (!st) return;
        const data = r?.data && typeof r.data === 'object' ? r.data : {};
        const prev = byStore.get(st) || emptyAgg(st);
        prev.days += 1;
        prev.budget += clampNum(data?.budget, 0);
        prev.gross += clampNum(data?.gross, 0);
        prev.actual += clampNum(data?.actual, 0);
        prev.discount += clampNum(data?.discount?.total, 0);
        prev.discountDine += clampNum(data?.discount?.dine, 0);
        prev.discountDelivery += clampNum(data?.discount?.delivery, 0);
        prev.rechargeCount += clampNum(data?.recharge?.count, 0);
        prev.rechargeAmount += clampNum(data?.recharge?.amount, 0);
        prev.newWechatMembers += clampNum(data?.new_wechat_members, 0);
        prev.dineRevenue += clampNum(data?.dine?.revenue, 0);
        prev.dineOrders += clampNum(data?.dine?.orders, 0);
        prev.dineTraffic += clampNum(data?.dine?.traffic, 0);
        prev.segNoon += clampNum(data?.segments?.noon, 0);
        prev.segAfternoon += clampNum(data?.segments?.afternoon, 0);
        prev.segNight += clampNum(data?.segments?.night, 0);
        prev.catWaterAmt += clampNum(data?.categories?.water?.amt, 0);
        prev.catWaterQty += clampNum(data?.categories?.water?.qty, 0);
        prev.catSoupAmt += clampNum(data?.categories?.soup?.amt, 0);
        prev.catSoupQty += clampNum(data?.categories?.soup?.qty, 0);
        prev.catRoastAmt += clampNum(data?.categories?.roast?.amt, 0);
        prev.catRoastQty += clampNum(data?.categories?.roast?.qty, 0);
        prev.catWokAmt += clampNum(data?.categories?.wok?.amt, 0);
        prev.catWokQty += clampNum(data?.categories?.wok?.qty, 0);
        prev.elemeOrders += clampNum(data?.delivery?.eleme?.orders, 0);
        prev.elemeRevenue += clampNum(data?.delivery?.eleme?.revenue, 0);
        prev.elemeActual += clampNum(data?.delivery?.eleme?.actual, 0);
        prev.elemeTarget += clampNum(data?.delivery?.eleme?.targetRevenue, 0);
        prev.meituanOrders += clampNum(data?.delivery?.meituan?.orders, 0);
        prev.meituanRevenue += clampNum(data?.delivery?.meituan?.revenue, 0);
        prev.meituanActual += clampNum(data?.delivery?.meituan?.actual, 0);
        prev.meituanTarget += clampNum(data?.delivery?.meituan?.targetRevenue, 0);
        prev.badDianping += clampNum(data?.badReviews?.dianping, 0);
        prev.badMeituan += clampNum(data?.badReviews?.meituan, 0);
        prev.badEleme += clampNum(data?.badReviews?.eleme, 0);
        prev.laborTotal += clampNum(data?.laborTotal, 0);
        const drStar = data?.dianping_rating;
        const drN = drStar != null && drStar !== '' ? Number(drStar) : NaN;
        if (Number.isFinite(drN)) {
          prev.dianpingRatingSum += drN;
          prev.dianpingRatingCount += 1;
        }
        byStore.set(st, prev);
      });

      const rows = Array.from(byStore.values()).sort((a, b) => String(a.store).localeCompare(String(b.store), 'zh-Hans-CN'));
      const computeDerived = (x) => {
        x.budgetRate = x.budget > 0 ? (x.gross / x.budget) : 0;
        x.efficiency = x.laborTotal > 0 ? (x.gross / x.laborTotal) : 0;
        x.dineAvgTable = x.dineOrders > 0 ? (x.dineRevenue / x.dineOrders) : 0;
        x.dineAvgPerson = x.dineTraffic > 0 ? (x.dineRevenue / x.dineTraffic) : 0;
        x.discountRate = x.gross > 0 ? (x.discount / x.gross) : 0;
        x.avgDianpingRating =
          x.dianpingRatingCount > 0 ? (x.dianpingRatingSum / x.dianpingRatingCount) : null;
      };
      rows.forEach(computeDerived);

      const sumKeys = ['days','budget','gross','actual','discount','discountDine','discountDelivery','rechargeCount','rechargeAmount','newWechatMembers','dineRevenue','dineOrders','dineTraffic','segNoon','segAfternoon','segNight','catWaterAmt','catWaterQty','catSoupAmt','catSoupQty','catRoastAmt','catRoastQty','catWokAmt','catWokQty','elemeOrders','elemeRevenue','elemeActual','elemeTarget','meituanOrders','meituanRevenue','meituanActual','meituanTarget','badDianping','badMeituan','badEleme','laborTotal','dianpingRatingSum','dianpingRatingCount'];
      const total = emptyAgg('合计');
      rows.forEach(x => { sumKeys.forEach(k => { total[k] += (x[k] || 0); }); });
      computeDerived(total);

      // monthly targets from state
      let monthlyTargets = null;
      try {
        const stSettings = state0.settings && typeof state0.settings === 'object' ? state0.settings : {};
        const mt = Array.isArray(stSettings.monthlyTargets) ? stSettings.monthlyTargets : (Array.isArray(state0.monthlyTargets) ? state0.monthlyTargets : []);
        const ym = start.slice(0, 7);
        const tgt = mt.find(t => {
          const tMonth = String(t?.ym || t?.month || '').trim();
          const tStore = String(t?.store || '').trim();
          return tMonth === ym && (!store || tStore === store);
        });
        if (tgt) monthlyTargets = tgt.targets || null;
      } catch (e) {}

      // budget info from state
      let budgetInfo = null;
      try {
        const budgets = Array.isArray(state0.paymentBudgets) ? state0.paymentBudgets : [];
        const ym = start.slice(0, 7);
        const b = budgets.find(x => String(x?.month || '').trim() === ym && (!store || String(x?.store || '').trim() === store));
        if (b) budgetInfo = b;
      } catch (e) {}

      // budget execution: all categories for this store/month with actual usage
      let budgetExecution = [];
      try {
        const budgets = Array.isArray(state0.paymentBudgets) ? state0.paymentBudgets : [];
        const ym = start.slice(0, 7);
        const matched = budgets.filter(x => String(x?.month || '').trim() === ym && (!store || String(x?.store || '').trim() === store));
        if (matched.length > 0) {
          // query actual usage from approval_requests for approved+paid payments
          const usageParams = store ? [store, ym] : [ym];
          const storeClause = store ? "(payload->>'store') = $1 AND" : '';
          const monthParam = store ? '$2' : '$1';
          usageParams.push(req.tenantId || req.user?.tenant_id || 'default');
          const tenantParam = `$${usageParams.length}`;
          const usageResult = await pool.query(
            `SELECT (payload->>'category') as category,
                    COALESCE(SUM(NULLIF(payload->>'amount','')::numeric), 0)::float as used
             FROM approval_requests
             WHERE type = 'payment'
               AND status IN ('approved','paid')
               AND ${storeClause}
               substring(payload->>'date', 1, 7) = ${monthParam}
               AND tenant_id = ${tenantParam}
             GROUP BY (payload->>'category')`,
            usageParams
          );
          const usageMap = {};
          for (const row of (usageResult.rows || [])) {
            usageMap[String(row.category || '').trim()] = Number(row.used || 0);
          }
          budgetExecution = matched.map(b => {
            const cat = String(b.category || '').trim();
            const budgetAmt = Number(b.amount || 0);
            const used = Number(usageMap[cat] || 0);
            const remaining = budgetAmt - used;
            const rate = budgetAmt > 0 ? (used / budgetAmt) : 0;
            return { category: cat, budget: budgetAmt, used, remaining, rate };
          });
        }
      } catch (e) {}

      return res.json({ start, end, store: store || '', rows, total, monthlyTargets, budgetInfo, budgetExecution });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // ── Turnover Analysis Report ──
  app.get('/api/reports/turnover', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQTurn = String(req.query?.store || '').trim();
    if (!(await legacyAnalyticsGate(req, res, storeQTurn))) return;

    const month = String(req.query?.month || '').trim(); // e.g. "2026-02"
    const storeQ = String(req.query?.store || '').trim();
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'missing_month' });

    try {
      const state0 = (await getSharedState()) || {};
      const myStore = pickMyStoreFromState(state0, username);
      const _allowedStores10498 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore10498 = String(req.user?.current_store || '').trim();
      const store = role === 'store_manager'
        ? (storeQ && _allowedStores10498.includes(storeQ) ? storeQ : (_currentStore10498 || myStore))
        : storeQ;

      let allEmployees = Array.isArray(state0.employees) ? state0.employees : [];
      const dbEmps = await dbListEmployeesForReports({ store: store || '', includeInactive: true, tenantId: req.tenantId || req.user?.tenant_id || 'default' });
      if (dbEmps.length) {
        const stateEmpByLower = new Map(allEmployees.map(e => [String(e?.username || '').trim().toLowerCase(), e]));
        const merged = [];
        const seen = new Set();
        for (const dbEmp of dbEmps) {
          const lower = String(dbEmp?.username || '').trim().toLowerCase();
          if (!lower || seen.has(lower)) continue;
          seen.add(lower);
          const stateEmp = stateEmpByLower.get(lower);
          if (stateEmp) {
            const lv =
              String(stateEmp?.level || '').trim() ||
              String(dbEmp?.level || '').trim();
            merged.push({
              ...dbEmp,
              ...stateEmp,
              status: String(stateEmp?.status || dbEmp?.status || ''),
              offboardingDate: stateEmp?.offboardingDate || dbEmp?.offboardingDate || '',
              offboardingApproved: stateEmp?.offboardingApproved ?? dbEmp?.offboardingApproved ?? dbEmp?.extra_json?.offboardingApproved ?? undefined,
              resignedAt: stateEmp?.resignedAt || dbEmp?.resignedAt || '',
              coreTalent: stateEmp?.coreTalent ?? dbEmp?.coreTalent ?? dbEmp?.extra_json?.coreTalent ?? false,
              level: lv
            });
          } else {
            merged.push(dbEmp);
          }
        }
        for (const e of allEmployees) {
          const lower = String(e?.username || '').trim().toLowerCase();
          if (!lower || seen.has(lower)) continue;
          seen.add(lower);
          merged.push(e);
        }
        allEmployees = merged;
      }
      const [yr, mo] = month.split('-').map(Number);
      const monthStart = new Date(yr, mo - 1, 1);
      const monthEnd = new Date(yr, mo, 0); // last day of month

      // Filter employees by store（与 v2-store-alignment 一致：洪潮大宁久光店 ↔ 洪潮久光店 等）
      const storeEmps = store
        ? allEmployees.filter((e) => employeeStoreMatchesTurnoverReportFilter(e?.store, store))
        : allEmployees;

      // ── Step 1: query offboarding approvals for this month (used by both departed & voluntary sections) ──
      const offDeparted = new Map(); // username → { resignDate, reason, isVoluntary }
      try {
        const obRes = await pool.query(
          `SELECT applicant_username, payload, status
           FROM approval_requests
           WHERE type = 'offboarding'
             AND status IN ('approved', 'pending')
             AND substring(COALESCE(
               payload->>'resignDate', payload->>'date', payload->>'resignationDate',
               created_at::text
             ), 1, 7) = $1
             AND tenant_id = $2
           ORDER BY created_at DESC`,
          [month, req.tenantId || req.user?.tenant_id || 'default']
        );
        for (const ob of (obRes.rows || [])) {
          const p = typeof ob.payload === 'string' ? JSON.parse(ob.payload) : (ob.payload || {});
          const uname = String(ob.applicant_username || p?.username || p?.applicant || '').trim().toLowerCase();
          if (!uname || offDeparted.has(uname)) continue;
          const rd = safeDateOnly(p?.resignDate || p?.date || p?.resignationDate);
          const reason = String(p?.reason || '').trim();
          const depType = String(p?.departureType || '').trim();
          let isVoluntary = true;
          if (depType === 'involuntary' || depType === '被动') isVoluntary = false;
          else if (/劝退|辞退|裁员|开除|解雇|淘汰/.test(reason)) isVoluntary = false;
          offDeparted.set(uname, { resignDate: rd, reason, isVoluntary });
        }
      } catch (_) {}

      // ── Step 2: ensure offboarding applicants are in storeEmps ──
      const empByLower = new Map(storeEmps.map(e => [String(e?.username || '').trim().toLowerCase(), e]));
      for (const [uname, info] of offDeparted) {
        if (!empByLower.has(uname)) {
          const stateEmp = Array.isArray(state0.employees) ? state0.employees.find(e => String(e?.username || '').toLowerCase() === uname) : null;
          const emp = stateEmp || {};
          emp.username = emp.username || uname;
          emp.name = emp.name || uname;
          emp.status = emp.status || '离职';
          emp.offboardingDate = emp.offboardingDate || info.resignDate || '';
          emp.resignedAt = emp.resignedAt || info.resignDate || '';
          storeEmps.push(emp);
          empByLower.set(uname, emp);
        }
      }

      // ── Step 2b: employment_records 离职（部分流程只写 PG、未同步 state 的离职日/状态）──
      try {
        const labels = store
          ? [...new Set(expandAgentStoreLabels(store).map((s) => String(s).trim()).filter(Boolean))]
          : [];
        const erParams = [month];
        let erSql = `
          SELECT DISTINCT ON (lower(trim(employee_username)))
            employee_username AS username,
            employee_name AS name,
            trim(store) AS store,
            position, department,
            action_date::text AS "actionDate",
            action_type
          FROM employment_records
          WHERE lower(trim(action_type)) IN ('resign', 'terminate', 'termination')
            AND (
              lower(trim(coalesce(status, ''))) = 'approved'
              OR trim(coalesce(status, '')) = ''
              OR status IS NULL
            )
            AND to_char(action_date, 'YYYY-MM') = $1`;
        if (labels.length) {
          erParams.push(labels);
          erSql += ` AND trim(store) = ANY($${erParams.length}::text[])`;
        }
        erParams.push(req.tenantId || req.user?.tenant_id || 'default');
        erSql += ` AND tenant_id = $${erParams.length}`;
        erSql += ` ORDER BY lower(trim(employee_username)), action_date DESC`;
        const erRes = await pool.query(erSql, erParams);
        for (const row of erRes.rows || []) {
          const un = String(row.username || '').trim().toLowerCase();
          if (!un) continue;
          const synDate = normalizeEmployeeDepartureDateForTurnover({
            offboardingDate: row.actionDate,
            resignedAt: row.actionDate
          });
          if (!synDate || synDate < month + '-01' || synDate > month + '-31') continue;
          const existing = empByLower.get(un);
          if (existing) {
            if (!normalizeEmployeeDepartureDateForTurnover(existing)) {
              existing.offboardingDate = existing.offboardingDate || row.actionDate;
              existing.resignedAt = existing.resignedAt || row.actionDate;
            }
            const st0 = String(existing.status || '').trim().toLowerCase();
            if (!isEmployeeDepartedForTurnoverReport(existing) && synDate) {
              existing.status = '离职';
            }
            continue;
          }
          const syn = {
            username: row.username,
            name: row.name || row.username,
            store: String(row.store || '').trim(),
            position: String(row.position || '').trim(),
            department: String(row.department || '').trim(),
            role: '',
            level: '',
            status: '离职',
            offboardingDate: synDate,
            resignedAt: synDate,
            joinDate: '',
            coreTalent: false
          };
          storeEmps.push(syn);
          empByLower.set(un, syn);
        }
      } catch (e) {
        console.warn('[reports/turnover] employment_records merge:', e?.message);
      }

      // ── Identify departed employees this month ──
      const departedThisMonth = storeEmps.filter((e) => {
        if (!isEmployeeDepartedForTurnoverReport(e)) return false;
        const depDate = normalizeEmployeeDepartureDateForTurnover(e);
        if (!depDate) return false;
        return depDate >= month + '-01' && depDate <= month + '-31';
      });

      // Total active employees at start of month (active + those who departed this month)
      const activeOrDepartedThisMonth = storeEmps.filter((e) => {
        if (isEmployeeActiveLikeForTurnoverReport(e)) return true;
        if (isEmployeeDepartedForTurnoverReport(e)) {
          const depDate = normalizeEmployeeDepartureDateForTurnover(e);
          if (depDate && depDate >= month + '-01') return true;
        }
        return false;
      });
      const totalHeadcount = activeOrDepartedThisMonth.length;
      const totalDeparted = departedThisMonth.length;
      const overallTurnoverRate = totalHeadcount > 0 ? totalDeparted / totalHeadcount : 0;

      // ── A. Critical Talent Turnover ──
      // 与报表文案一致：勾选 coreTalent，或职级≥3，或管理职务/关键 role（见 isEmployeeCoreTalentForTurnoverReport）
      const isCoreTalent = isEmployeeCoreTalentForTurnoverReport;
      const coreTalentAll = activeOrDepartedThisMonth.filter(isCoreTalent);
      const coreTalentDeparted = departedThisMonth.filter(isCoreTalent);
      const criticalTurnoverRate = coreTalentAll.length > 0 ? coreTalentDeparted.length / coreTalentAll.length : 0;

      // ── B. New Hire Retention ──
      // New hire: joinDate within 3 months before end of report month
      const threeMonthsAgo = new Date(yr, mo - 4, 1); // 3 months before month start
      const threeMonthsAgoStr = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;
      const isNewHire = (e) => {
        const jd = String(e?.joinDate || e?.createdAt || '').trim().slice(0, 10);
        if (!jd) return false;
        return jd >= threeMonthsAgoStr && jd <= month + '-31';
      };
      const newHireAll = activeOrDepartedThisMonth.filter(isNewHire);
      const newHireDeparted = departedThisMonth.filter(isNewHire);
      const newHireTurnoverRate = newHireAll.length > 0 ? newHireDeparted.length / newHireAll.length : 0;
      const newHireRetentionRate = 1 - newHireTurnoverRate;

      // ── C. Voluntary vs Involuntary ──
      let voluntaryCount = 0;
      let involuntaryCount = 0;
      const departedDetails = [];

      for (const [uname, info] of offDeparted) {
        const empRec = empByLower.get(uname.toLowerCase()) || null;
        if (store && empRec && !employeeStoreMatchesTurnoverReportFilter(empRec?.store, store)) continue;

        if (info.isVoluntary) voluntaryCount++;
        else involuntaryCount++;

        departedDetails.push({
          username: uname,
          name: String(empRec?.name || uname).trim(),
          store: String(empRec?.store || '').trim(),
          position: String(empRec?.position || '').trim(),
          level: String(empRec?.level || '').trim(),
          joinDate: String(empRec?.joinDate || empRec?.createdAt || '').trim().slice(0, 10),
          departureDate: info.resignDate || '',
          reason: info.reason,
          departureType: info.isVoluntary ? 'voluntary' : 'involuntary',
          isCoreTalent: empRec ? !!isCoreTalent(empRec) : false,
          isNewHire: empRec ? isNewHire(empRec) : false
        });
      }

      if (voluntaryCount === 0 && involuntaryCount === 0 && totalDeparted > 0) {
        voluntaryCount = totalDeparted;
      }

      const totalDepartedForRatio = voluntaryCount + involuntaryCount;
      const voluntaryRate = totalDepartedForRatio > 0 ? voluntaryCount / totalDepartedForRatio : 0;
      const involuntaryRate = totalDepartedForRatio > 0 ? involuntaryCount / totalDepartedForRatio : 0;

      // ── Store breakdown ──（按规范店名归组，避免洪潮双轨店名拆成两行）
      const stores = [
        ...new Set(
          storeEmps
            .map((e) => resolveAgentCanonicalStore(String(e?.store || '').trim()) || String(e?.store || '').trim())
            .filter(Boolean)
        )
      ];
      const storeBreakdown = stores.map((s) => {
        const sEmps = activeOrDepartedThisMonth.filter(
          (e) => (resolveAgentCanonicalStore(String(e?.store || '').trim()) || String(e?.store || '').trim()) === s
        );
        const sDep = departedThisMonth.filter(
          (e) => (resolveAgentCanonicalStore(String(e?.store || '').trim()) || String(e?.store || '').trim()) === s
        );
        const sCore = sEmps.filter(isCoreTalent);
        const sCoreDep = sDep.filter(isCoreTalent);
        const sNew = sEmps.filter(isNewHire);
        const sNewDep = sDep.filter(isNewHire);
        return {
          store: s,
          headcount: sEmps.length,
          departed: sDep.length,
          turnoverRate: sEmps.length > 0 ? sDep.length / sEmps.length : 0,
          coreTalentTotal: sCore.length,
          coreTalentDeparted: sCoreDep.length,
          criticalRate: sCore.length > 0 ? sCoreDep.length / sCore.length : 0,
          newHireTotal: sNew.length,
          newHireDeparted: sNewDep.length,
          newHireRetention: sNew.length > 0 ? 1 - (sNewDep.length / sNew.length) : 1
        };
      });

      return res.json({
        month,
        store: store || '',
        totalHeadcount,
        totalDeparted,
        overallTurnoverRate,
        criticalTalent: {
          total: coreTalentAll.length,
          departed: coreTalentDeparted.length,
          rate: criticalTurnoverRate
        },
        newHire: {
          total: newHireAll.length,
          departed: newHireDeparted.length,
          turnoverRate: newHireTurnoverRate,
          retentionRate: newHireRetentionRate
        },
        voluntaryInvoluntary: {
          voluntary: voluntaryCount,
          involuntary: involuntaryCount,
          voluntaryRate,
          involuntaryRate
        },
        departedDetails,
        storeBreakdown
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/reports/leave-owed', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const filterStoreLeave = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.leave_owed.view', filterStoreLeave))) return;

    const month = safeMonthOnly(req.query?.month || '') || hrmsNowISO().slice(0, 7);
    const filterStore = String(req.query?.store || '').trim();
    const includeInactive = String(req.query?.includeInactive || '').trim() === '1';

    try {
      const state0 = (await getSharedState()) || {};
      const myStore = pickMyStoreFromState(state0, username);
      const _allowedStores10814 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore10814 = String(req.user?.current_store || '').trim();
      const store = role === 'store_manager'
        ? (filterStore && _allowedStores10814.includes(filterStore) ? filterStore : (_currentStore10814 || myStore))
        : filterStore;

      const emps = Array.isArray(state0?.employees) ? state0.employees : [];
      const users = Array.isArray(state0?.users) ? state0.users : [];
      const map = new Map();
      users.forEach((u) => {
        const k = String(u?.username || '').trim().toLowerCase();
        if (!k || isLegacyTestUsername(k)) return;
        if (!map.has(k)) map.set(k, { ...u, username: String(u?.username || '').trim() });
      });
      emps.forEach((e) => {
        const k = String(e?.username || '').trim().toLowerCase();
        if (!k || isLegacyTestUsername(k)) return;
        map.set(k, { ...(map.get(k) || {}), ...e, username: String(e?.username || '').trim() });
      });

      let people = Array.from(map.values());
      if (!people.length) {
        try {
          const params = [];
          const where = [];
          if (store) {
            params.push(store);
            where.push(`store = $${params.length}`);
          }
          if (!includeInactive) {
            where.push(`(coalesce(status, '') not in ('inactive', '离职') AND NOT COALESCE((extra_json->>'offboardingApproved')::boolean, false))`);
          }
          params.push(req.tenantId || req.user?.tenant_id || 'default');
          where.push(`tenant_id = $${params.length}`);
          const sql = `select username, name, role, store, department, position, status,
                              join_date as "joinDate", created_at as "createdAt"
                         from employees
                         ${where.length ? ('where ' + where.join(' and ')) : ''}
                        order by name asc, username asc`;
          const dbRows = await pool.query(sql, params);
          people = Array.isArray(dbRows.rows) ? dbRows.rows : [];
        } catch (_) {}
      }
      if (store) people = people.filter(p => String(p?.store || '').trim() === store);
      if (!includeInactive) {
        people = people.filter(p => {
          const st = String(p?.status || '').trim().toLowerCase();
          if (st === 'inactive' || st === '离职') return false;
          const ob = p?.offboardingApproved === true || String(p?.offboardingApproved || '').trim().toLowerCase() === 'true';
          if (ob) return false;
          return true;
        });
      }

      const penaltyMap = await computeAttendanceMissingClockPenalties(month, store, req.tenantId || req.user?.tenant_id || 'default');
      const tidLeave = req.tenantId || req.user?.tenant_id || 'default';
      const dbLeave = typeof pool === 'function' ? pool() : pool;
      let summarizeAttMonth = null;
      let listAttRestDays = null;
      try {
        const mod = await import('./services/hrms-attendance-day.js');
        summarizeAttMonth = mod.summarizeAttendanceDaysForMonth;
        listAttRestDays = mod.listAttendanceRestDaysForMonth;
      } catch (_) {}
      const rows = [];
      for (const p of people) {
        const penalty = penaltyMap.get(String(p?.username || '').trim().toLowerCase());
        let attendanceRestDays = null;
        let attendanceRestDetails = null;
        if (typeof listAttRestDays === 'function') {
          try {
            const details = await listAttRestDays({
              tenantId: tidLeave,
              username: p.username,
              month,
              db: dbLeave
            });
            if (Array.isArray(details) && details.length) {
              attendanceRestDetails = details;
              attendanceRestDays = details.reduce((s, d) => s + Number(d?.days || 0), 0);
            }
          } catch (_) {}
        }
        if (attendanceRestDays == null && typeof summarizeAttMonth === 'function') {
          try {
            const att = await summarizeAttMonth({
              tenantId: tidLeave,
              username: p.username,
              month,
              db: dbLeave
            });
            if (att && Number.isFinite(Number(att.restDays))) attendanceRestDays = Number(att.restDays);
          } catch (_) {}
        }
        const bal = calcEmployeeMonthlyLeaveBalance(state0, p, month, { penalty, attendanceRestDays, attendanceRestDetails }) || {
          baseLeave: 0, annualLeave: 0, usedLeave: 0, totalLeave: 0, computedRemaining: 0, remaining: 0, overridden: false, weeklyDetails: [], lastAdjustment: null
        };
        const remaining = Number(bal?.remaining || 0);
        const joinDate = String(p?.joinDate || p?.hireDate || p?.startDate || p?.entryDate || p?.onboardDate || p?.joiningDate || p?.createdAt || '').trim();
        rows.push({
          username: String(p?.username || '').trim(),
          name: String(p?.name || p?.username || '').trim(),
          role: String(p?.role || '').trim(),
          store: String(p?.store || '').trim(),
          department: String(p?.department || '').trim(),
          position: String(p?.position || '').trim(),
          status: String(p?.status || 'active').trim() || 'active',
          baseLeave: bal.baseLeave,
          annualLeave: bal.annualLeave,
          usedLeave: bal.usedLeave,
          totalLeave: bal.totalLeave,
          actualRestDays: bal.usedLeave,
          holidayDays: bal.totalLeave,
          cumulativeLeaveDays: Number(bal?.cumulativeLeaveDays || 0),
          monthRemaining: Number(bal?.monthRemaining || 0),
          computedRemaining: bal.computedRemaining,
          usedLeaveDetails: Array.isArray(bal?.usedLeaveDetails) ? bal.usedLeaveDetails : [],
          remaining,
          isOwed: remaining > 0,
          owedDays: remaining > 0 ? Number(remaining.toFixed(2)) : 0,
          overridden: !!bal.overridden,
          weeklyDetails: Array.isArray(bal.weeklyDetails) ? bal.weeklyDetails : [],
          lastAdjustment: bal.lastAdjustment || null
        });
      }
      rows.sort((a, b) => {
        if (Number(a.isOwed) !== Number(b.isOwed)) return Number(b.isOwed) - Number(a.isOwed);
        const ra = Number(a.remaining || 0);
        const rb = Number(b.remaining || 0);
        if (ra !== rb) return rb - ra;
        return String(a.name || a.username || '').localeCompare(String(b.name || b.username || ''), 'zh-Hans-CN');
      });

      const totals = rows.reduce((acc, r) => {
        acc.people += 1;
        acc.totalLeave = Number((acc.totalLeave + Number(r.totalLeave || 0)).toFixed(2));
        acc.usedLeave = Number((acc.usedLeave + Number(r.usedLeave || 0)).toFixed(2));
        acc.remaining = Number((acc.remaining + Number(r.remaining || 0)).toFixed(2));
        if (r.isOwed) {
          acc.owedPeople += 1;
          acc.owedDays = Number((acc.owedDays + Number(r.owedDays || 0)).toFixed(2));
        }
        return acc;
      }, { people: 0, owedPeople: 0, owedDays: 0, totalLeave: 0, usedLeave: 0, remaining: 0 });

      const adjustments = Array.isArray(state0?.leaveBalanceAdjustments) ? state0.leaveBalanceAdjustments : [];
      const monthAdjustments = adjustments
        .filter(a => String(a?.month || '') === month)
        .filter(a => !store || String(a?.store || '') === store)
        .slice(0, 200);

      const canAdjustCheck = await checkHrmsPermission(req, 'reports.leave_owed.adjust', {
        store: store || '',
        getSharedState: getSharedStateRef,
      });

      return res.json({
        month,
        store: store || '',
        includeInactive,
        canAdjust: !!canAdjustCheck.ok,
        totals,
        rows,
        adjustments: monthAdjustments
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/reports/attendance', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQAtt = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.attendance.view', storeQAtt))) return;
    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    if (!start || !end) return res.status(400).json({ error: 'missing_range' });
    const storeQ = String(req.query?.store || '').trim();

    try {
      const state0 = (await getSharedState()) || {};
      const myStore = pickMyStoreFromState(state0, username);
      const _allowedStores10959 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore10959 = String(req.user?.current_store || '').trim();
      const store = role === 'store_manager'
        ? (storeQ && _allowedStores10959.includes(storeQ) ? storeQ : (_currentStore10959 || myStore))
        : storeQ;
      // Also fetch detailed checkin records from DB
      let checkinDetails = [];
      try {
        let conditions = [`check_time >= $1::date`, `check_time < ($2::date + interval '1 day')`];
        let params = [start, end];
        let idx = 3;
        if (store) { conditions.push(`c.store = $${idx}`); params.push(store); idx++; }
        params.push(req.tenantId || req.user?.tenant_id || 'default');
        conditions.push(`c.tenant_id = $${idx}`);
        const where = 'where ' + conditions.join(' and ');
        const sql = `select c.username, c.store, c.check_time, c.status, c.type, c.confirmed_by, c.confirmed_at from checkin_records c ${where} order by c.check_time desc limit 5000`;
        const cr = await pool.query(sql, params);
        const employeesList = Array.isArray(state0.employees) ? state0.employees : [];
        const usersList = Array.isArray(state0.users) ? state0.users : [];
        let nameByLower = null;
        if (employeesList.length || usersList.length) {
          nameByLower = new Map();
          for (const e of employeesList) {
            const u = String(e?.username || '').trim().toLowerCase();
            if (!u) continue;
            if (!nameByLower.has(u)) nameByLower.set(u, String(e?.name || '').trim() || String(e?.username || '').trim());
          }
          for (const e of usersList) {
            const u = String(e?.username || '').trim().toLowerCase();
            if (!u || nameByLower.has(u)) continue;
            nameByLower.set(u, String(e?.name || '').trim() || String(e?.username || '').trim());
          }
        } else {
          const dbEmps = await dbListEmployeesForReports({ store, includeInactive: false, tenantId: req.tenantId || req.user?.tenant_id || 'default' });
          nameByLower = new Map();
          for (const e of dbEmps) {
            const u = String(e?.username || '').trim().toLowerCase();
            if (!u) continue;
            nameByLower.set(u, String(e?.name || '').trim() || String(e?.username || '').trim());
          }
        }
        // Build storeByLower map from employees for fallback when checkin_records.store is empty
        let storeByLower = null;
        if (employeesList.length || usersList.length) {
          storeByLower = new Map();
          for (const e of [...employeesList, ...usersList]) {
            const u = String(e?.username || '').trim().toLowerCase();
            const s = String(e?.store || '').trim();
            if (u && s && !storeByLower.has(u)) storeByLower.set(u, s);
          }
        } else {
          const dbEmps2 = await dbListEmployeesForReports({ store: null, includeInactive: false, tenantId: req.tenantId || req.user?.tenant_id || 'default' });
          storeByLower = new Map();
          for (const e of dbEmps2) {
            const u = String(e?.username || '').trim().toLowerCase();
            const s = String(e?.store || '').trim();
            if (u && s) storeByLower.set(u, s);
          }
        }
        checkinDetails = (cr.rows || []).map(r => {
          const lower = String(r.username || '').trim().toLowerCase();
          r.display_name = (nameByLower ? nameByLower.get(lower) : null) || r.username;
          // Fill missing store from employee profile
          if (!r.store && storeByLower) r.store = storeByLower.get(lower) || '';
          return r;
        });
      } catch (e) {}

      const fallbackRows = buildAttendanceFromCheckinRecords(checkinDetails, { start, end });
      let registerRows = [];
      try {
        const args = [start, end];
        let registerSql = `
          SELECT store, report_date, line_details
          FROM daily_report_attendance_register
          WHERE report_date >= $1::date AND report_date <= $2::date`;
        if (store) {
          registerSql += ` AND TRIM(store) = TRIM($3::text)`;
          args.push(store);
        }
        args.push(req.tenantId || req.user?.tenant_id || 'default');
        registerSql += ` AND tenant_id = $${args.length}`;
        registerSql += ` ORDER BY report_date DESC, store ASC`;
        const rr = await pool.query(registerSql, args);
        registerRows = Array.isArray(rr.rows) ? rr.rows : [];
      } catch (e) {}

      const summaryRows = buildAttendanceSummaryRows(registerRows, checkinDetails);
      const totals = summaryRows.reduce((acc, row) => {
        acc.people += 1;
        acc.actualAttendanceDays += Number(row.actualAttendanceDays || 0);
        acc.absenceDays += Number(row.absenceDays || 0);
        acc.lateDays += Number(row.lateDays || 0);
        acc.restDays += Number(row.restDays || 0);
        acc.anomalyPunches += Number(row.anomalyPunches || 0);
        return acc;
      }, { people: 0, actualAttendanceDays: 0, absenceDays: 0, lateDays: 0, restDays: 0, anomalyPunches: 0 });

      return res.json({
        start,
        end,
        store: store || '',
        rows: summaryRows,
        summaryRows,
        fallbackRows,
        checkinDetails,
        totals,
        hasRegisterData: registerRows.length > 0
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/reports/daily-attendance-register', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQDar = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.daily_register.view', storeQDar))) return;

    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    if (!start || !end) return res.status(400).json({ error: 'missing_range' });
    const storeQ = String(req.query?.store || '').trim();
    const employeeQ = String(req.query?.employee || '').trim();

    try {
      const args = [start, end];
      let sql = `
        SELECT store, brand, report_date, labor_total,
               front_person_days, kitchen_person_days, rest_person_days,
               staff_snapshot, line_details, overall_status, anomaly_count,
               created_at, updated_at
        FROM daily_report_attendance_register
        WHERE report_date >= $1::date AND report_date <= $2::date`;
      if (storeQ) {
        sql += ` AND TRIM(store) = TRIM($3::text)`;
        args.push(storeQ);
      }
      args.push(req.tenantId || req.user?.tenant_id || 'default');
      sql += ` AND tenant_id = $${args.length}`;
      sql += ` ORDER BY report_date DESC, store ASC`;
      const r = await pool.query(sql, args);
      let rows = r.rows || [];
      let employeeSummary = null;
      if (employeeQ) {
        employeeSummary = summarizeDailyRegisterForEmployee(rows, employeeQ);
        rows = filterDailyRegisterRowsByEmployee(rows, employeeQ);
      }
      return res.json({
        start,
        end,
        store: storeQ || '',
        employee: employeeQ,
        employee_summary: employeeSummary,
        rows
      });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.get('/api/reports/payroll', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQPay = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.payroll.view', storeQPay))) return;

    const month = parseMonth(req.query?.month);
    if (!month) return res.status(400).json({ error: 'missing_month' });
    const storeQ = String(req.query?.store || '').trim();

    try {
      const state0 = (await getSharedState()) || {};
      const myStore = pickMyStoreFromState(state0, username);
      const _allowedStores11150 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore11150 = String(req.user?.current_store || '').trim();
      const store = role === 'store_manager'
        ? (storeQ && _allowedStores11150.includes(storeQ) ? storeQ : (_currentStore11150 || myStore))
        : storeQ;

      // ── 新闭环引擎（规则+日结果+账本+底薪时间线）──
      if (typeof buildPayrollForMonth === 'function') {
        try {
          const employeesList = Array.isArray(state0?.employees) ? state0.employees : [];
          const usersList = Array.isArray(state0?.users) ? state0.users : [];
          const peopleByLower = new Map();
          employeesList.forEach((p) => {
            const uRaw = String(p?.username || '').trim();
            const u = uRaw.toLowerCase();
            if (!u || isLegacyTestUsername(u)) return;
            if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
          });
          usersList.forEach((p) => {
            const uRaw = String(p?.username || '').trim();
            const u = uRaw.toLowerCase();
            if (!u || isLegacyTestUsername(u)) return;
            if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
          });
          if (!peopleByLower.size) {
            const dbEmps = await dbListEmployeesForReports({ store, includeInactive: false, tenantId: req.tenantId || req.user?.tenant_id || 'default' });
            for (const p of dbEmps) {
              const uRaw = String(p?.username || '').trim();
              const u = uRaw.toLowerCase();
              if (!u || isLegacyTestUsername(u)) continue;
              if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
            }
          }
          let people = Array.from(peopleByLower.values());
          if (store) people = people.filter((p) => String(p?.store || '').trim() === store);

          const leaveBalanceByUser = new Map();
          let summarizeAttMonthPay = null;
          try {
            const mod = await import('./services/hrms-attendance-day.js');
            summarizeAttMonthPay = mod.summarizeAttendanceDaysForMonth;
          } catch (_) {}
          for (const p of people) {
            let attendanceRestDays = null;
            if (typeof summarizeAttMonthPay === 'function') {
              try {
                const att = await summarizeAttMonthPay({
                  tenantId: req.tenantId || req.user?.tenant_id || 'default',
                  username: p.username,
                  month,
                  db: typeof pool === 'function' ? pool() : pool
                });
                if (att && Number.isFinite(Number(att.restDays))) attendanceRestDays = Number(att.restDays);
              } catch (_) {}
            }
            const bal = calcEmployeeMonthlyLeaveBalance(state0, p, month, { attendanceRestDays });
            leaveBalanceByUser.set(String(p.username || '').trim().toLowerCase(), Number(bal?.remaining || 0));
          }

          const computed = await buildPayrollForMonth({
            tenantId: req.tenantId || req.user?.tenant_id || 'default',
            month,
            store,
            people,
            leaveBalanceByUser,
            getSharedState,
            findUserSalary,
            state: state0,
            reconcile: true
          });

          if (computed?.ok) {
            const auditKey = `${month}||${store || 'ALL'}`;
            const auditMap = state0?.payrollAudits && typeof state0.payrollAudits === 'object' ? state0.payrollAudits : {};
            const audit = auditMap[auditKey] || null;
            const rows = (computed.rows || []).map((r) => ({
              store: r.store,
              username: r.username,
              name: r.name,
              attendanceDays: r.attendanceDays,
              payableAttendanceDays: r.payableAttendanceDays,
              missingAttendanceDays: Math.max(0, Number((Number(r.workDaysPerMonth || 0) - Number(r.attendanceDays || 0)).toFixed(2))),
              leaveOffsetDays: null,
              remainingLeaveBeforeOffset: r.leaveRemaining,
              remainingLeaveAfterOffset: r.leaveRemaining,
              monthlySalary: r.monthlySalary,
              dailyRate: r.dailyRate,
              computedBaseAmount: r.baseAmount,
              baseAmount: r.baseAmount,
              baseAmountOverridden: false,
              rewardPunishmentAdj: r.rewardPunishmentAdj,
              subsidy: r.subsidy,
              pointsAmount: r.pointsAmount,
              manualSubsidy: r.manualSubsidy,
              amount: r.amount,
              prorationMode: r.prorationMode,
              salarySource: r.salarySource,
              ledgerItems: r.ledgerItems,
              attendanceSummary: r.attendanceSummary
            })).filter((r) => {
              const emp = peopleByLower.get(String(r.username || '').toLowerCase()) || null;
              return !isEmployeeDepartedForPayroll(emp, month, r.attendanceDays);
            });

            return res.json({
              month,
              store: store || '',
              monthDays: computed.monthDays,
              workDaysPerMonth: computed.workDaysPerMonth,
              audit,
              rows,
              totalAmount: rows.reduce((s, x) => s + clampNum(x.amount, 0), 0),
              engine: 'closed_loop_v1',
              rules: computed.rules,
              monthRun: computed.monthRun,
              resolvedFrom: computed.resolvedFrom
            });
          }
        } catch (engineErr) {
          console.warn('[payroll] closed-loop engine failed, fallback legacy:', engineErr?.message);
        }
      }

      const start = `${month}-01`;
      const [yr, mo] = month.split('-').map(Number);
      const end = `${month}-${String(new Date(yr, mo, 0).getDate()).padStart(2, '0')}`;
      const pointStoreByUser = new Map();
      const pointSubsidyByUserStore = new Map();
      const pointRecords = Array.isArray(state0?.pointRecords) ? state0.pointRecords : [];
      pointRecords.forEach(r => {
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
      const knownUsers = new Set();
      const peopleByLower = new Map();
      const employeesList = Array.isArray(state0?.employees) ? state0.employees : [];
      const usersList = Array.isArray(state0?.users) ? state0.users : [];
      // employees first: treat employee records as authoritative when duplicates exist
      employeesList.forEach((p) => {
        const uRaw = String(p?.username || '').trim();
        const u = uRaw.toLowerCase();
        if (!u || isLegacyTestUsername(u)) return;
        if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
      });
      usersList.forEach((p) => {
        const uRaw = String(p?.username || '').trim();
        const u = uRaw.toLowerCase();
        if (!u || isLegacyTestUsername(u)) return;
        if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
      });
      // If hrms_state snapshot is empty (common on some installs), fall back to employees table
      // so payroll/attendance-related reports don't silently drop everyone.
      if (!peopleByLower.size) {
        const dbEmps = await dbListEmployeesForReports({ store, includeInactive: false, tenantId: req.tenantId || req.user?.tenant_id || 'default' });
        for (const p of dbEmps) {
          const uRaw = String(p?.username || '').trim();
          const u = uRaw.toLowerCase();
          if (!u || isLegacyTestUsername(u)) continue;
          if (!peopleByLower.has(u)) peopleByLower.set(u, { ...p, username: uRaw });
        }
      }
      const allPeople = Array.from(peopleByLower.values());
      const canonicalUsernameByLower = new Map();
      peopleByLower.forEach((p, u) => {
        knownUsers.add(u);
        canonicalUsernameByLower.set(u, String(p?.username || u).trim() || u);
      });
      let attendanceRows = [];
      try {
        let conditions = [`check_time >= $1::date`, `check_time < ($2::date + interval '1 day')`];
        let params = [start, end];
        let idx = 3;
        if (store) {
          conditions.push(`store = $${idx}`);
          params.push(store);
          idx++;
        }
        params.push(req.tenantId || req.user?.tenant_id || 'default');
        conditions.push(`tenant_id = $${idx}`);
        const where = 'where ' + conditions.join(' and ');
        const checkinSql = `select username, store, check_time, status from checkin_records ${where} order by check_time desc`;
        const checkinRows = await pool.query(checkinSql, params);
        const displayNameByLower = new Map();
        peopleByLower.forEach((p, lower) => {
          displayNameByLower.set(lower, String(p?.name || p?.username || '').trim());
        });
        const normalizedCheckins = (checkinRows.rows || []).map((r) => ({
          ...r,
          display_name: displayNameByLower.get(String(r?.username || '').trim().toLowerCase()) || String(r?.username || '').trim()
        }));
        attendanceRows = buildAttendanceFromCheckinRecords(normalizedCheckins, { start, end, knownUsers });
      } catch (e) {
        console.warn('[payroll] checkin_records attendance fallback to daily reports:', e?.message);
        let items = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
        items = items.filter(r => inDateRange(String(r?.date || '').trim(), start, end));
        if (store) items = items.filter(r => String(r?.store || '').trim() === store);
        attendanceRows = buildAttendanceFromReports(items);
      }
      const [yearNum, monthNum] = month.split('-').map(Number);
      const monthDays = new Date(yearNum, monthNum, 0).getDate();
      // Business rule: daily rate uses salary / (days in month - 4 fixed weekly offs)
      const workDaysPerMonth = Math.max(1, monthDays - 4);

      const payrollRowKey = (st, userLower) => `${String(st || '').trim()}||${String(userLower || '').trim()}`;

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

      // 奖惩归属月份以「审批单的生效/创建月」为准，而非 salaryAdjustment 记录的 createdAt
      // （再次终审会把记录 createdAt 重写成当时时间，导致跨月奖惩被错并到同一月 → 金额翻倍）。
      const approvalMonthById = new Map();
      try {
        const arRows = await pool.query(
          `SELECT id::text AS id, to_char(COALESCE(effective_date, created_at::date), 'YYYY-MM') AS ym
           FROM approval_requests WHERE type = 'reward_punishment' AND tenant_id = $1`,
          [req.tenantId || req.user?.tenant_id || 'default']
        );
        for (const r of (arRows.rows || [])) approvalMonthById.set(String(r.id), String(r.ym || ''));
      } catch (e) {
        console.warn('[payroll] load approval months failed:', e?.message);
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

        // Ensure people with salary adjustments still appear in payroll rows even with zero attendance
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
              days: 0
            });
          }
        }
      }

      const payrollAdjMap = state0?.payrollAdjustments && typeof state0.payrollAdjustments === 'object' ? state0.payrollAdjustments : {};

      // Ensure people with points/manual subsidy still appear even when attendance is 0
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
            days: 0
          });
        }
      });

      // Ensure zero-attendance employees are still listed when they have salary/adjustments/points
      allPeople.forEach(p => {
        const rowUser = String(p?.username || '').trim();
        const rowUserLower = rowUser.toLowerCase();
        if (!rowUser || !knownUsers.has(rowUserLower)) return;

        const rowStore = String(p?.store || pointStoreByUser.get(rowUserLower) || '').trim();
        if (store && rowStore !== store) return;

        const salary = findUserSalary(state0, rowUser);
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
            days: 0
          });
        }
      });

      const rows = Array.from(sumMap.values()).map(x => {
        const monthlySalary = findUserSalary(state0, x.username);
        const dailyRate = monthlySalary != null ? (monthlySalary / workDaysPerMonth) : null;
        const person = peopleByLower.get(String(x.username || '').trim().toLowerCase()) || null;
        const leaveBalance = person ? calcEmployeeMonthlyLeaveBalance(state0, person, month) : null;
        const attendanceDays = clampNum(x.days, 0);
        const missingAttendanceDays = Number(Math.max(0, Number((workDaysPerMonth - attendanceDays).toFixed(2))));
        const remainingLeaveBeforeOffset = leaveBalance ? Number(leaveBalance.remaining || 0) : 0;
        // 倒欠公司假期仍算全勤
        let leaveOffsetDays;
        let payableAttendanceDays;
        if (remainingLeaveBeforeOffset < 0) {
          leaveOffsetDays = missingAttendanceDays;
          payableAttendanceDays = workDaysPerMonth;
        } else {
          leaveOffsetDays = Number(Math.min(missingAttendanceDays, Math.max(0, remainingLeaveBeforeOffset)).toFixed(2));
          payableAttendanceDays = Number(Math.min(workDaysPerMonth, attendanceDays + leaveOffsetDays).toFixed(2));
        }
        const remainingLeaveAfterOffset = leaveBalance
          ? Number((remainingLeaveBeforeOffset - leaveOffsetDays).toFixed(2))
          : null;
        const computedBaseAmount = dailyRate != null ? (dailyRate * payableAttendanceDays) : null;
        const rewardPunishmentAdj = adjustmentMap.get(String(x.username || '').toLowerCase()) || 0;
        const rowStore = String(x.store || '').trim();
        const rowUser = String(x.username || '').trim().toLowerCase();
        const fallbackStore = String(pointStoreByUser.get(rowUser) || '').trim();
        const effectiveStore = rowStore || fallbackStore;
        const adjKey = `${month}||${effectiveStore || 'ALL'}||${rowUser}`;
        const payrollAdjByStore = payrollAdjMap?.[adjKey] && typeof payrollAdjMap[adjKey] === 'object' ? payrollAdjMap[adjKey] : {};
        const payrollAdjAllStore = effectiveStore && payrollAdjMap?.[`${month}||ALL||${rowUser}`] && typeof payrollAdjMap[`${month}||ALL||${rowUser}`] === 'object'
          ? payrollAdjMap[`${month}||ALL||${rowUser}`]
          : {};
        const subsidyByStore = safeNumber(payrollAdjMap?.[adjKey]?.subsidy ?? payrollAdjMap?.[adjKey]?.amount) || 0;
        const subsidyAllStore = effectiveStore
          ? (safeNumber(payrollAdjMap?.[`${month}||ALL||${rowUser}`]?.subsidy ?? payrollAdjMap?.[`${month}||ALL||${rowUser}`]?.amount) || 0)
          : 0;
        const manualBaseByStore = safeNumber(payrollAdjByStore?.baseAmount);
        const manualBaseAllStore = safeNumber(payrollAdjAllStore?.baseAmount);
        const baseAmount = manualBaseByStore != null
          ? manualBaseByStore
          : (manualBaseAllStore != null ? manualBaseAllStore : computedBaseAmount);
        const subsidyFromPayrollAdjustments = subsidyByStore + subsidyAllStore;
        const pointSubsidyByStore2 = safeNumber(pointSubsidyByUserStore.get(`${effectiveStore || 'ALL'}||${rowUser}`)) || 0;
        const pointSubsidyAllStore2 = effectiveStore ? (safeNumber(pointSubsidyByUserStore.get(`ALL||${rowUser}`)) || 0) : 0;
        const subsidyFromPointRecords = pointSubsidyByStore2 + pointSubsidyAllStore2;
        // 人工补贴与积分相加（不再取 max）
        const subsidy = Number((subsidyFromPayrollAdjustments + subsidyFromPointRecords).toFixed(2));
        const amount = baseAmount != null ? (baseAmount + rewardPunishmentAdj + subsidy) : ((rewardPunishmentAdj || 0) + subsidy || null);
        return {
          store: effectiveStore,
          username: x.username,
          name: x.name,
          attendanceDays,
          payableAttendanceDays,
          missingAttendanceDays,
          leaveOffsetDays,
          remainingLeaveBeforeOffset,
          remainingLeaveAfterOffset,
          monthlySalary,
          dailyRate,
          computedBaseAmount,
          baseAmount,
          baseAmountOverridden: manualBaseByStore != null || manualBaseAllStore != null,
          rewardPunishmentAdj,
          subsidy,
          amount
        };
      });

      // 排除已离职且当月无出勤的人员（避免离职后每月仍计薪；末月有出勤者保留结算）
      const rowsActive = rows.filter((r) => {
        const lower = String(r?.username || '').trim().toLowerCase();
        const emp = peopleByLower.get(lower) || stateFindUserRecord(state0, r?.username) || null;
        return !isEmployeeDepartedForPayroll(emp, month, r?.attendanceDays);
      });
      rows.length = 0;
      rows.push(...rowsActive);

      rows.sort((a, b) => String(a.store).localeCompare(String(b.store), 'zh-Hans-CN') || String(a.name || a.username).localeCompare(String(b.name || b.username), 'zh-Hans-CN'));

      const auditKey = `${month}||${store || 'ALL'}`;
      const auditMap = state0?.payrollAudits && typeof state0.payrollAudits === 'object' ? state0.payrollAudits : {};
      const audit = auditMap[auditKey] || null;

      const totalAmount = rows.reduce((s, x) => s + clampNum(x.amount, 0), 0);
      return res.json({ month, store: store || '', monthDays, workDaysPerMonth, audit, rows, totalAmount, engine: 'legacy_fallback' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // NOTE: legacy payroll body above ends; keep audit/adjustment endpoints below.
  app.post('/api/reports/payroll/audit', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeAudit = String(req.body?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.payroll.audit', storeAudit))) return;

    const month = parseMonth(req.body?.month);
    if (!month) return res.status(400).json({ error: 'missing_month' });
    const store = String(req.body?.store || '').trim();
    const audited = !!req.body?.audited;

    try {
      const state0 = (await getSharedState()) || {};
      const auditKey = `${month}||${store || 'ALL'}`;
      const auditMap = state0?.payrollAudits && typeof state0.payrollAudits === 'object' ? { ...state0.payrollAudits } : {};
      auditMap[auditKey] = {
        month,
        store: store || '',
        audited,
        auditedBy: username,
        auditedAt: hrmsNowISO()
      };
      await mergeSharedStateFields({ payrollAudits: auditMap });
      return res.json({ ok: true, audit: auditMap[auditKey] });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/reports/payroll/adjustment', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeAdj = String(req.body?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.payroll.adjust', storeAdj))) return;

    const month = parseMonth(req.body?.month);
    if (!month) return res.status(400).json({ error: 'missing_month' });
    const store = String(req.body?.store || '').trim();
    const targetUsername = String(req.body?.username || '').trim();
    if (!targetUsername) return res.status(400).json({ error: 'missing_username' });

    const subsidy = safeNumber(req.body?.subsidy);
    const baseAmount = safeNumber(req.body?.baseAmount);
    if (subsidy == null && baseAmount == null) return res.status(400).json({ error: 'missing_adjustment' });

    try {
      const state0 = (await getSharedState()) || {};
      const key = `${month}||${store || 'ALL'}||${targetUsername.toLowerCase()}`;
      const existing = state0?.payrollAdjustments?.[key] && typeof state0.payrollAdjustments[key] === 'object'
        ? state0.payrollAdjustments[key]
        : {};
      const item = {
        ...existing,
        month,
        store: store || '',
        username: targetUsername,
        ...(subsidy != null ? { subsidy } : {}),
        ...(baseAmount != null ? { baseAmount } : {}),
        updatedBy: username,
        updatedAt: hrmsNowISO()
      };
      // 原子合并，避免整包 saveSharedState 覆盖由积分审批写入的 pointRecords/payrollAdjustments
      await mergeSharedStateFields({ payrollAdjustments: { [key]: item } });
      // 同步写入薪资账本（人工补贴与积分相加）
      if (subsidy != null) {
        try {
          const { upsertPayrollLedgerEntry } = await import('./services/hrms-payroll-engine.js');
          await upsertPayrollLedgerEntry({
            tenantId: req.tenantId || req.user?.tenant_id || 'default',
            username: targetUsername,
            store,
            bizMonth: month,
            entryType: 'manual_subsidy',
            amount: subsidy,
            title: '人工补贴',
            reason: String(req.body?.reason || '').trim() || '高温/调店等临时费用',
            sourceRef: key,
            createdBy: username
          });
        } catch (e) {
          console.warn('[payroll/adjustment] ledger write failed:', e?.message);
        }
      }
      return res.json({ ok: true, item });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

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
