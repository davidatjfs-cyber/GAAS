/**
 * Turnover report — rates, breakdowns, departed details.
 */
import {
  resolveAgentCanonicalStore,
  normalizeEmployeeDepartureDateForTurnover,
  employeeStoreMatchesTurnoverReportFilter,
  isEmployeeDepartedForTurnoverReport,
  isEmployeeActiveLikeForTurnoverReport,
  isEmployeeCoreTalentForTurnoverReport,
} from './helpers.js';

export function computeTurnoverReportPayload({
  month,
  store,
  storeEmps,
  empByLower,
  offDeparted,
  yr,
  mo,
}) {
  const departedThisMonth = storeEmps.filter((e) => {
    if (!isEmployeeDepartedForTurnoverReport(e)) return false;
    const depDate = normalizeEmployeeDepartureDateForTurnover(e);
    if (!depDate) return false;
    return depDate >= month + '-01' && depDate <= month + '-31';
  });

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

  const isCoreTalent = isEmployeeCoreTalentForTurnoverReport;
  const coreTalentAll = activeOrDepartedThisMonth.filter(isCoreTalent);
  const coreTalentDeparted = departedThisMonth.filter(isCoreTalent);
  const criticalTurnoverRate = coreTalentAll.length > 0 ? coreTalentDeparted.length / coreTalentAll.length : 0;

  const threeMonthsAgo = new Date(yr, mo - 4, 1);
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
  };
}
