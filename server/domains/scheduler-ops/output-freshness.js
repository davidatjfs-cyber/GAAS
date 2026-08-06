/**
 * 业务产出新鲜度断言 —— 回答「任务跑了，但有没有真的产出东西」。
 *
 * 为什么需要这一层：心跳只能证明"函数被调用过"。2026-08-05 核查定时任务时，
 * 用户真正关心的问题是"BI 异常扣分有没有正常执行"，而这个问题**心跳答不了**——
 * 周度评分 tick 可能准时触发、心跳照跳，但内部查不到数据 / 抛异常吞掉 / 写库失败，
 * 结果就是 agent_scores 里一行新数据都没有，而监控全绿。
 *
 * 所以这里直接断言业务表的最新数据有多新：**看产出，不看过程**。
 * 这也是唯一能覆盖 agents-service-v2 侧任务的手段——那些 tick 跑在另一个进程里，
 * GAAS 拿不到它们的心跳，但两边共用同一个库，产出是看得见的。
 *
 * 每条断言只做一件事：一条 SQL 取"最新一条业务数据的时间"，跟 maxAgeHours 比。
 * 不做聚合、不做趋势判断——那是业务报表的事，不是存活监控的事。
 */

/**
 * @typedef {Object} FreshnessAssertion
 * @property {string} key
 * @property {string} label          面板展示名
 * @property {string} produces       这条数据由谁产出（排查时直接告诉运维去看哪个任务）
 * @property {number} maxAgeHours    超过这个时长没有新数据即判定异常
 * @property {string} sql            必须返回单行单列 `latest`（timestamptz / date / null）
 * @property {string} [note]         口径说明
 */

/** @type {FreshnessAssertion[]} */
export const OUTPUT_FRESHNESS_ASSERTIONS = [
  {
    key: 'bi_anomaly_weekly_scores',
    label: 'BI 异常扣分（周度评分）',
    produces: 'agents-service-v2 周度 periodic-scoring（每周一 00:0x）',
    // 每周一次 → 给 8 天：跨过一个完整周期还没有新行才算停摆，避免周末/延迟误报。
    maxAgeHours: 8 * 24,
    sql: `SELECT MAX(created_at) AS latest FROM agent_scores WHERE score_model = 'anomaly_rollups_v2'`,
    note: '员工月度综合评分的扣分来源；断档意味着当月扣分会静默按 100 分兜底',
  },
  {
    key: 'anomaly_triggers_daily',
    label: '异常触发明细',
    produces: 'agents-service-v2 每日巡检',
    maxAgeHours: 48,
    sql: `SELECT MAX(trigger_date)::timestamptz AS latest FROM anomaly_triggers`,
    note: 'BI 异常扣分的上游；这里没数据则周度评分必然扣不出分',
  },
  {
    key: 'daily_reports',
    label: '门店日报',
    produces: '门店提交 + GAAS 日报重建',
    maxAgeHours: 48,
    sql: `SELECT MAX(date)::timestamptz AS latest FROM daily_reports`,
  },
  {
    key: 'pos_order_items',
    label: 'POS 销售明细',
    produces: 'GAAS POS 导入（pos_sales_check / pos_feishu_sync_cron）',
    // 2026-08-06 用户确认：POS 明细实际按周更新，不是每日——48h 阈值对这条业务节奏来说
    // 太紧，会在正常的周内间隔里误报。给 9 天（跟本文件其它"每周一次"断言口径一致），
    // 真正断了一个完整周期以上才算异常。
    maxAgeHours: 9 * 24,
    sql: `SELECT MAX(checkout_time) AS latest FROM pos_order_items`,
    note: '营收类口径的唯一权威来源；按周更新，非每日',
  },
  {
    key: 'master_tasks',
    label: 'Master 任务派发',
    produces: 'agents-service-v2 master-agent tick',
    // GAAS 侧 DISABLE_AGENT_SCHEDULING=true，master tick 的心跳看不见，
    // 这条产出断言是判断"V2 的编排到底还活着没有"的唯一手段。
    maxAgeHours: 48,
    sql: `SELECT MAX(created_at) AS latest FROM master_tasks`,
  },
];

/**
 * 月度员工评分是"按日历门控"的：作业在每月 10 号 01:00 跑上一个月，
 * 10 号之前根本不该有上月数据，用固定 maxAgeHours 判定必然误报。
 * 单独用一条规则表达：**只有过了 10 号还缺上月数据才算异常**。
 *
 * @param {{ latestPeriod?: string|null, now?: Date }} input
 * @returns {{ status: 'ok'|'stale', expectedPeriod: string|null, detail: string }}
 */
export function evaluateMonthlyEmployeeScores({ latestPeriod = null, now = new Date() } = {}) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));

  // 10 号（含）之前：上上个月才是"应该已经有"的最新一期。
  const closedOffset = day >= 10 ? 1 : 2;
  const target = new Date(Date.UTC(year, month - 1 - closedOffset, 1));
  const expectedPeriod = `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}`;

  if (!latestPeriod) {
    return { status: 'stale', expectedPeriod, detail: `期望至少有 ${expectedPeriod}，实际没有任何数据` };
  }
  const ok = String(latestPeriod) >= expectedPeriod;
  return {
    status: ok ? 'ok' : 'stale',
    expectedPeriod,
    detail: ok
      ? `最新一期 ${latestPeriod}`
      : `期望至少有 ${expectedPeriod}，实际最新只有 ${latestPeriod}`,
  };
}

/**
 * @param {{ key: string, label: string, produces: string, maxAgeHours: number, note?: string }} assertion
 * @param {string|Date|null} latest
 * @param {number} [nowMs]
 */
export function evaluateFreshness(assertion, latest, nowMs = Date.now()) {
  const base = {
    key: assertion.key,
    label: assertion.label,
    produces: assertion.produces,
    maxAgeHours: assertion.maxAgeHours,
    note: assertion.note || null,
    latest: null,
    ageHours: null,
  };
  if (!latest) return { ...base, status: 'stale', detail: '没有任何数据' };
  const ms = new Date(latest).getTime();
  if (!Number.isFinite(ms)) return { ...base, status: 'stale', detail: '时间戳不可解析' };
  const ageHours = Math.round(((nowMs - ms) / 3600000) * 10) / 10;
  return {
    ...base,
    latest: new Date(ms).toISOString(),
    ageHours,
    status: ageHours > assertion.maxAgeHours ? 'stale' : 'ok',
    detail: `最新数据距今 ${ageHours} 小时（阈值 ${assertion.maxAgeHours} 小时）`,
  };
}
