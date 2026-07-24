/**
 * Turnover analysis report — pure logic (no req/res).
 */
import {
  resolveAgentCanonicalStore,
  normalizeEmployeeDepartureDateForTurnover,
  employeeStoreMatchesTurnoverReportFilter,
  isEmployeeDepartedForTurnoverReport,
  isEmployeeActiveLikeForTurnoverReport,
  isEmployeeCoreTalentForTurnoverReport,
} from './helpers.js';

/**
 * @param {object} ctx
 * @param {object} opts
 * @returns {Promise<{ ok: true, payload: object } | { ok: false, status: number, error: string, message?: string }>}
 */
export async function getTurnoverReportPayload(ctx, {
  month,
  storeQ,
  role,
  username,
  tenantId,
  allowedStores,
  currentStore,
}) {
  const {
    pool,
    getSharedState,
    safeDateOnly,
    pickMyStoreFromState,
    dbListEmployeesForReports,
    expandAgentStoreLabels,
  } = ctx;

  if (!month || !/^\d{4}-\d{2}$/.test(String(month).trim())) {
    return { ok: false, status: 400, error: 'missing_month' };
  }

  try {
    const state0 = (await getSharedState()) || {};
    const myStore = pickMyStoreFromState(state0, username);
    const allowed = Array.isArray(allowedStores) ? allowedStores : [];
    const curStore = String(currentStore || '').trim();
    const store = role === 'store_manager'
      ? (storeQ && allowed.includes(storeQ) ? storeQ : (curStore || myStore))
      : storeQ;

    let allEmployees = Array.isArray(state0.employees) ? state0.employees : [];
    const dbEmps = await dbListEmployeesForReports({
      store: store || '',
      includeInactive: true,
      tenantId: tenantId || 'default',
    });
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
        [month, tenantId || 'default']
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
    } catch (_) { /* ignore */ }

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
      erParams.push(tenantId || 'default');
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
    const isCoreTalent = isEmployeeCoreTalentForTurnoverReport;
    const coreTalentAll = activeOrDepartedThisMonth.filter(isCoreTalent);
    const coreTalentDeparted = departedThisMonth.filter(isCoreTalent);
    const criticalTurnoverRate = coreTalentAll.length > 0 ? coreTalentDeparted.length / coreTalentAll.length : 0;

    // ── B. New Hire Retention ──
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

    return {
      ok: true,
      payload: {
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
      }
    };
  } catch (_) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
