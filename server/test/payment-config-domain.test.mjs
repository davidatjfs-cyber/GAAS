import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePaymentBudgets,
  normalizePaymentSettings,
  loadPaymentConfigFromState,
} from '../domains/payment-config/service.js';
import { STATE_PUT_WHITELIST, STATE_PUT_SERVER_OWNED, applyStatePutWhitelist } from '../hrms-state-put.js';

test('normalizePaymentSettings 去重并补默认紧急度', () => {
  const s = normalizePaymentSettings({
    primaryCategories: ['食材', '食材', ' 房租 '],
    secondaryCategories: [{ name: '蔬菜', primary: '食材' }, { name: '蔬菜', primary: '食材' }],
    urgencies: [],
  });
  assert.deepEqual(s.primaryCategories, ['食材', '房租']);
  assert.equal(s.secondaryCategories.length, 1);
  assert.deepEqual(s.urgencies, ['低', '中', '高']);
});

test('normalizePaymentBudgets 校验金额与去重', () => {
  const b = normalizePaymentBudgets([
    { store: '洪潮', month: '2026-07', category: '食材', amount: 100 },
    { store: '洪潮', month: '2026-07', category: '食材', amount: 200 },
    { store: '洪潮', month: '2026-07', category: '房租', amount: -1 },
  ]);
  assert.equal(b.length, 1);
  assert.equal(b[0].amount, 100);
});

test('paymentSettings/Budgets 不在白名单且 PUT 不能覆盖', () => {
  assert.equal(STATE_PUT_WHITELIST.includes('paymentSettings'), false);
  assert.equal(STATE_PUT_WHITELIST.includes('paymentBudgets'), false);
  assert.ok(STATE_PUT_SERVER_OWNED.includes('paymentSettings'));
  assert.ok(STATE_PUT_SERVER_OWNED.includes('paymentBudgets'));
  const existing = {
    paymentSettings: { primaryCategories: ['旧'] },
    paymentBudgets: [{ store: '洪潮', month: '2026-07', category: '食材', amount: 1 }],
  };
  const { next, ignoredKeys } = applyStatePutWhitelist(existing, {
    paymentSettings: { primaryCategories: ['黑'] },
    paymentBudgets: [{ store: 'hack', month: '2026-07', category: 'x', amount: 9 }],
  });
  assert.deepEqual(next.paymentSettings.primaryCategories, ['旧']);
  assert.equal(next.paymentBudgets[0].store, '洪潮');
  assert.ok(ignoredKeys.includes('paymentSettings'));
  assert.ok(ignoredKeys.includes('paymentBudgets'));
});

test('loadPaymentConfigFromState', () => {
  const cfg = loadPaymentConfigFromState({ paymentSettings: { payees: ['A'] }, paymentBudgets: [] });
  assert.deepEqual(cfg.paymentSettings.payees, ['A']);
});

test('normalizePaymentSettings：legacy categories + payeeDetails', () => {
  const s = normalizePaymentSettings({
    categories: ['食材', '水电'],
    payeeDetails: [
      { name: '供应商甲', account: '6222', bank: '工行' },
      { name: '供应商甲', account: '999' },
      { name: '  ' },
      null,
    ],
  });
  assert.deepEqual(s.primaryCategories, ['食材', '水电']);
  assert.equal(s.payeeDetails.length, 1);
  assert.equal(s.payeeDetails[0].account, '6222');
});

test('normalizePaymentBudgets / loadPaymentConfigFromState：非数组与空 state', () => {
  assert.deepEqual(normalizePaymentBudgets(null), []);
  const cfg = loadPaymentConfigFromState(null);
  assert.ok(Array.isArray(cfg.paymentSettings.primaryCategories));
  assert.deepEqual(cfg.paymentBudgets, []);
});

test('promotionTracks / roles 不在白名单且 PUT 不能覆盖', () => {
  assert.equal(STATE_PUT_WHITELIST.includes('promotionTracks'), false);
  assert.equal(STATE_PUT_WHITELIST.includes('roles'), false);
  assert.ok(STATE_PUT_SERVER_OWNED.includes('promotionTracks'));
  assert.ok(STATE_PUT_SERVER_OWNED.includes('roles'));
  const existing = {
    promotionTracks: [{ id: 't1', applicantUsername: 'alice' }],
    roles: [{ id: 'admin', name: '管理员' }],
  };
  const { next, ignoredKeys } = applyStatePutWhitelist(existing, {
    promotionTracks: [{ id: 'hack' }],
    roles: [{ id: 'hack', name: '黑' }],
  });
  assert.equal(next.promotionTracks[0].id, 't1');
  assert.equal(next.roles[0].id, 'admin');
  assert.ok(ignoredKeys.includes('promotionTracks'));
  assert.ok(ignoredKeys.includes('roles'));
});
