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
/**
 * ⚠️ 只登记 **GAAS 自己产出** 的数据（2026-08-06 去重叠）。
 *
 * 原先这里还断言了 agent_scores（BI 异常扣分）、anomaly_triggers、master_tasks、
 * employee_scores 四项——但这四张表的写入方都是 agents-service-v2。V2 侧有自己的
 * cron 运行台账（agent_v2_cron_runs，失败即时飞书告警）和自己的面板，两边同时断言
 * 同一份产出，一次故障会收到两条来源不同的告警，运维还要先判断"这是同一件事吗"。
 * 那四项已迁到 V2 面板，本文件只保留 GAAS 写入的表。
 *
 * 加新断言前先确认：这张表是 GAAS 写的吗？不是就别加在这里。
 * （注意 pos_order_items 是个反例：它被 GAAS 和 V2 双写，违反 CLAUDE.md 的共享表矩阵，
 *   已作为独立问题记录，不在本文件断言，避免把"双写"问题伪装成"新鲜度"问题。）
 */
export const OUTPUT_FRESHNESS_ASSERTIONS = [
  {
    key: 'daily_reports',
    label: '门店日报',
    produces: '门店提交 + GAAS 日报重建',
    maxAgeHours: 48,
    sql: `SELECT MAX(date)::timestamptz AS latest FROM daily_reports`,
  },
];

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
