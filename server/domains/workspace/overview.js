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
import { resolveAgentCanonicalStore, expandAgentStoreLabels } from '../../v2-store-alignment.js';

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

/** a、b 都是 YYYY-MM-DD，返回 a-b 的天数差（a晚于b时为正）。 */
function diffDays(a, b) {
  const da = new Date(`${a}T12:00:00+08:00`);
  const db = new Date(`${b}T12:00:00+08:00`);
  return Math.round((da.getTime() - db.getTime()) / 86400000);
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

export async function revenueRollup(pool, tenantId, today, storeFilter) {
  const yesterday = addDays(today, -1);
  // 2026-07-30 修复：之前"今日营收"字面锚在today——但当天日报几乎总是还没出（daily_reports
  // 里"今天"这一行往往要到当天结束才会有），业务方要求直接改成"昨日营收"（最近一个已经
  // 完整出报的自然日），同环比也都跟着改成"前天"/"去年昨日同天"。
  // 同理：之前"本周至今" week_revenue 的区间是"本周一到today"，today这一天几乎总是0，
  // 会把本周拉低、制造假的"环比下跌"（实测：周三查看时，因为周三当天还没出报，被误判成
  // 只有"周一+周二"两天的营收去跟上周一整周比，环比显示大跌，其实只是数据还没来）。
  // 2026-07-29 那次修复只把对比区间"长度"对齐了（上周同样天数），但当前区间的结束日
  // 仍然是today，没有解决"今天必然是0"这个根本问题。这次改成两头都锚定在"昨天"：
  // 本周至今 = 本周一 ~ 昨天，上周同期 = 上周一 ~ (上周一+同样天数)。
  const dayBeforeYesterday = addDays(today, -2);
  const yesterdayLY = addYears(yesterday, -1);

  const weekStart = mondayOf(today);
  // 到"昨天"为止本周已经完整过了几天；如果今天是周一，昨天(周日)还在上周，本周至今是0天
  // （SQL端用 date >= weekStart AND date <= weekEnd 在 weekEnd 传 null 时天然不命中任何行，
  // 不需要额外分支处理，COALESCE 会正确退化成0）。
  const weekElapsed = diffDays(yesterday, weekStart) + 1;
  const weekEnd = weekElapsed > 0 ? yesterday : null;
  const weekStartLW = addDays(weekStart, -7);
  const weekEndLW = weekElapsed > 0 ? addDays(weekStartLW, weekElapsed - 1) : null;
  const weekStartLY = addYears(weekStart, -1);
  const weekEndLY = weekEnd ? addYears(weekEnd, -1) : null;

  const monthStart = monthStartOf(today);
  const monthElapsed = diffDays(yesterday, monthStart) + 1;
  const monthEnd = monthElapsed > 0 ? yesterday : null;
  const monthStartLM = monthStartOf(addDays(monthStart, -1));
  const monthEndLM = monthElapsed > 0 ? addDays(monthStartLM, monthElapsed - 1) : null;
  const monthStartLY = addYears(monthStart, -1);
  const monthEndLY = monthEnd ? addYears(monthEnd, -1) : null;

  const revParams = [tenantId, yesterday, dayBeforeYesterday, yesterdayLY, weekStart, weekEnd, weekStartLW, weekEndLW, weekStartLY, weekEndLY, monthStart, monthEnd, monthStartLM, monthEndLM, monthStartLY, monthEndLY];
  const revFilter = storeFilterClause(storeFilter, revParams.length + 1);
  if (revFilter.param) revParams.push(revFilter.param);
  const r = await pool.query(
    `SELECT
        COALESCE(SUM(actual_revenue) FILTER (WHERE date = $2), 0) AS yesterday_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date = $3), 0) AS day_before_yesterday_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date = $4), 0) AS yesterday_ly_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $5 AND date <= $6), 0) AS week_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $7 AND date <= $8), 0) AS week_lw_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $9 AND date <= $10), 0) AS week_ly_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $11 AND date <= $12), 0) AS month_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $13 AND date <= $14), 0) AS month_lm_revenue,
        COALESCE(SUM(actual_revenue) FILTER (WHERE date >= $15 AND date <= $16), 0) AS month_ly_revenue
       FROM daily_reports
      WHERE tenant_id = $1${revFilter.sql}`,
    revParams
  );
  const row = r.rows[0] || {};

  // 2026-07-29 修复：之前只查"本月"这一个period，实测生产库revenue_targets最新一条是
  // 2026-04（本月2026-07根本没配），导致目标永远显示¥0——但月度营收目标业务上通常是
  // "设一次、沿用到改为止"，不是每个月都要重新录入。改成"往前找最近一个已配置的period"，
  // 找不到精确当月才会退化到0（不编数字，真没配过就是没有）。
  // 2026-07-30 第一次修复：上面这版逻辑找的是"全租户范围内最近的单一period"，不是"每个
  // 门店各自最近的period"——实测生产库洪潮门店最新配置到2026-03，马己仙配置到2026-04，
  // 取全局单一最近period(2026-04)后只有马己仙有这个period的行，SUM结果里洪潮被完全漏掉，
  // 管理员看到的"实收目标"变成只等于马己仙一家的目标，误以为"只接入了马己仙门店"。改成
  // 按门店各自找自己最近可用的period（不同店可以停留在不同月份），再把每店取到的目标加总。
  // 2026-07-30 第二次修复：洪潮门店(scoped角色，如出品经理/店长)看到的实收目标仍是¥0——
  // 查证发现revenue_targets.store存的是"洪潮久光店"这个缩写，跟storeFilter/员工表用的
  // 官方全称"洪潮大宁久光店"不是同一字符串，是这次会话里反复出现的同一类"门店名不统一"
  // 问题在revenue_targets这张表上又出现了一次——admin不传storeFilter时因为没有WHERE过滤
  // 侥幸能看到全部，一旦是店长/出品经理这种传了storeFilter的scoped视角，精确匹配必然
  // 查不到任何行。改用expandAgentStoreLabels()展开别名后ANY匹配，不再要求字符串完全相等。
  // 2026-08-02 第三次修复：洪潮/马己仙的"营业日目标"变成两个月份的目标相加（如洪潮显示
  // 175万=90万+85万）——查证发现revenue_targets里同一家店有两种store字符串共存："洪潮
  // 久光店"（旧缩写，2026-02/03两条历史行）和"洪潮大宁久光店"（官方全称，之后所有行）。
  // 上一版SQL用`GROUP BY store`在数据库层找"每店最近period"，这两个字符串在SQL眼里是
  // 两个不同的店，各自都算出了自己的latest_period（"洪潮久光店"最近到03月=85万，"洪潮
  // 大宁久光店"最近到08月=90万），alias展开后WHERE条件两个字符串都命中，于是两条本该是
  // 同一家店、只该取最新一条的记录被当成两家不同店，最终SUM两条都加了进去。SQL层做不到
  // "先按canonical归一化再GROUP BY"（resolveAgentCanonicalStore是JS函数），改成取全量
  // 候选行回JS里按canonical门店名去重取最新period，这份文件里operationalMetrics等多处
  // 已经用这个模式解决过同类问题。
  const targetAliasList = Array.isArray(storeFilter) && storeFilter.length
    ? [...new Set(storeFilter.flatMap((s) => expandAgentStoreLabels(s)))]
    : null;
  const targetParams = [tenantId, periodOf(today)];
  let targetFilterSql = '';
  if (targetAliasList) { targetParams.push(targetAliasList); targetFilterSql = ` AND store = ANY($${targetParams.length})`; }
  const targetRowsR = await pool.query(
    `SELECT store, period, target_revenue FROM revenue_targets
      WHERE tenant_id = $1 AND period <= $2${targetFilterSql}`,
    targetParams
  );
  const latestByCanon = new Map();
  for (const row of targetRowsR.rows || []) {
    const canon = resolveAgentCanonicalStore(row.store) || row.store;
    const prev = latestByCanon.get(canon);
    if (!prev || String(row.period) > String(prev.period)) latestByCanon.set(canon, row);
  }
  let targetRevenue = 0;
  for (const row of latestByCanon.values()) targetRevenue += Number(row.target_revenue || 0);

  const [y, m] = today.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  // 理论达成率的"已过天数"也跟着 month_revenue 的真实统计口径改成 monthElapsed（到昨天为止
  // 本月过了几天），不能再用 today 当天的日期数字——否则理论/实际两边的"分母天数"不一致。
  const theoreticalAchievementRate = Number(((Math.max(0, monthElapsed) / daysInMonth) * 100).toFixed(1));
  const actualAchievementRate = targetRevenue > 0 ? Number(((Number(row.month_revenue) / targetRevenue) * 100).toFixed(1)) : null;

  return {
    // 2026-07-30：按业务方要求，首页"今日营收"改成"昨日营收"（当天日报几乎总是还没出，
    // 显示今日会永远是¥0且环比永远-100%，误导性极强）。字段名跟着改成 yesterday，
    // mom=跟前天比，yoy=跟去年同一天比。
    yesterday: { revenue: Number(row.yesterday_revenue), mom: pctChange(row.yesterday_revenue, row.day_before_yesterday_revenue), yoy: pctChange(row.yesterday_revenue, row.yesterday_ly_revenue) },
    week: { revenue: Number(row.week_revenue), mom: pctChange(row.week_revenue, row.week_lw_revenue), yoy: pctChange(row.week_revenue, row.week_ly_revenue) },
    month: { revenue: Number(row.month_revenue), mom: pctChange(row.month_revenue, row.month_lm_revenue), yoy: pctChange(row.month_revenue, row.month_ly_revenue) },
    target: {
      targetRevenue,
      theoreticalAchievementRate,
      actualAchievementRate,
    },
  };
}

/** 品牌固定实收毛利目标（业务方拍板：马己仙65%，洪潮68%，不是从daily_reports读的
 * 逐日可变值——之前那套读法 daily_reports.actual_margin/target_margin 这两列压根没人
 * 写过，每月显示的都是空，这次改成真正对接数据源）。 */
const WS_BRAND_MARGIN_TARGET = { 马己仙: 65, 洪潮: 68 };

/** 毛利目标追踪——用户明确指出这块之前读错了数据源(daily_reports.actual_margin/
 * target_margin 从未被写入，永远是空)。实际数据来自飞书"实际毛利率"多维表格，已经有
 * agents-service-v2 的 bitable_actual_gross_margin 定时任务(每日05:16)在同步进
 * monthly_margins 表(每月10号前更新上月数据，跟用户要求的时间点一致)——不是要新建一套
 * 对接，是把这里的读取指向已经在跑的正确数据源。目标值改成品牌固定值，不再读
 * daily_reports.target_margin。
 * 这块UI(wsRenderTargetTracking)目前只用于门店视角(单店)，storeFilter预期是单元素数组；
 * 传多店/空(总部不限门店)时取第一个门店做代表，没有"跨店平均毛利率"这个业务概念。
 */
async function marginTracking(pool, tenantId, today, storeFilter) {
  const store = Array.isArray(storeFilter) && storeFilter.length ? storeFilter[0] : null;
  if (!store) return { actualMargin: null, targetMargin: null, period: null };
  try {
    // monthly_margins.store 存的是飞书表格里的门店简称（如"洪潮久光店"），跟
    // resolveAgentCanonicalStore() 归一化后的官方全称（"洪潮大宁久光店"）不是同一个
    // 字符串——精确匹配canon必然查不到行，一直显示空，跟revenue_targets同款问题，
    // 改用expandAgentStoreLabels()展开别名后ANY匹配。
    const aliases = expandAgentStoreLabels(store);
    const r = await pool.query(
      `SELECT brand, period, actual_margin
         FROM monthly_margins
        WHERE tenant_id = $1 AND store = ANY($2)
        ORDER BY period DESC LIMIT 1`,
      [tenantId, aliases]
    );
    const row = r.rows?.[0];
    if (!row) return { actualMargin: null, targetMargin: null, period: null };
    const brand = String(row.brand || '').trim();
    const targetMargin = WS_BRAND_MARGIN_TARGET[brand] ?? null;
    return {
      actualMargin: row.actual_margin != null ? Number(row.actual_margin) : null,
      targetMargin,
      period: row.period || null,
    };
  } catch (e) {
    log.error({ msg: 'margin_tracking_failed', err: e?.message || String(e) });
    return { actualMargin: null, targetMargin: null, period: null };
  }
}

/**
 * 2026-07-30 修复：① 之前全租户/全范围聚合成一个数字，用户明确要求"客流量/客单价/桌均/
 * 堂食外卖占比/就餐人数分布"必须按单店显示，否则看不出具体哪家店有问题——改成 GROUP BY
 * store 返回每店一条。② 堂食/外卖占比之前用 pos_orders.order_type 现数订单条数算，用户
 * 指出"数据都在营业日报里"——daily_reports 本来就有 dine_orders/delivery_orders 这两个
 * 权威字段（人工日报口径，跟营收目标同一份数据源），改成从这里取，不再用pos_orders现数。
 * 就餐人数分布(diners分桶)daily_reports没有对应字段，只能继续用pos_orders——但也补了
 * GROUP BY store_name做到按店。
 *
 * 2026-07-30 修复：就餐人数分布一直是0——查证发现 pos_orders.store_name 存的是POS原始
 * 长名（如"洪潮传统潮汕菜【大宁久光中心店】"），跟 daily_reports.store/员工表的官方简称
 * （"洪潮大宁久光店"）不是同一个字符串，且跟差评展示同款问题——之前按 store_name 精确/ANY
 * 过滤storeFilter必然查不到行，就算不限门店(admin)，下面按 row.store 做 Map 查找也会
 * 因为key不一致而永远查不到，所以这是全员都会中招的bug，不只是店长/出品经理范围过滤的锅。
 * 改成不在SQL层过滤/分组store_name，取回全量后用 resolveAgentCanonicalStore()
 * （同一套v2-store-alignment.js门店别名映射，差评展示同款修复已经在用）在JS里归一化成
 * 官方店名再做分组/过滤/Map查找。
 */
export async function operationalMetrics(pool, tenantId, today, storeFilter) {
  // 同 revenueRollup 的修复——"本月至今"锚点从 today 改成 yesterday（今天的日报/POS当天
  // 数据几乎总是还没走完，锚在today会把当月拉低出现假环比）。
  const yesterday = addDays(today, -1);
  const monthStart = monthStartOf(today);
  const monthElapsed = diffDays(yesterday, monthStart) + 1;
  const monthEnd = monthElapsed > 0 ? yesterday : null;
  const monthStartLM = monthStartOf(addDays(monthStart, -1));
  const monthEndLM = monthElapsed > 0 ? addDays(monthStartLM, monthElapsed - 1) : null;
  const monthStartLY = addYears(monthStart, -1);
  const monthEndLY = monthEnd ? addYears(monthEnd, -1) : null;

  const opParams = [tenantId, monthStart, monthEnd, monthStartLM, monthEndLM, monthStartLY, monthEndLY];
  const opFilter = storeFilterClause(storeFilter, opParams.length + 1);
  if (opFilter.param) opParams.push(opFilter.param);
  const r = await pool.query(
    `SELECT store,
        COALESCE(SUM(dine_traffic) FILTER (WHERE date >= $2 AND date <= $3), 0) AS traffic,
        COALESCE(SUM(dine_revenue) FILTER (WHERE date >= $2 AND date <= $3), 0) AS dine_revenue,
        COALESCE(SUM(dine_orders) FILTER (WHERE date >= $2 AND date <= $3), 0) AS dine_orders,
        COALESCE(SUM(delivery_orders) FILTER (WHERE date >= $2 AND date <= $3), 0) AS delivery_orders,
        COALESCE(SUM(dine_traffic) FILTER (WHERE date >= $4 AND date <= $5), 0) AS traffic_lm,
        COALESCE(SUM(dine_traffic) FILTER (WHERE date >= $6 AND date <= $7), 0) AS traffic_ly,
        AVG(NULLIF(efficiency, 0)) FILTER (WHERE date >= $2 AND date <= $3) AS efficiency
       FROM daily_reports
      WHERE tenant_id = $1${opFilter.sql}
      GROUP BY store`,
    opParams
  );

  const posParams = [tenantId, monthStart, monthEnd];
  const posR = await pool.query(
    `SELECT store_name AS store,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners = 1) AS p1,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners = 2) AS p2,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners BETWEEN 3 AND 4) AS p3_4,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners BETWEEN 5 AND 6) AS p5_6,
        COUNT(*) FILTER (WHERE order_type = '堂食' AND diners > 6) AS p6plus,
        COUNT(*) FILTER (WHERE order_type = '堂食') AS dine_party_cnt
       FROM pos_orders
      WHERE tenant_id = $1 AND biz_date >= $2 AND biz_date <= $3
      GROUP BY store_name`,
    posParams
  );
  const storeFilterSet = Array.isArray(storeFilter) && storeFilter.length ? new Set(storeFilter) : null;
  const posByStore = new Map();
  const numFields = ['p1', 'p2', 'p3_4', 'p5_6', 'p6plus', 'dine_party_cnt'];
  for (const row of posR.rows || []) {
    const canon = resolveAgentCanonicalStore(row.store) || row.store;
    if (storeFilterSet && !storeFilterSet.has(canon)) continue;
    const existing = posByStore.get(canon);
    if (!existing) { posByStore.set(canon, { ...row, store: canon }); continue; }
    for (const f of numFields) existing[f] = Number(existing[f] || 0) + Number(row[f] || 0);
  }

  return (r.rows || []).map((row) => {
    const traffic = Number(row.traffic);
    const dineRevenue = Number(row.dine_revenue);
    const dineOrders = Number(row.dine_orders);
    const deliveryOrders = Number(row.delivery_orders);
    const totalOrders = dineOrders + deliveryOrders;
    const posRow = posByStore.get(row.store) || {};
    const dinePartyTotal = Number(posRow.dine_party_cnt) || 0;
    const pct = (n) => (dinePartyTotal > 0 ? Number(((Number(n) / dinePartyTotal) * 100).toFixed(1)) : null);
    return {
      store: row.store,
      traffic,
      trafficMom: pctChange(traffic, row.traffic_lm),
      trafficYoy: pctChange(traffic, row.traffic_ly),
      avgSpendPerGuest: traffic > 0 ? Number((dineRevenue / traffic).toFixed(2)) : null,
      avgSpendPerTable: dineOrders > 0 ? Number((dineRevenue / dineOrders).toFixed(2)) : null,
      // 2026-07-30：用户要求门店经营明细里补上人效值——跟storeRankings的人效排名同一份数据源
      // (daily_reports.efficiency，本月AVG，取整)，这里直接算一份，不复用storeRankings返回的
      // 数组（那边只保留有效值门店、且已排序，这里要求"每店都有一条"，字段单独查更直接）。
      efficiency: row.efficiency != null ? Math.round(Number(row.efficiency)) : null,
      dineInSharePct: totalOrders > 0 ? Number(((dineOrders / totalOrders) * 100).toFixed(1)) : null,
      deliverySharePct: totalOrders > 0 ? Number(((deliveryOrders / totalOrders) * 100).toFixed(1)) : null,
      partySizeSharePct: {
        p1: pct(posRow.p1),
        p2: pct(posRow.p2),
        p3to4: pct(posRow.p3_4),
        p5to6: pct(posRow.p5_6),
        p6plus: pct(posRow.p6plus),
      },
    };
  });
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
    // 用户反馈人效小数位太多，人效本身就是"人均产出"这种粗粒度指标，取整数展示。
    efficiency: row.efficiency != null ? Math.round(Number(row.efficiency)) : null,
  }));
  return {
    byRevenue: [...rows].sort((a, b) => b.revenue - a.revenue),
    byTraffic: [...rows].sort((a, b) => b.traffic - a.traffic),
    byEfficiency: [...rows].filter((r2) => r2.efficiency != null).sort((a, b) => b.efficiency - a.efficiency),
  };
}

/** 门店员工离职率（当月累计）——复用已有的 getTurnoverRate()（server/hrms-api-tools.js），
 * 不重新实现一套计算逻辑。按门店名单逐店查询，返回汇总+按店明细。
 * 2026-07-30：用户要求把"本月离职率"从工作台顶层挪进"门店经营明细"，每店各自一条，
 * 不再是一个跨全部门店的聚合数字——storeNames 现在必须是具体门店名单，不能再用
 * storeFilter为空时退化成单次全量查询(旧逻辑那样admin看不到分店明细)。
 */
async function turnoverSummary(pool, tenantId, storeNames, getTurnoverRate) {
  if (typeof getTurnoverRate !== 'function') return null;
  const stores = Array.isArray(storeNames) && storeNames.length ? storeNames : [''];
  const results = await Promise.all(stores.map((s) => getTurnoverRate(s, 1)));
  const byStore = stores.map((s, i) => ({ store: s, ...results[i] })).filter((x) => x.store);
  const totalDepartures = results.reduce((s, r) => s + (r?.departures || 0), 0);
  const totalEmployees = results.reduce((s, r) => s + (r?.totalEmployees || 0), 0);
  return {
    byStore,
    departures: totalDepartures,
    totalEmployees,
    turnoverRate: totalEmployees > 0 ? Number(((totalDepartures / totalEmployees) * 100).toFixed(1)) : null,
  };
}

// 2026-08-02：用户核实发现工作台"下属绩效评级"的分数跟agents-service-v2自己的管理台
// （https://nnyx.cc/agents-admin/#performance，"实时月内快照"）对不上，且换月份筛选
// 数字不变——根因是之前整块直接读employee_scores这张GAAS自己批量算好落库的缓存表：
// ①它的名单来自"哪些人在employee_scores里有行"，不是"当前真实在职员工"，历史批次
// 可能把已经调走的门店/岗位也留在里面（如"喻烽"同时出现在洪潮和马己仙两条）；
// ②批次没跑到当月/上月就查不到数据（这也是上一版加period fallback的原因，但那只是
// 掩盖症状，退化显示的还是旧月份的分数，看着像"没跟着月份变"）；③它在真实周度扣分
// 基础上又自己叠加了一层异常加减分/人效扣分，口径跟agents-admin的"实时月内快照"
// （agents-service-v2 admin-api-performance-monthly.js: 未关账月=最新一条本月周度
// anomaly_rollups_v2的total_score原样展示，不再叠加）不一致，导致同一个人两边分数不同
// （王世波：GAAS算出-135，agents-admin显示-75）。
// 改成：①名单直接查employees表（真实在职员工，不依赖批次是否跑过）；②分数直接查
// agent_scores（GAAS/agents-service-v2共享表，agents-service-v2是唯一写入方，这里只读），
// 完全复刻agents-admin同一套逻辑——先查score_model='new_model_monthly'的关账月最终分，
// 查不到就退化到本月最新一条周度anomaly_rollups_v2的total_score（未关账"实时快照"）；
// ③评级(execution/attitude/ability_rating)继续读employee_scores（GAAS自有概念，
// agents-service-v2没有对应数据，关账前本来就是空，不算这次要修的问题）。
// 2026-08-02：用户核实喻烽7月充值/包房/服务三类扣了121分，但月度分数显示81分——查证
// agents-service-v2生产库发现同一个period(如week_2026-07-27__202607)有两条冲突的行：
// 一条本月累计已扣19分/总分81(旧的、扣分还没算完的周度计算)，另一条updated_at更晚、
// 本月累计已扣102分/总分-2(更完整)。这个函数是从agents-service-v2 admin-api-monthly-
// helpers.js原样复刻过来的("下属绩效评级"改real-time数据源那次)，那边假设同一period
// 不会有重复行，直接取数组最后一个元素——配合调用方`ORDER BY period ASC, updated_at
// DESC`，同一period内多条反而是updated_at最旧的排在数组最后，被误选中。两边一起改成
// 显式按period找最大值，同period内部按updated_at取最新，不依赖数组位置（agents-service-v2
// 那边的admin-api-monthly-helpers.js已经同步修了这个函数，这里保持口径一致）。
function getRealtimeMonthlyScoreFromWeeklyRows(weeklyRows) {
  const rows = weeklyRows || [];
  if (!rows.length) return null;
  let maxPeriod = null;
  for (const r of rows) {
    if (maxPeriod === null || String(r?.period) > String(maxPeriod)) maxPeriod = r?.period;
  }
  let best = null;
  for (const r of rows) {
    if (r?.period !== maxPeriod) continue;
    if (!best || new Date(r?.updated_at || 0) > new Date(best?.updated_at || 0)) best = r;
  }
  const score = Number(best?.total_score);
  return Number.isFinite(score) ? score : null;
}

// 2026-08-02：查证发现喻烽同时在agent_scores里有马己仙(旧，score=81，未受本月扣分影响)
// 和洪潮(现在实际所在门店，score=-2，已扣121分)两条记录——之前这里只按username过滤，
// 会把两家店的周度记录混在一起，取"最新一条"全凭updated_at巧合。改成必须按store精确
// 匹配，只统计"这个人在这家店"的周度记录，不再跨店混算（agents-service-v2那边同款查询
// admin-api-performance-monthly.js已经同步修了）。
async function loadWeeklyRollupScore(pool, tenantId, username, store, period) {
  const monthStart = `${period}-01`;
  const monthEnd = monthEndYmdOf(period);
  const monthKey = period.replace('-', '');
  const r = await pool.query(
    `SELECT period, total_score, updated_at
       FROM agent_scores
      WHERE lower(trim(username)) = lower(trim($1))
        AND lower(trim(coalesce(store, ''))) = lower(trim($6))
        AND score_model = 'anomaly_rollups_v2'
        AND COALESCE(is_invalidated, false) = false
        AND period LIKE 'week_%'
        AND tenant_id = $5
        AND (
          (POSITION('__' IN period) = 0
            AND substring(period from 6 for 10)::date >= $2::date
            AND substring(period from 6 for 10)::date <= $3::date)
          OR
          (POSITION('__' IN period) > 0 AND split_part(period, '__', 2) = $4)
        )
      ORDER BY period ASC, updated_at DESC`,
    [username, monthStart, monthEnd, monthKey, tenantId, store]
  );
  return getRealtimeMonthlyScoreFromWeeklyRows(r.rows || []);
}

function monthEndYmdOf(period) {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(lastDay).padStart(2, '0')}`;
}

async function loadFinalizedMonthlyScore(pool, tenantId, username, store, role, period) {
  const r = await pool.query(
    `SELECT total_score FROM agent_scores
      WHERE lower(trim(username)) = lower(trim($1))
        AND lower(trim(store)) = lower(trim($2))
        AND role = $3 AND period = $4
        AND score_model = 'new_model_monthly'
        AND COALESCE(is_invalidated, false) = false
        AND tenant_id = $5
      ORDER BY updated_at DESC LIMIT 1`,
    [username, store, role, period, tenantId]
  );
  const v = r.rows?.[0]?.total_score;
  return v != null ? Number(v) : null;
}

async function teamPerformanceSummary(pool, tenantId, storeFilter, period, roleScope) {
  const params = [tenantId];
  const filter = storeFilterClause(storeFilter, params.length + 1);
  if (filter.param) params.push(filter.param);
  let roleSql = '';
  if (Array.isArray(roleScope) && roleScope.length) {
    params.push(roleScope);
    roleSql = ` AND role = ANY($${params.length}::text[])`;
  }
  const subjects = await pool.query(
    `SELECT username, name, store, role, position
       FROM employees
      WHERE tenant_id = $1 AND status = 'active'${filter.sql}${roleSql}
      ORDER BY store, role, name`,
    params
  );
  if (!subjects.rows?.length) return [];

  const ratingsR = await pool.query(
    `SELECT username, execution_rating, attitude_rating, ability_rating
       FROM employee_scores WHERE tenant_id = $1 AND period = $2`,
    [tenantId, period]
  );
  const ratingsByUser = new Map(ratingsR.rows.map((r) => [String(r.username || '').toLowerCase(), r]));

  const rows = await Promise.all(subjects.rows.map(async (s) => {
    const finalized = await loadFinalizedMonthlyScore(pool, tenantId, s.username, s.store, s.role, period);
    const totalScore = finalized != null ? finalized : await loadWeeklyRollupScore(pool, tenantId, s.username, s.store, period);
    const rating = ratingsByUser.get(String(s.username || '').toLowerCase()) || {};
    return {
      username: s.username, name: s.name, store: s.store, role: s.role, position: s.position,
      total_score: totalScore,
      execution_rating: rating.execution_rating || null,
      attitude_rating: rating.attitude_rating || null,
      ability_rating: rating.ability_rating || null,
    };
  }));
  rows.sort((a, b) => (b.total_score ?? -Infinity) - (a.total_score ?? -Infinity));
  return rows;
}

/**
 * @param {string[]} storeFilter 空数组/undefined = 不限门店（老板）；非空 = 只看这些门店
 *   （hq_manager/营运经理按各自负责的门店范围传入，范围本身由现有 allowed_stores/
 *   current_store 机制解析，这个函数不关心权限判断，只接收结果）。
 */
// 2026-08-01：加月份筛选——所有下游(revenueRollup/operationalMetrics/storeRankings/
// marginTracking)本来就是纯按传入的 today 参数算"本月/本周/昨日"等区间，没有任何内部
// 硬编码 new Date()，所以查历史月份不需要改这些函数，只需要把 today 换成"该月最后一天"
// （当月本身若被选中则用真实今天，避免"本月至今"变成整月虚报未发生的数据）。
function resolveAsOfDate(month) {
  const m = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return shanghaiToday();
  const today = shanghaiToday();
  if (m === today.slice(0, 7)) return today; // 选中的就是当月，仍用真实今天
  const [y, mo] = m.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // 次月第0天=当月最后一天
  return `${m}-${String(lastDay).padStart(2, '0')}`;
}

const WS_TEAM_STORE_LEVEL_ROLES = ['store_manager', 'store_production_manager', 'front_manager', 'front_supervisor'];

/** 下属绩效评级板块的角色范围：总部视角(admin/hq_manager)只看各店店长/出品经理；
 * 店内视角(store_manager/store_production_manager等)看自己店里所有人；其它角色(普通
 * 员工)不显示这块——返回 null，调用方据此跳过整个查询。 */
function resolveTeamRoleScope(viewerRole) {
  const role = String(viewerRole || '').trim();
  if (role === 'admin' || role === 'hq_manager') return ['store_manager', 'store_production_manager'];
  if (WS_TEAM_STORE_LEVEL_ROLES.includes(role)) return [];
  return null;
}

export async function getBossOverview(pool, tenantId, storeFilter = [], month = '', viewerRole = '') {
  const today = resolveAsOfDate(month);
  try {
    const teamRoleScope = resolveTeamRoleScope(viewerRole);
    const [revenue, operational, rankings, team, margin] = await Promise.all([
      revenueRollup(pool, tenantId, today, storeFilter),
      operationalMetrics(pool, tenantId, today, storeFilter),
      storeRankings(pool, tenantId, today, storeFilter),
      teamRoleScope == null ? Promise.resolve([]) : teamPerformanceSummary(pool, tenantId, storeFilter, periodOf(today), teamRoleScope),
      marginTracking(pool, tenantId, today, storeFilter),
    ]);
    // 2026-07-30：用户要求"本月离职率"从顶层挪进"门店经营明细"，按店各自展示——离职率查询
    // 需要具体门店名单才能算出每店各自的值，storeFilter为空(admin不限门店)时不能再退化成
    // 单次全量查询，改成用operational结果里已经解析出的真实门店名单(每店一条)。
    const storeNames = operational.map((o) => o.store).filter(Boolean);
    const turnover = await turnoverSummary(pool, tenantId, storeNames, getTurnoverRate);
    const turnoverByStore = new Map((turnover?.byStore || []).map((t) => [t.store, t]));
    for (const row of operational) {
      const t = turnoverByStore.get(row.store);
      row.turnoverRate = t?.turnoverRate ?? null;
      row.turnoverDepartures = t?.departures ?? null;
      row.turnoverTotalEmployees = t?.totalEmployees ?? null;
    }
    return { ok: true, asOf: today, scoped: storeFilter.length > 0, revenue, operational, rankings, turnover, team, margin };
  } catch (e) {
    log.error({ msg: 'boss_overview_failed', err: e?.message || String(e) });
    return { ok: false, error: e?.message || 'server_error' };
  }
}

/**
 * 2026-07-30 修复：当月目标追踪里"目标管理"录入的其他目标项(充值/点评星级/企微新增等)
 * 一直显示"系统暂未接入该指标的自动核算，需人工核对"——用户明确指出这不对，除了毛利是
 * 每月10号前录入飞书毛利记录表(monthly_margins)以外，其它目标项的"实际值"全部已经在
 * 营业日报(daily_reports)里，只是之前没人接这个查询。这里按 frontend/07-promotion.js
 * MT_ALL_FIELDS 定义的 key 逐一从 daily_reports 聚合出本月实际值；eleme/meituan 分渠道明细
 * daily_reports 没有单独字段(只有delivery_actual这个外卖总计，没有拆分平台)，如实返回
 * null，不是这里的疏漏，是数据源本身没有这个粒度。
 */
export async function getMonthlyTargetActuals(pool, tenantId, store, ym) {
  const monthStart = ym + '-01';
  const [y, m] = ym.split('-').map(Number);
  const monthEndExclusive = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const r = await pool.query(
    `SELECT
        COALESCE(SUM(actual_revenue), 0) AS actual,
        COALESCE(SUM(pre_discount_revenue), 0) AS gross,
        COALESCE(SUM(budget), 0) AS budget,
        COALESCE(SUM(recharge_amount), 0) AS recharge,
        COALESCE(SUM(recharge_count), 0) AS "rechargeCount",
        COALESCE(SUM(dine_revenue), 0) AS "dineRevenue",
        COALESCE(SUM(dine_orders), 0) AS "dineOrders",
        COALESCE(SUM(dine_traffic), 0) AS "dineTraffic",
        COALESCE(SUM(total_discount), 0) AS "discountTotal",
        COALESCE(SUM((segments->>'noon')::numeric), 0) AS noon,
        COALESCE(SUM((segments->>'afternoon')::numeric), 0) AS afternoon,
        COALESCE(SUM((segments->>'night')::numeric), 0) AS night,
        COALESCE(SUM((categories->'water'->>'amt')::numeric), 0) AS "waterAmt",
        COALESCE(SUM((categories->'water'->>'qty')::numeric), 0) AS "waterQty",
        COALESCE(SUM((categories->'soup'->>'amt')::numeric), 0) AS "soupAmt",
        COALESCE(SUM((categories->'soup'->>'qty')::numeric), 0) AS "soupQty",
        COALESCE(SUM((categories->'roast'->>'amt')::numeric), 0) AS "roastAmt",
        COALESCE(SUM((categories->'roast'->>'qty')::numeric), 0) AS "roastQty",
        COALESCE(SUM((categories->'wok'->>'amt')::numeric), 0) AS "wokAmt",
        COALESCE(SUM((categories->'wok'->>'qty')::numeric), 0) AS "wokQty",
        COALESCE(SUM(bad_reviews_dianping), 0) AS "badDianping",
        COALESCE(SUM(new_wechat_members), 0) AS "wechatMonthNew",
        (array_agg(dianping_rating ORDER BY date DESC) FILTER (WHERE dianping_rating IS NOT NULL))[1] AS "dianpingRating"
       FROM daily_reports
      WHERE tenant_id = $1 AND store = $2 AND date >= $3 AND date < $4`,
    [tenantId, store, monthStart, monthEndExclusive]
  );
  const row = r.rows[0] || {};

  let marginActual = null;
  try {
    const canon = resolveAgentCanonicalStore(store) || store;
    const mr = await pool.query(
      `SELECT actual_margin FROM monthly_margins WHERE store = $1 AND period = $2 LIMIT 1`,
      [canon, ym]
    );
    marginActual = mr.rows[0]?.actual_margin != null ? Number(mr.rows[0].actual_margin) : null;
  } catch (e) {
    log.error({ msg: 'monthly_target_actuals_margin_failed', err: e?.message || String(e) });
  }

  const numOrNull = (v) => (v == null ? null : Number(v));
  return {
    actual: numOrNull(row.actual),
    margin: marginActual,
    gross: numOrNull(row.gross),
    budget: numOrNull(row.budget),
    recharge: numOrNull(row.recharge),
    rechargeCount: numOrNull(row.rechargeCount),
    dineRevenue: numOrNull(row.dineRevenue),
    dineOrders: numOrNull(row.dineOrders),
    dineTraffic: numOrNull(row.dineTraffic),
    elemeRevenue: null, elemeOrders: null, elemeActual: null,
    meituanRevenue: null, meituanOrders: null, meituanActual: null,
    discountTotal: numOrNull(row.discountTotal),
    noon: numOrNull(row.noon), afternoon: numOrNull(row.afternoon), night: numOrNull(row.night),
    waterAmt: numOrNull(row.waterAmt), waterQty: numOrNull(row.waterQty),
    soupAmt: numOrNull(row.soupAmt), soupQty: numOrNull(row.soupQty),
    roastAmt: numOrNull(row.roastAmt), roastQty: numOrNull(row.roastQty),
    wokAmt: numOrNull(row.wokAmt), wokQty: numOrNull(row.wokQty),
    badDianping: numOrNull(row.badDianping), badMeituan: null, badEleme: null,
    dianpingRating: numOrNull(row.dianpingRating),
    wechatMonthNew: numOrNull(row.wechatMonthNew),
  };
}
