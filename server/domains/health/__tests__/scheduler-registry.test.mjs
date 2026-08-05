import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEDULER_REGISTRY,
  buildThresholdMap,
  evaluateSchedulerHealth,
} from '../scheduler-registry.js';

const MIN = 60000;
const entry = (over = {}) => ({
  name: 'demo_task',
  schedule: '每 10 分钟',
  expectedMaxMinutes: 30,
  owner: 'gaas',
  ...over,
});

test('注册表是阈值的唯一事实来源：cache_purge 与真实 2 小时周期一致', () => {
  const map = buildThresholdMap();
  // 事故点：/api/health 曾按 30 分钟判定实际每 2 小时跑一次的 cache_purge，长期误报。
  assert.equal(map.cache_purge, 390);
  assert.ok(map.cache_purge > 120, 'cache_purge 阈值必须大于其真实周期 120 分钟');
});

test('注册表条目字段完整且 task_name 不重复', () => {
  const names = new Set();
  for (const e of SCHEDULER_REGISTRY) {
    assert.ok(e.name, 'name 必填');
    assert.ok(e.schedule, `${e.name} 缺 schedule`);
    assert.ok(Number.isFinite(e.expectedMaxMinutes) && e.expectedMaxMinutes > 0, `${e.name} 阈值非法`);
    assert.ok(!names.has(e.name), `${e.name} 重复登记`);
    names.add(e.name);
  }
});

test('ok：心跳在预期窗口内', () => {
  const r = evaluateSchedulerHealth({
    registry: [entry()],
    rows: [{ task_name: 'demo_task', last_beat: new Date(Date.now() - 5 * MIN), last_success_at: new Date(Date.now() - 5 * MIN) }],
  });
  assert.equal(r.tasks[0].status, 'ok');
  assert.equal(r.ok, true);
});

test('overdue：有心跳但超过预期最大间隔', () => {
  const r = evaluateSchedulerHealth({
    registry: [entry()],
    rows: [{ task_name: 'demo_task', last_beat: new Date(Date.now() - 90 * MIN) }],
  });
  assert.equal(r.tasks[0].status, 'overdue');
  assert.equal(r.unhealthy.length, 1);
});

test('never：注册了但心跳表一行都没有（这是旧实现完全漏报的场景）', () => {
  const r = evaluateSchedulerHealth({
    registry: [entry()],
    rows: [],
    uptimeMs: 10 * 60 * MIN,
  });
  assert.equal(r.tasks[0].status, 'never');
  assert.equal(r.ok, false);
});

test('never 有进程运行时长宽限：刚重启不误报月度任务', () => {
  const r = evaluateSchedulerHealth({
    registry: [entry({ expectedMaxMinutes: 45 * 24 * 60 })],
    rows: [],
    uptimeMs: 2 * 60 * MIN,
  });
  assert.equal(r.tasks[0].status, 'ok');
});

test('failing：心跳新鲜但最近一次执行失败', () => {
  const r = evaluateSchedulerHealth({
    registry: [entry()],
    rows: [{
      task_name: 'demo_task',
      last_beat: new Date(Date.now() - 2 * MIN),
      status: 'error',
      last_error: 'boom',
      last_success_at: new Date(Date.now() - 2 * MIN),
    }],
  });
  assert.equal(r.tasks[0].status, 'failing');
  assert.equal(r.tasks[0].last_error, 'boom');
});

test('failing：准时在跑，但距上次成功已超过一个完整周期', () => {
  const r = evaluateSchedulerHealth({
    registry: [entry()],
    rows: [{
      task_name: 'demo_task',
      last_beat: new Date(Date.now() - 2 * MIN),
      status: 'ok',
      last_success_at: new Date(Date.now() - 500 * MIN),
    }],
  });
  assert.equal(r.tasks[0].status, 'failing');
});

test('delegated：委托给 agents-service-v2 时不判定、不计入 checked', () => {
  const registry = [entry({ delegatedWhen: () => true })];
  const r = evaluateSchedulerHealth({ registry, rows: [], uptimeMs: 10 * 60 * MIN });
  assert.equal(r.tasks[0].status, 'delegated');
  assert.equal(r.ok, true);
  assert.equal(r.checked, 0);
});

test('master-agent tick 在 DISABLE_AGENT_SCHEDULING=true 时标记为 delegated', () => {
  const r = evaluateSchedulerHealth({
    rows: [],
    uptimeMs: 30 * 24 * 60 * MIN,
    env: { DISABLE_AGENT_SCHEDULING: 'true' },
  });
  const kg = r.tasks.find((t) => t.task_name === 'master_kg_health_tick');
  assert.ok(kg, 'master_kg_health_tick 应在注册表中');
  assert.equal(kg.status, 'delegated');
});

test('master-agent tick 在本服务自己执行时，缺心跳会被报出来', () => {
  const r = evaluateSchedulerHealth({
    rows: [],
    uptimeMs: 30 * 24 * 60 * MIN,
    env: { DISABLE_AGENT_SCHEDULING: 'false' },
  });
  const kg = r.tasks.find((t) => t.task_name === 'master_kg_health_tick');
  assert.equal(kg.status, 'never');
});

test('心跳表里的一次性去重标记不会被当成定时任务', () => {
  const r = evaluateSchedulerHealth({
    registry: [entry()],
    rows: [
      { task_name: 'demo_task', last_beat: new Date() },
      { task_name: 'heartbeat_alert_foo:3', last_beat: new Date(Date.now() - 9999 * MIN) },
      { task_name: 'freshness_alert_default', last_beat: new Date(Date.now() - 9999 * MIN) },
    ],
  });
  assert.equal(r.tasks.length, 1);
  assert.equal(r.ok, true);
});
