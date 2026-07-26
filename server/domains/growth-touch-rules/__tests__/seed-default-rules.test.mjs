import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TOUCH_RULES,
  REMOVED_TOUCH_RULE_KEYS,
} from '../default-rules.js';
import { seedDefaultTouchRules } from '../seed-default-rules.js';

test('DEFAULT_TOUCH_RULES has unique rule_keys and required fields', () => {
  assert.ok(DEFAULT_TOUCH_RULES.length >= 10);
  const keys = new Set();
  for (const rule of DEFAULT_TOUCH_RULES) {
    assert.ok(rule.rule_key);
    assert.ok(rule.name);
    assert.ok(rule.action_type);
    assert.equal(keys.has(rule.rule_key), false);
    keys.add(rule.rule_key);
  }
  assert.ok(REMOVED_TOUCH_RULE_KEYS.includes('churn_21_return_coupon'));
});

test('seedDefaultTouchRules inserts each rule then deletes retired keys', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [] };
    },
  };
  const rules = [
    {
      rule_key: 'r1',
      name: '规则1',
      priority: 1,
      auto_execute: true,
      criteria: { a: 1 },
      action_type: 'send_message',
      action_payload: { channel: 'sms' },
    },
    {
      rule_key: 'r2',
      name: '规则2',
      priority: 2,
      // auto_execute omitted → true
      criteria: null,
      action_type: 'send_voucher',
      action_payload: null,
    },
  ];

  await seedDefaultTouchRules(pool, rules, ['old_rule']);

  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /INSERT INTO growth_touch_rules/);
  assert.equal(calls[0].params[0], 'r1');
  assert.equal(calls[0].params[3], true);
  assert.equal(calls[0].params[4], JSON.stringify({ a: 1 }));
  assert.equal(calls[1].params[0], 'r2');
  assert.equal(calls[1].params[3], true);
  assert.equal(calls[1].params[4], JSON.stringify({}));
  assert.equal(calls[1].params[6], JSON.stringify({}));
  assert.match(calls[2].sql, /DELETE FROM growth_touch_rules/);
  assert.deepEqual(calls[2].params[0], ['old_rule']);
});

test('seedDefaultTouchRules respects auto_execute false', async () => {
  const paramsList = [];
  const pool = {
    query: async (_sql, params) => {
      paramsList.push(params);
      return { rows: [] };
    },
  };
  await seedDefaultTouchRules(
    pool,
    [{
      rule_key: 'manual',
      name: '手动',
      priority: 9,
      auto_execute: false,
      criteria: {},
      action_type: 'send_voucher',
      action_payload: {},
    }],
    [],
  );
  assert.equal(paramsList[0][3], false);
});
