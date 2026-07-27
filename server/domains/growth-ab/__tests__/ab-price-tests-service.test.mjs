import test from 'node:test';
import assert from 'node:assert/strict';
import { createPriceTest, listPriceTests } from '../ab-price-tests-service.js';

test('listPriceTests: filters by store/status and attaches computed metrics', async () => {
  const pool = {
    async query(sql, values) {
      if (sql.includes('FROM ab_test_tasks')) {
        assert.match(sql, /test_type IN \('price_test', 'price_bundle'\)/);
        assert.deepEqual(values, ['S1', 'running', 'default']);
        return { rows: [{ id: 1, target_rule_key: '' }] };
      }
      return { rows: [] };
    },
  };
  const tasks = await listPriceTests(pool, 'default', { storeCode: 'S1', status: 'running' });
  assert.equal(tasks.length, 1);
  assert.ok(tasks[0].metrics);
});

test('createPriceTest: rejects missing required fields', async () => {
  await assert.rejects(
    () => createPriceTest({ async query() { return { rows: [] }; } }, 'default', {}),
    (err) => err.code === 'missing_fields' && err.status === 400
  );
});

test('createPriceTest: inserts a running price test with sane defaults', async () => {
  let params;
  const pool = {
    async query(sql, values) {
      params = values;
      assert.match(sql, /INSERT INTO ab_test_tasks/);
      return { rows: [{ id: 55 }] };
    },
  };
  const created = await createPriceTest(pool, 'default', {
    test_name: '定价测试', store_code: 'S1',
  }, { username: 'tester' });
  assert.deepEqual(created, { id: 55 });
  assert.equal(params[0], '定价测试');
  assert.equal(params[2], 'price_test');
  assert.equal(params[3], 'revenue_per_order');
  assert.equal(params[9], 50); // default min_sample_size
  assert.equal(params[10], 'tester');
});
