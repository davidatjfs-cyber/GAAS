/**
 * 老板/总经理/总部营运经理「今日经营总览」——第1项，2026-07-28 按用户给的完整规格重做。
 * 数据源：daily_reports（营收/客流/客单/桌均/人效）、revenue_targets（月度目标）、
 * pos_orders（堂食/外卖占比、就餐人数分布，daily_reports 没有这两个维度的明细）。
 *
 * 同比/环比口径（这次没跟业务方逐条确认，按最常见的口径实现，如果不对需要改）：
 * - 环比：跟"上一个同样长度的周期"比（今日 vs 昨日；本周 vs 上周同期；本月 vs 上月同期）
 * - 同比：跟"去年同一个日历区间"比（今日 vs 去年同一天；本周 vs 去年同一周；本月 vs 去年同月）
 */
import { childLogger } from '../../utils/logger.js';
import { getTurnoverRate } from '../../hrms-api-tools.js';

const log = childLogger({ domain: 'workspace', handler: 'overview' });

function shanghaiToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); // YYYY-MM-DD
}

function addDays(ymd, delta) {
  const d = new Date(`${ymd}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function addYears(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y + delta, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

function mondayOf(ymd) {
  const d = new Date(`${ymd}T12:00:00+08:00`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1;
  return addDays(ymd, -diff);
}

function monthStartOf(ymd) {
  return ymd.slice(0, 7) + '-01';
}

function periodOf(ymd) {
  return ymd.slice(0, 7);
}

function pctChange(cur, prev) {
  const c = Number(cur) || 0;
  const p = Number(prev) || 0;
  if (!p) return null; // 分母为0，不给一个假的百分比
  return Number((((c - p) / p) * 100).toFixed(1));
}

/** 范围过滤：老板=admin 看全部品牌/门店；hq_manager/营运经理只看自己负责的门店——
 * 三个角色共用同一套首页布局，唯一差异就是这个 storeFilter（空数组=不过滤=全部）。 */
function storeFilterClause(storeFilter, paramIndex, column = 'store') {
  if (!Array.isArray(storeFilter) || !storeFilter.length) return { sql: '', param: null };
  return { sql: ` AND ${column} = ANY($${paramIndex})`, param: storeFilter };
}

async function revenueRollup(pool, tenantId, today, storeFilter) {
  const yesterday = addDays(today, -1);
  const weekStart = mondayOf(today);
  const weekStartLW = addDays(weekStart, -7);
  const weekEndLW = addDays(weekStart, -1);
  const monthStart = monthStartOf(today);
  const monthStartLM = monthStartOf(addDays(monthStart, -1));
  const monthEndLM = addDays(monthStart, -1);
  const todayLY = addYears(today, -1);
  const weekStartLY = addYears(weekStart, -1);
  const weekEndLY = addYears(today, -1);
  const monthStartLY = addYears(monthStart, -1);
  const monthEndLY = addYears(today, -1);

  const revParams = [tenantId, today, yesterday, todayLY, weekStart, weekStartLW, weekEndLW, weekStartLY, weekEndLY, monthStart, monthStartLM, monthEndLM, monthStartLY, monthEndLY];
  const revFilter = storeFilterClause(storeFilter, revParams.length + 1);
  if (revFilter.param) revParams.push(revFilter.param);
  const r = await pool.query(
    `SELECT
        COALESCE(SUM(actual_revenue) FILTER (WHERE date = $2), 0) AS today_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date = $3), 0) AS yesterday_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date = $4), 0) AS today_ly_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $5 AND date <= $2), 0) AS week_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $6 AND date <= $7), 0) AS week_lw_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $8 AND date <= $9), 0) AS week_ly_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $10 AND date <= $2), 0) AS month_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $11 AND date <= $12), 0) AS month_lm_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $13 AND date <= $14), 0) AS month_ly_revenue
       FROM daily_reports
      WHERE tenant_id = $1${revFilter.sql}`,
    revParams
  );
  const row = r.rows[0] || {};

  const targetParams = [tenantId, periodOf(today)];
  const targetFilter = storeFilterClause(storeFilter, targetParams.length + 1);
  if (targetFilter.param) targetParams.push(targetFilter.param);
  const targetR = await pool.query(
    `SELECT COALESCE(SUM(target_revenue), 0) AS target FROM revenue_targets WHERE tenant_id = $1 AND period = $2${targetFilter.sql}`,
    targetParams
  );
  const targetRevenue = Number(targetR.rows[0]?.target || 0);

  const [y, m] = today.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const elapsedDays = Number(today.slice(8, 10));
  const theoreticalAchievementRate = Number(((elapsedDays / daysInMonth) * 100).toFixed(1));
  const actualAchievementRate = targetRevenue > 0 ? Number(((Number(row.month_revenue) / targetRevenue) * 100).toFixed(1)) : null;

  return {
    today: { revenue: Number(row.today_revenue), mom: pctChange(row.today_revenue, row.yesterday_revenue), yoy: pctChange(row.today_revenue, row.today_ly_revenue) },
    week: { revenue: Number(row.week_revenue), mom: pctChange(row.week_revenue, row.week_lw_revenue), yoy: pctChange(row.week_revenue, row.week_ly_revenue) },
    month: { revenue: Number(row.month_revenue), mom: pctChange(row.month_revenue, row.month_lm_revenue), yoy: pctChange(row.month_revenue, row.month_ly_revenue) },
    target: {
      targetRevenue,
      theoreticalAchievementRate,
      actualAchievementRate,
    },
  };
}

async function operationalMetrics(pool, tenantId, today, storeFilter) {
  const monthStart = monthStartOf(today);
  const monthStartLM = monthStartOf(addDays(monthStart, -1));
  const monthEndLM = addDays(monthStart, -1);
  const monthStartLY = addYears(monthStart, -1);
  const monthEndLY = addYears(today, -1);

  const opParams = [tenantId, monthStart, today, monthStartLM, monthEndLM, monthStartLY, monthEndLY];
  const opFilter = storeFilterClause(storeFilter, opParams.length + 1);
  if (opFilter.param) opParams.push(opFilter.param);
  const r = await pool.query(
    `SELECT
        COALESCE(SUM(dine_traffic) FILTER (WHERE date >= $2 AND date <= $3), 0) AS traffic,
        COALESCE(SUM(dine_revenue) FILTER (WHERE date >= $2 AND date <= $3), 0) AS dine_revenue,
        COALESCE(SUM(dine_orders) FILTER (WHERE date >= $2 AND date <= $3), 0) AS dine_orders,
        COALESCE(SUM(dine_traffic) FILTER (WHERE date >= $4 AND date <= $5), 0) AS traffic_lm,
        COALESCE(SUM(dine_traffic) FILTER (WHERE date >= $6 AND date <= $7), 0) AS traffic_ly
       FROM daily_reports
      WHERE tenant_id = $1${opFilter.sql}`,
    opParams
  );
  const row = r.rows[0] || {};
  const traffic = Number(row.traffic);
  const dineRevenue = Number(row.dine_revenue);
  const dineOrders = Number(row.dine_orders);

  const posParams = [tenantId, monthStart, today];
  const posFilter = storeFilterClause(storeFilter, posParams.length + 1, 'store_name');
  if (posFilter.param) posParams.push(posFilter.param);
  const posR = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE order_type = '堂食') AS dine_cnt,
        COUNT(*) FILTER (WHERE order_type = '外卖') AS delivery_cnt,
        COUNT(*) AS total_cnt,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners = 1) AS p1,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners = 2) AS p2,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners BETWEEN 3 AND 4) AS p3_4,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners BETWEEN 5 AND 6) AS p5_6,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners > 6) AS p6plus
       FROM pos_orders
      WHERE tenant_id = $1 AND biz_date >= $2 AND biz_date <= $3${posFilter.sql}`,
    posParams
  );
  const posRow = posR.rows[0] || {};
  const totalCnt = Number(posRow.total_cnt) || 0;
  const dinePartyTotal = Number(posRow.dine_cnt) || 0;
  const pct = (n) => (dinePartyTotal > 0 ? Number(((Number(n) / dinePartyTotal) * 100).toFixed(1)) : null);

  return {
    traffic,
    trafficMom: pctChange(traffic, row.traffic_lm),
    trafficYoy: pctChange(traffic, row.traffic_ly),
    avgSpendPerGuest: traffic > 0 ? Number((dineRevenue / traffic).toFixed(2)) : null,
    avgSpendPerTable: dineOrders > 0 ? Number((dineRevenue / dineOrders).toFixed(2)) : null,
    dineInSharePct: totalCnt > 0 ? Number(((Number(posRow.dine_cnt) / totalCnt) * 100).toFixed(1)) : null,
    deliverySharePct: totalCnt > 0 ? Number(((Number(posRow.delivery_cnt) / totalCnt) * 100).toFixed(1)) : null,
    partySizeSharePct: {
      p1: pct(posRow.p1),
      p2: pct(posRow.p2),
      p3to4: pct(posRow.p3_4),
      p5to6: pct(posRow.p5_6),
      p6plus: pct(posRow.p6plus),
    },
  };
}

async function storeRankings(pool, tenantId, today, storeFilter) {
  const monthStart = monthStartOf(today);
  const params = [tenantId, monthStart, today];
  const filter = storeFilterClause(storeFilter, params.length + 1);
  if (filter.param) params.push(filter.param);
  const r = await pool.query(
    `SELECT store,
            SUM(actual_revenue) AS revenue,
            SUM(dine_traffic) AS traffic,
            AVG(NULLIF(efficiency, 0)) AS efficiency
       FROM daily_reports
      WHERE tenant_id = $1 AND date >= $2 AND date <= $3 AND store IS NOT NULL AND store <> ''${filter.sql}
      GROUP BY store`,
    params
  );
  const rows = (r.rows || []).map((row) => ({
    store: row.store,
    revenue: Number(row.revenue || 0),
    traffic: Number(row.traffic || 0),
    efficiency: row.efficiency != null ? Number(row.efficiency) : null,
  }));
  return {
    byRevenue: [...rows].sort((a, b) => b.revenue - a.revenue),
    byTraffic: [...rows].sort((a, b) => b.traffic - a.traffic),
    byEfficiency: [...rows].filter((r2) => r2.efficiency != null).sort((a, b) => b.efficiency - a.efficiency),
  };
}

/** 门店员工离职率（当月累计）——复用已有的 getTurnoverRate()（server/hrms-api-tools.js），
 * 不重新实现一套计算逻辑。多门店时逐店查询后汇总（该函数本身按单个 store 计算）。 */
async function turnoverSummary(pool, tenantId, storeFilter, getTurnoverRate) {
  if (typeof getTurnoverRate !== 'function') return null;
  const stores = Array.isArray(storeFilter) && storeFilter.length ? storeFilter : [''];
  const results = await Promise.all(stores.map((s) => getTurnoverRate(s, 1)));
  const totalDepartures = results.reduce((s, r) => s + (r?.departures || 0), 0);
  const totalEmployees = results.reduce((s, r) => s + (r?.totalEmployees || 0), 0);
  return {
    departures: totalDepartures,
    totalEmployees,
    turnoverRate: totalEmployees > 0 ? Number(((totalDepartures / totalEmployees) * 100).toFixed(1)) : null,
  };
}

/** 下属人员绩效/能力/态度/执行力评级总览——直接读 employee_scores 本月记录，
 * 这张表已经有 execution_rating/attitude_rating/ability_rating（A/B/C/D）+ total_score，
 * 不是新算的规则。 */
async function teamPerformanceSummary(pool, tenantId, storeFilter, period) {
  const params = [tenantId, period];
  const filter = storeFilterClause(storeFilter, params.length + 1);
  if (filter.param) params.push(filter.param);
  const r = await pool.query(
    `SELECT username, name, store, role, total_score, execution_rating, attitude_rating, ability_rating
       FROM employee_scores
      WHERE tenant_id = $1 AND period = $2${filter.sql}
      ORDER BY total_score DESC NULLS LAST`,
    params
  );
  return r.rows || [];
}

/**
 * @param {string[]} storeFilter 空数组/undefined = 不限门店（老板）；非空 = 只看这些门店
 *   （hq_manager/营运经理按各自负责的门店范围传入，范围本身由现有 allowed_stores/
 *   current_store 机制解析，这个函数不关心权限判断，只接收结果）。
 */
export async function getBossOverview(pool, tenantId, storeFilter = []) {
  const today = shanghaiToday();
  try {
    const [revenue, operational, rankings, turnover, team] = await Promise.all([
      revenueRollup(pool, tenantId, today, storeFilter),
      operationalMetrics(pool, tenantId, today, storeFilter),
      storeRankings(pool, tenantId, today, storeFilter),
      turnoverSummary(pool, tenantId, storeFilter, getTurnoverRate),
      teamPerformanceSummary(pool, tenantId, storeFilter, periodOf(today)),
    ]);
    return { ok: true, asOf: today, scoped: storeFilter.length > 0, revenue, operational, rankings, turnover, team };
  } catch (e) {
    log.error({ msg: 'boss_overview_failed', err: e?.message || String(e) });
    return { ok: false, error: e?.message || 'server_error' };
  }
}
