import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTPUT_FRESHNESS_ASSERTIONS,
  evaluateFreshness,
} from '../output-freshness.js';
import {
  buildSchedulerOpsSnapshot,
  collectOutputFreshness,
  formatStaleOutputAlert,
  staleOutputDedupeKey,
} from '../service.js';

const H = 3600000;
const assertion = { key: 'k', label: '门店日报', produces: '门店提交', maxAgeHours: 48 };

test('断言表只登记 GAAS 自己写的表（去重叠护栏）', () => {
  const keys = OUTPUT_FRESHNESS_ASSERTIONS.map((a) => a.key);
  assert.ok(keys.includes('daily_reports'));
  // agent_scores / anomaly_triggers / master_tasks / employee_scores 的写入方都是
  // agents-service-v2，已迁到 V2 面板。留在这里会造成同一故障两边各报一次警。
  for (const v2Owned of ['bi_anomaly_weekly_scores', 'anomaly_triggers_daily', 'master_tasks', 'employee_scores_monthly']) {
    assert.ok(!keys.includes(v2Owned), `${v2Owned} 由 agents-service-v2 产出，不该在 GAAS 断言`);
  }
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

test('collectOutputFreshness: 单条 SQL 失败不影响其它条', async () => {
  const pool = {
    query: async (sql) => {
      if (/daily_reports/.test(sql)) throw new Error('relation missing');
      return { rows: [{ latest: new Date() }] };
    },
  };
  const items = await collectOutputFreshness(pool);
  const bad = items.find((i) => i.key === 'daily_reports');
  assert.equal(bad.status, 'error');
  assert.match(bad.detail, /relation missing/);
});

test('buildSchedulerOpsSnapshot: 心跳健康但产出断档时，整体 ok 必须为 false', async () => {
  const pool = {
    query: async (sql) => {
      if (/FROM scheduler_heartbeat/.test(sql)) return { rows: [] };
      if (/daily_reports/.test(sql)) return { rows: [{ latest: new Date(Date.now() - 400 * H) }] };
      return { rows: [{ latest: new Date() }] };
    },
  };
  const snap = await buildSchedulerOpsSnapshot(pool, {
    uptimeMs: 60000,
    env: { DISABLE_AGENT_SCHEDULING: 'true' },
  });
  assert.equal(snap.schedulers.ok, true, '心跳侧应判定健康');
  assert.equal(snap.outputs.ok, false, '门店日报断档应被抓到');
  assert.equal(snap.ok, false, '整体必须为 false —— 这正是心跳监控看不见的故障');
  assert.ok(snap.outputs.stale.some((o) => o.key === 'daily_reports'));
});

test('快照里不出现委托给 agents-service-v2 的任务', async () => {
  const pool = {
    query: async (sql) => {
      if (/FROM scheduler_heartbeat/.test(sql)) return { rows: [] };
      return { rows: [{ latest: new Date() }] };
    },
  };
  const snap = await buildSchedulerOpsSnapshot(pool, {
    uptimeMs: 60000,
    env: { DISABLE_AGENT_SCHEDULING: 'true' },
  });
  assert.ok(!snap.schedulers.tasks.some((t) => String(t.task_name).startsWith('master_')));
});

test('告警文案带上产出方，去重 key 与顺序无关', () => {
  const stale = [
    { key: 'b', label: '门店日报', produces: '门店提交', detail: '最新数据距今 400 小时' },
    { key: 'a', label: 'POS 明细', produces: 'POS 导入', detail: '没有任何数据' },
  ];
  const msg = formatStaleOutputAlert(stale);
  assert.match(msg, /门店日报：最新数据距今 400 小时/);
  assert.match(msg, /产出方：门店提交/);
  assert.equal(staleOutputDedupeKey(stale), 'a|b');
  assert.equal(staleOutputDedupeKey([...stale].reverse()), 'a|b');
});
