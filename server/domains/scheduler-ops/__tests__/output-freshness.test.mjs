import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTPUT_FRESHNESS_ASSERTIONS,
  evaluateFreshness,
  evaluateMonthlyEmployeeScores,
} from '../output-freshness.js';
import {
  buildSchedulerOpsSnapshot,
  collectOutputFreshness,
  formatStaleOutputAlert,
  staleOutputDedupeKey,
} from '../service.js';

const H = 3600000;
const assertion = { key: 'k', label: 'BI 异常扣分', produces: 'V2 周度评分', maxAgeHours: 8 * 24 };

test('断言表：BI 异常扣分链路的两条断言都在', () => {
  const keys = OUTPUT_FRESHNESS_ASSERTIONS.map((a) => a.key);
  assert.ok(keys.includes('bi_anomaly_weekly_scores'));
  assert.ok(keys.includes('anomaly_triggers_daily'));
  for (const a of OUTPUT_FRESHNESS_ASSERTIONS) {
    assert.ok(a.label && a.produces, `${a.key} 必须说明产出方，否则运维拿到告警不知道去查哪个任务`);
    assert.match(a.sql, /AS latest/i, `${a.key} 的 SQL 必须返回 latest 列`);
  }
});

test('evaluateFreshness: 新鲜 → ok', () => {
  const r = evaluateFreshness(assertion, new Date(Date.now() - 20 * H));
  assert.equal(r.status, 'ok');
  assert.ok(r.ageHours >= 19 && r.ageHours <= 21);
});

test('evaluateFreshness: 超过阈值 → stale', () => {
  const r = evaluateFreshness(assertion, new Date(Date.now() - 300 * H));
  assert.equal(r.status, 'stale');
});

test('evaluateFreshness: 完全没有数据 → stale 而不是被忽略', () => {
  const r = evaluateFreshness(assertion, null);
  assert.equal(r.status, 'stale');
  assert.equal(r.detail, '没有任何数据');
});

test('月度评分：10 号之前不该因为"缺上月数据"报警', () => {
  // 2026-08-05：上月(2026-07)还没到生成日(08-10)，最新只有 2026-06 是正常的
  const r = evaluateMonthlyEmployeeScores({
    latestPeriod: '2026-06',
    now: new Date('2026-08-05T12:00:00+08:00'),
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.expectedPeriod, '2026-06');
});

test('月度评分：过了 10 号仍缺上月数据 → stale', () => {
  const r = evaluateMonthlyEmployeeScores({
    latestPeriod: '2026-06',
    now: new Date('2026-08-12T12:00:00+08:00'),
  });
  assert.equal(r.status, 'stale');
  assert.equal(r.expectedPeriod, '2026-07');
});

test('月度评分：完全没有数据 → stale', () => {
  const r = evaluateMonthlyEmployeeScores({ latestPeriod: null, now: new Date('2026-08-12T12:00:00+08:00') });
  assert.equal(r.status, 'stale');
});

test('collectOutputFreshness: 单条 SQL 失败不影响其它条', async () => {
  const pool = {
    query: async (sql) => {
      if (/anomaly_triggers/.test(sql)) throw new Error('relation missing');
      if (/employee_scores/.test(sql)) return { rows: [{ latest_period: '2026-06' }] };
      return { rows: [{ latest: new Date() }] };
    },
  };
  const items = await collectOutputFreshness(pool);
  const bad = items.find((i) => i.key === 'anomaly_triggers_daily');
  assert.equal(bad.status, 'error');
  assert.match(bad.detail, /relation missing/);
  // 其余条目仍然给出结论，不因为一条炸掉而整页失效
  assert.equal(items.find((i) => i.key === 'bi_anomaly_weekly_scores').status, 'ok');
});

test('buildSchedulerOpsSnapshot: 心跳健康但产出断档时，整体 ok 必须为 false', async () => {
  const pool = {
    query: async (sql) => {
      if (/FROM scheduler_heartbeat/.test(sql)) return { rows: [] };
      if (/employee_scores/.test(sql)) return { rows: [{ latest_period: '2099-01' }] };
      if (/agent_scores/.test(sql)) return { rows: [{ latest: new Date(Date.now() - 400 * H) }] };
      return { rows: [{ latest: new Date() }] };
    },
  };
  const snap = await buildSchedulerOpsSnapshot(pool, {
    uptimeMs: 60000,
    env: { DISABLE_AGENT_SCHEDULING: 'true' },
  });
  assert.equal(snap.schedulers.ok, true, '心跳侧应判定健康');
  assert.equal(snap.outputs.ok, false, 'BI 周度评分断档应被抓到');
  assert.equal(snap.ok, false, '整体必须为 false —— 这正是心跳监控看不见的故障');
  assert.ok(snap.outputs.stale.some((o) => o.key === 'bi_anomaly_weekly_scores'));
});

test('告警文案带上产出方，去重 key 与顺序无关', () => {
  const stale = [
    { key: 'b', label: 'BI 异常扣分', produces: 'V2 周度评分', detail: '最新数据距今 400 小时' },
    { key: 'a', label: '门店日报', produces: '门店提交', detail: '没有任何数据' },
  ];
  const msg = formatStaleOutputAlert(stale);
  assert.match(msg, /BI 异常扣分：最新数据距今 400 小时/);
  assert.match(msg, /产出方：V2 周度评分/);
  assert.equal(staleOutputDedupeKey(stale), 'a|b');
  assert.equal(staleOutputDedupeKey([...stale].reverse()), 'a|b');
});
