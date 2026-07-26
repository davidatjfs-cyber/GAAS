import { dailyReportStoreLikePatternsForSql } from './run-data-auditor.js';

export async function fetchRechargeFromDailyReportsPg(
  { pool, normalizeStoreKey, normalizeCanonicalStoreName },
  storeName,
  reportDate
) {
  if (!storeName || !reportDate) return { cnt: 0, amt: 0 };
  try {
    const pats = dailyReportStoreLikePatternsForSql(
      storeName,
      normalizeStoreKey,
      normalizeCanonicalStoreName
    );
    if (!pats.length) return { cnt: 0, amt: 0 };
    const r = await pool().query(
      `SELECT COALESCE(SUM(COALESCE(recharge_count,0)), 0)::int AS cnt,
              COALESCE(SUM(COALESCE(recharge_amount,0)), 0)::numeric AS amt
       FROM daily_reports
       WHERE date = $1::date
         AND lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE ANY($2::text[])`,
      [reportDate, pats]
    );
    const row = r.rows?.[0];
    return {
      cnt: parseInt(row?.cnt ?? 0, 10) || 0,
      amt: parseFloat(row?.amt ?? 0) || 0,
    };
  } catch {
    return { cnt: 0, amt: 0 };
  }
}
