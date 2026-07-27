import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAbTest,
  listAbTests,
  loadAbBoundRule,
  promoteAbTest,
  refreshAbTest,
  submitAbTestResults,
} from '../ab-tests-service.js';

function futureEndDate() {
  return new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
}

test('loadAbBoundRule: returns null for missing key or missing row', async () => {
  const pool = { async query() { return { rows: [] }; } };
  assert.equal(await loadAbBoundRule(pool, 'touch_rule', ''), null);
  assert.equal(await loadAbBoundRule(pool, 'touch_rule', 'rk_missing'), null);
});

test('loadAbBoundRule: maps payment_rule and touch_rule rows to variant_a', async () => {
  const paymentPool = {
    async query() {
      return { rows: [{ rule_key: 'pr_1', name: '规则A', member_template_id: 'tpl_1', trigger_value: '10' }] };
    },
  };
  const payment = await loadAbBoundRule(paymentPool, 'payment_rule', 'pr_1');
  assert.equal(payment.kind, 'payment_rule');
  assert.equal(payment.variant_a.template_id, 'tpl_1');
  assert.equal(payment.variant_a.trigger_value, '10');

  const touchPool = {
    async query() {
      return { rows: [{ rule_key: 'rk_1', name: '规则B', action_payload: { content_template: '内容', coupon_value: 8 } }] };
    },
  };
  const touch = await loadAbBoundRule(touchPool, 'touch_rule', 'rk_1');
  assert.equal(touch.kind, 'touch_rule');
  assert.equal(touch.variant_a.content, '内容');
  assert.equal(touch.variant_a.coupon_value, 8);
});

test('createAbTest: rejects missing test_name/store_code', async () => {
  await assert.rejects(
    () => createAbTest({ async query() { return { rows: [] }; } }, 'default', {}),
    (err) => err.code === 'missing_test_name_or_store_code'
  );
});

test('createAbTest: custom template requires fields and a valid primary metric', async () => {
  const pool = { async query() { return { rows: [] }; } };
  await assert.rejects(
    () => createAbTest(pool, 'default', { test_name: 'T', store_code: 'S1', template_key: 'custom', fields: [] }),
    (err) => err.code === 'missing_custom_fields'
  );
  await assert.rejects(
    () => createAbTest(pool, 'default', {
      test_name: 'T', store_code: 'S1', template_key: 'custom',
      fields: [{ key: 'sent', label: '发送' }], primary: { num: ['unknown'] },
    }),
    (err) => err.code === 'invalid_primary_metric'
  );
});

test('createAbTest: bound template requires and validates target_rule_key', async () => {
  const emptyPool = { async query() { return { rows: [] }; } };
  await assert.rejects(
    () => createAbTest(emptyPool, 'default', { test_name: 'T', store_code: 'S1', template_key: 'sms' }),
    (err) => err.code === 'missing_target_rule_key'
  );
  await assert.rejects(
    () => createAbTest(emptyPool, 'default', { test_name: 'T', store_code: 'S1', template_key: 'sms', target_rule_key: 'rk_missing' }),
    (err) => err.code === 'bound_rule_not_found'
  );
});

test('createAbTest: bound template success path inserts a running task', async () => {
  let insertParams;
  const pool = {
    async query(sql, values) {
      if (sql.includes('FROM growth_touch_rules')) {
        return { rows: [{ rule_key: 'rk_1', name: '现有规则', action_payload: { content_template: '现有文案' } }] };
      }
      if (sql.includes('INSERT INTO ab_test_tasks')) {
        insertParams = values;
        return { rows: [{ id: 100, status: 'running' }] };
      }
      return { rows: [] };
    },
  };
  const created = await createAbTest(pool, 'default', {
    test_name: 'SMS召回测试', store_code: 'S1', template_key: 'sms', target_rule_key: 'rk_1',
  }, { username: 'tester' });
  assert.equal(created.id, 100);
  assert.equal(insertParams[0], 'SMS召回测试');
  assert.equal(insertParams[4], 'touch_rule');
});

test('createAbTest: channel template requires both variant contents', async () => {
  const pool = { async query() { return { rows: [] }; } };
  await assert.rejects(
    () => createAbTest(pool, 'default', { test_name: 'T', store_code: 'S1', template_key: 'xiaohongshu' }),
    (err) => err.code === 'missing_variants'
  );
});

test('submitAbTestResults: rejects invalid id, missing task, missing results', async () => {
  const pool = { async query() { return { rows: [] }; } };
  await assert.rejects(() => submitAbTestResults(pool, 'default', 0, {}), (err) => err.code === 'invalid_id');
  await assert.rejects(() => submitAbTestResults(pool, 'default', 5, {}), (err) => err.code === 'task_not_found');

  const taskFoundPool = {
    async query(sql) {
      if (sql.includes('FROM ab_test_tasks')) return { rows: [{ id: 5, min_sample_size: 30 }] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    () => submitAbTestResults(taskFoundPool, 'default', 5, {}),
    (err) => err.code === 'missing_results'
  );
});

test('submitAbTestResults: upserts group results then evaluates the task', async () => {
  const upsertedSql = [];
  const pool = {
    async query(sql) {
      if (sql.includes('SELECT * FROM ab_test_tasks')) {
        return { rows: [{ id: 5, min_sample_size: 30, end_date: futureEndDate(), target_rule_key: '' }] };
      }
      if (sql.includes('INSERT INTO ab_test_results')) {
        upsertedSql.push(sql);
        return { rows: [] };
      }
      if (sql.includes('FROM growth_delivery_logs')) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await submitAbTestResults(pool, 'default', 5, {
    A: { sent: 10, redemptions: 1 },
    B: { sent: 10, redemptions: 2 },
  });
  assert.equal(upsertedSql.length, 2);
  assert.equal(result.evaluated.finalized, false); // below default min_sample_size of 30
});

test('refreshAbTest: rejects invalid id and missing task', async () => {
  const pool = { async query() { return { rows: [] }; } };
  await assert.rejects(() => refreshAbTest(pool, 'default', 0), (err) => err.code === 'invalid_id');
  await assert.rejects(() => refreshAbTest(pool, 'default', 9), (err) => err.code === 'task_not_found');
});

test('refreshAbTest: manual-input tasks skip auto refresh but still evaluate', async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('SELECT * FROM ab_test_tasks')) {
        return { rows: [{ id: 6, target_rule_key: 'rk_1', min_sample_size: 30, end_date: futureEndDate() }] };
      }
      if (sql.includes('FROM ab_test_results')) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await refreshAbTest(pool, 'default', 6);
  assert.equal(result.refreshed, null);
  assert.ok(result.evaluated); // manual input still triggers evaluation
  assert.ok(!calls.some((sql) => sql.includes('FROM growth_delivery_logs')));
});

test('listAbTests: filters by store/status and attaches computed metrics', async () => {
  const pool = {
    async query(sql, values) {
      if (sql.includes('FROM ab_test_tasks')) {
        assert.deepEqual(values, ['S1', 'running', 'default']);
        return { rows: [{ id: 1, target_rule_key: '' }] };
      }
      return { rows: [] };
    },
  };
  const tasks = await listAbTests(pool, 'default', { storeCode: 'S1', status: 'running' });
  assert.equal(tasks.length, 1);
  assert.ok(tasks[0].metrics);
});

test('promoteAbTest: rejects invalid id and missing task, otherwise delegates to evaluation', async () => {
  const pool = { async query() { return { rows: [] }; } };
  await assert.rejects(() => promoteAbTest(pool, 'default', 0, 'op'), (err) => err.code === 'invalid_id');
  await assert.rejects(() => promoteAbTest(pool, 'default', 3, 'op'), (err) => err.code === 'task_not_found');

  const foundPool = { async query() { return { rows: [{ id: 3, winner: null }] }; } };
  const result = await promoteAbTest(foundPool, 'default', 3, 'op');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no_winner_yet');
});
