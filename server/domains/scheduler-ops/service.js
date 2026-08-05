/**
 * 全局定时任务面板的数据组装：调度存活（心跳）+ 业务产出新鲜度。
 * 纯逻辑 + SQL，不碰 req/res。
 */
import { evaluateSchedulerHealth } from '../health/scheduler-registry.js';
import {
  OUTPUT_FRESHNESS_ASSERTIONS,
  evaluateFreshness,
  evaluateMonthlyEmployeeScores,
} from './output-freshness.js';

const HEARTBEAT_SQL = `
  SELECT task_name, last_beat, status, last_error, duration_ms, last_success_at
  FROM scheduler_heartbeat`;

const MONTHLY_SCORES_SQL = `SELECT MAX(period) AS latest_period FROM employee_scores`;

/**
 * 逐条跑产出断言。单条失败不影响其它条——面板的价值就在于"一屏看全"，
 * 不能因为某张表查不动就整页 500。
 * @param {import('pg').Pool} pool
 */
export async function collectOutputFreshness(pool, nowMs = Date.now()) {
  const results = await Promise.all(
    OUTPUT_FRESHNESS_ASSERTIONS.map(async (assertion) => {
      try {
        const r = await pool.query(assertion.sql);
        return evaluateFreshness(assertion, r.rows?.[0]?.latest ?? null, nowMs);
      } catch (e) {
        return {
          key: assertion.key,
          label: assertion.label,
          produces: assertion.produces,
          maxAgeHours: assertion.maxAgeHours,
          note: assertion.note || null,
          latest: null,
          ageHours: null,
          status: 'error',
          detail: `查询失败：${String(e?.message || e)}`,
        };
      }
    })
  );

  try {
    const r = await pool.query(MONTHLY_SCORES_SQL);
    const monthly = evaluateMonthlyEmployeeScores({
      latestPeriod: r.rows?.[0]?.latest_period ?? null,
      now: new Date(nowMs),
    });
    results.push({
      key: 'employee_scores_monthly',
      label: '员工月度综合评分',
      produces: 'GAAS performance-jobs（每月 10 号 01:00）',
      maxAgeHours: null,
      note: '按日历门控，10 号前不该有上月数据',
      latest: null,
      ageHours: null,
      status: monthly.status,
      detail: monthly.detail,
    });
  } catch (e) {
    results.push({
      key: 'employee_scores_monthly',
      label: '员工月度综合评分',
      produces: 'GAAS performance-jobs（每月 10 号 01:00）',
      maxAgeHours: null,
      note: null,
      latest: null,
      ageHours: null,
      status: 'error',
      detail: `查询失败：${String(e?.message || e)}`,
    });
  }

  return results;
}

/**
 * 面板与告警共用的一次性快照。
 * @param {import('pg').Pool} pool
 * @param {{ nowMs?: number, uptimeMs?: number, env?: Record<string, string|undefined> }} [opts]
 */
export async function buildSchedulerOpsSnapshot(pool, opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const uptimeMs = opts.uptimeMs ?? process.uptime() * 1000;

  const [heartbeatRows, outputs] = await Promise.all([
    pool.query(HEARTBEAT_SQL).then((r) => r.rows || []).catch(() => []),
    collectOutputFreshness(pool, nowMs),
  ]);

  const schedulers = evaluateSchedulerHealth({
    rows: heartbeatRows,
    nowMs,
    uptimeMs,
    env: opts.env ?? process.env,
  });

  const staleOutputs = outputs.filter((o) => o.status === 'stale' || o.status === 'error');
  return {
    generatedAt: new Date(nowMs).toISOString(),
    ok: schedulers.ok && staleOutputs.length === 0,
    schedulers: {
      ok: schedulers.ok,
      checked: schedulers.checked,
      counts: countByStatus(schedulers.tasks),
      tasks: schedulers.tasks,
      unhealthy: schedulers.unhealthy,
    },
    outputs: {
      ok: staleOutputs.length === 0,
      checked: outputs.length,
      items: outputs,
      stale: staleOutputs,
    },
  };
}

function countByStatus(tasks) {
  const counts = {};
  for (const t of tasks || []) counts[t.status] = (counts[t.status] || 0) + 1;
  return counts;
}

/**
 * P3 告警文案：把产出断档翻译成"哪个任务没出东西"，而不是丢一个表名给运维。
 * @param {Array<{label: string, produces: string, detail: string}>} staleOutputs
 */
export function formatStaleOutputAlert(staleOutputs) {
  return (staleOutputs || [])
    .map((o) => `· ${o.label}：${o.detail}\n  产出方：${o.produces}`)
    .join('\n');
}

/** 去重 key：按 key + 是否异常，状态不变就不重复播报。 */
export function staleOutputDedupeKey(staleOutputs) {
  return (staleOutputs || []).map((o) => o.key).sort().join('|');
}
