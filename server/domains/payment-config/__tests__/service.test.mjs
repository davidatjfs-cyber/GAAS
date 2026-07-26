import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePaymentSettings,
  normalizePaymentBudgets,
  loadPaymentConfigFromState,
} from '../service.js';

test('normalizePaymentSettings：默认紧急度 + 去重；有 secondary 时不回退 primary', () => {
  const out = normalizePaymentSettings({
    categories: [' 食材 ', '食材', '包装'],
    payees: ['甲', '甲'],
    payeeDetails: [
      { name: '甲', account: '1', bank: '工行' },
      { name: '甲', account: '2', bank: '建行' },
      { name: '', account: 'x' },
      null,
    ],
    secondaryCategories: [
      { name: '鲜货', primary: '食材' },
      { name: '鲜货', primary: '重复' },
      { name: '', primary: 'x' },
    ],
  });
  assert.deepEqual(out.categories, ['食材', '包装']);
  // secondary 非空 → 不把 categories 回填到 primaryCategories
  assert.deepEqual(out.primaryCategories, []);
  assert.deepEqual(out.payees, ['甲']);
  assert.equal(out.payeeDetails.length, 1);
  assert.equal(out.payeeDetails[0].bank, '工行');
  assert.deepEqual(out.urgencies, ['低', '中', '高']);
  assert.equal(out.secondaryCategories.length, 1);
});

test('normalizePaymentSettings：仅 categories 时回填 primaryCategories', () => {
  const out = normalizePaymentSettings({ categories: ['A', 'A', 'B'] });
  assert.deepEqual(out.primaryCategories, ['A', 'B']);
});

test('normalizePaymentSettings：显式 primaryCategories 优先于 categories 回退', () => {
  const out = normalizePaymentSettings({
    categories: ['旧类'],
    primaryCategories: ['新类'],
    urgencies: ['紧急'],
  });
  assert.deepEqual(out.primaryCategories, ['新类']);
  assert.deepEqual(out.urgencies, ['紧急']);
});

test('normalizePaymentBudgets：过滤非法金额/缺字段/去重', () => {
  const out = normalizePaymentBudgets([
    { store: '洪潮', month: '2026-07', category: '食材', amount: 100 },
    { store: '洪潮', month: '2026-07', category: '食材', amount: 200 }, // dup
    { store: '洪潮', month: '2026-07', category: '包装', amount: -1 },
    { store: '', month: '2026-07', category: '食材', amount: 1 },
    { store: '甲', month: '2026-07', category: '食材', amount: 'x' },
    null,
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, 100);
});

test('loadPaymentConfigFromState：空/非对象 state', () => {
  const a = loadPaymentConfigFromState(null);
  assert.ok(Array.isArray(a.paymentSettings.urgencies));
  assert.deepEqual(a.paymentBudgets, []);
  const b = loadPaymentConfigFromState({
    paymentSettings: { payees: ['P'] },
    paymentBudgets: [{ store: 'S', month: '2026-01', category: 'C', amount: 3 }],
  });
  assert.deepEqual(b.paymentSettings.payees, ['P']);
  assert.equal(b.paymentBudgets[0].amount, 3);
});
