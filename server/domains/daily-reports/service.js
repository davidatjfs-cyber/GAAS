/**
 * Pure daily-reports logic (no req/res).
 */

export async function queryPrivateRoomMonthTotal({
  pool,
  store,
  month,
  tenantId,
  expandAgentStoreLabels,
}) {
  if (!store || !month) {
    return { total: 0 };
  }

  const labels = [...new Set(expandAgentStoreLabels(store).map((s) => String(s || '').trim()).filter(Boolean))];
  const patterns = labels.map((s) => `%${s.replace(/%/g, '')}%`);
  const tenantIdQ = tenantId || 'default';

  let r = await pool.query(
    `SELECT COALESCE(SUM(private_room_uses), 0)::int AS total
     FROM daily_reports
     WHERE TO_CHAR(date::date,'YYYY-MM') = $1
       AND TRIM(store) = ANY($2::text[])
       AND tenant_id = $3`,
    [month, labels, tenantIdQ]
  );
  let total = parseInt(r.rows?.[0]?.total || 0, 10);
  if (!total) {
    r = await pool.query(
      `SELECT COALESCE(SUM(private_room_uses), 0)::int AS total
       FROM daily_reports
       WHERE TO_CHAR(date::date,'YYYY-MM') = $1
         AND TRIM(store) ILIKE ANY($2::text[])
         AND tenant_id = $3`,
      [month, patterns, tenantIdQ]
    );
    total = parseInt(r.rows?.[0]?.total || 0, 10);
  }
  return { total };
}

export async function deleteDailyReportFromState({
  store,
  date,
  getSharedState,
  mergeSharedStateFields,
  notifyAdminsDualWriteFailure,
  safeErrMessage,
}) {
  const state0 = (await getSharedState()) || {};
  const list = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
  const next = list.filter(r => !(String(r?.store || '').trim() === store && String(r?.date || '').trim() === date));
  try {
    await mergeSharedStateFields(
      { dailyReports: next },
      { dailyReports: ['store', 'date'] }
    );
  } catch (mergeErr) {
    void notifyAdminsDualWriteFailure('daily_reports（营业日报删除 state 合并）', mergeErr);
    return { error: 'state_merge_failed', message: safeErrMessage(mergeErr) };
  }
  return { ok: true };
}

export async function syncSubmittedDailyReportsToPg({
  date,
  storeFilter,
  tenantId,
  getSharedState,
  safeDateOnly,
  upsertDailyReportPgFromStateReport,
  notifyAdminsDualWriteFailure,
  safeErrMessage,
}) {
  const state0 = (await getSharedState()) || {};
  const list = Array.isArray(state0.dailyReports) ? state0.dailyReports : [];
  const results = [];
  for (const dr of list) {
    const d = safeDateOnly(dr?.date);
    const st = String(dr?.store || '').trim();
    if (d !== date) continue;
    if (storeFilter && st !== storeFilter) continue;
    const submitted = !!(dr?.submittedAt || dr?.submitted_at || dr?.submitted);
    if (!submitted) continue;
    try {
      await upsertDailyReportPgFromStateReport(dr, tenantId || 'default');
      results.push({ store: st, date: d, ok: true });
    } catch (e) {
      const msg = safeErrMessage(e);
      void notifyAdminsDualWriteFailure(`daily_reports（admin 补写 PG ${st} ${d}）`, e);
      results.push({ store: st, date: d, ok: false, error: msg });
    }
  }
  return {
    ok: true,
    date,
    storeFilter: storeFilter || null,
    matched: results.length,
    results,
  };
}
