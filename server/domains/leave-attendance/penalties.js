// 考勤缺失扣假规则起始日（含）：2026-06-01 之前不统计
export const ATTENDANCE_PENALTY_START_DATE = '2026-06-01';

/**
 * 计算某月「有出勤但缺考勤」的扣假：日报标记上班(work)，但当天缺上班卡或下班卡（任一缺即算缺勤），
 * 每缺勤 1 天扣 1 天休假。返回 Map<usernameLower, { days, details:[{date,days,type,source}] }>。
 * store 仅用于圈定日报台账范围；打卡按 用户+日期 全局匹配（员工打卡归属其本人）。
 */
export function createPenaltiesHelpers({ pool, safeMonthOnly }) {
  async function computeAttendanceMissingClockPenalties(month, store, tenantId) {
    const m = safeMonthOnly(month);
    const out = new Map();
    if (!m) return out;
    const [yr, mo] = m.split('-').map(Number);
    const monthStart = `${m}-01`;
    const monthEnd = `${m}-${String(new Date(yr, mo, 0).getDate()).padStart(2, '0')}`;
    const effStart = monthStart > ATTENDANCE_PENALTY_START_DATE ? monthStart : ATTENDANCE_PENALTY_START_DATE;
    if (effStart > monthEnd) return out;
    try {
      const wArgs = [effStart, monthEnd];
      let storeClause = '';
      if (store) { wArgs.push(store); storeClause = ` AND TRIM(store) = TRIM($3::text)`; }
      wArgs.push(tenantId || 'default');
      const workSql = `
      SELECT DISTINCT lower(trim(ld->>'username')) AS u, report_date::text AS d
      FROM daily_report_attendance_register, LATERAL jsonb_array_elements(line_details) ld
      WHERE report_date >= $1::date AND report_date <= $2::date${storeClause}
        AND ld->>'kind' = 'work' AND coalesce(ld->>'username','') <> ''
        AND tenant_id = $${wArgs.length}`;
      const workRows = (await pool.query(workSql, wArgs)).rows || [];
      if (!workRows.length) return out;

      const ciSql = `
      SELECT lower(trim(username)) AS u,
             (timezone('Asia/Shanghai', check_time))::date::text AS d,
             bool_or(type = 'clock_in')  AS has_in,
             bool_or(type = 'clock_out') AS has_out
      FROM checkin_records
      WHERE (timezone('Asia/Shanghai', check_time))::date >= $1::date
        AND (timezone('Asia/Shanghai', check_time))::date <= $2::date
        AND tenant_id = $3
      GROUP BY 1, 2`;
      const ciRows = (await pool.query(ciSql, [effStart, monthEnd, tenantId || 'default'])).rows || [];
      const ciMap = new Map();
      for (const r of ciRows) ciMap.set(`${r.u}||${r.d}`, { has_in: r.has_in === true, has_out: r.has_out === true });

      for (const w of workRows) {
        const ci = ciMap.get(`${w.u}||${w.d}`);
        if (ci && ci.has_in && ci.has_out) continue; // 上下班卡齐全 → 不缺勤
        const miss = !ci ? '无打卡' : (!ci.has_in ? '缺上班卡' : '缺下班卡');
        let entry = out.get(w.u);
        if (!entry) { entry = { days: 0, details: [] }; out.set(w.u, entry); }
        entry.days = Number((entry.days + 1).toFixed(2));
        entry.details.push({ date: w.d, days: 1, type: '考勤缺失扣假', source: `有出勤·${miss}` });
      }
    } catch (e) {
      console.error('[attendance-penalty] compute failed:', e?.message);
    }
    return out;
  }

  return {
    ATTENDANCE_PENALTY_START_DATE,
    computeAttendanceMissingClockPenalties,
  };
}
