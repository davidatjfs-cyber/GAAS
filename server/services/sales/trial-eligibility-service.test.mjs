import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrialEligibility } from './trial-eligibility-service.js';

function makePool(rules) {
  return {
    query: async () => ({ rows: rules }),
  };
}

test('evaluateTrialEligibility returns unfit on blocking failure', async () => {
  const pool = makePool([
    { rule_key: 'has_phone', label: '有手机号数据', condition: { field: 'phone_data_ready', op: 'eq', value: true }, weight: 40, is_blocking: true },
    { rule_key: 'stores', label: '门店≥2', condition: { field: 'store_count', op: 'gte', value: 2 }, weight: 60, is_blocking: false },
  ]);
  const r = await evaluateTrialEligibility(pool, { phone_data_ready: false, store_count: 5 });
  assert.equal(r.verdict, 'unfit');
  assert.deepEqual(r.blocking_reasons, ['有手机号数据']);
  assert.equal(r.score, 60);
  assert.equal(r.detail.length, 2);
});

test('evaluateTrialEligibility marks conditional below threshold', async () => {
  const pool = makePool([
    { rule_key: 'stores', label: '门店≥3', condition: { field: 'store_count', op: 'gte', value: 3 }, weight: 50, is_blocking: false },
    { rule_key: 'pos', label: 'POS品牌非空', condition: { field: 'pos_brand', op: 'not_empty' }, weight: 50, is_blocking: false },
  ]);
  const r = await evaluateTrialEligibility(pool, { store_count: 1, pos_brand: '' });
  assert.equal(r.verdict, 'conditional');
  assert.equal(r.score, 0);
});

test('evaluateTrialEligibility returns eligible when score passes', async () => {
  const pool = makePool([
    { rule_key: 'stores', label: '门店≥2', condition: { field: 'store_count', op: 'gte', value: 2 }, weight: 40, is_blocking: false },
    { rule_key: 'role', label: '决策人', condition: { field: 'decision_role', op: 'eq', value: '老板' }, weight: 30, is_blocking: false },
    { rule_key: 'name', label: '店名非空', condition: { field: 'name', op: 'not_empty' }, weight: 30, is_blocking: false },
    { rule_key: 'bad_op', label: '未知算子', condition: { field: 'x', op: 'weird' }, weight: 0, is_blocking: false },
  ]);
  const r = await evaluateTrialEligibility(pool, {
    store_count: 3,
    decision_role: '老板',
    name: '洪潮',
  });
  assert.equal(r.verdict, 'eligible');
  assert.equal(r.score, 100);
  assert.equal(r.blocking_reasons.length, 0);
});
