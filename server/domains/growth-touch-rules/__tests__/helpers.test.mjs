/**
 * domains/growth-touch-rules/helpers.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtYmd,
  fmtYm,
  deriveBirthdayMonth,
  buildRuleActionKey,
  buildRulePeriodKey,
  resolveRuleStoreId,
  filterGenericRuleCandidates,
  filterLoyalBirthdayMonthCandidates,
} from '../helpers.js';
import { phoneAbBucket } from '../../growth-campaigns/helpers.js';

test('deriveBirthdayMonth：birthday_month / birthday 字符串', () => {
  assert.equal(deriveBirthdayMonth({ birthday_month: '3' }), '03');
  assert.equal(deriveBirthdayMonth({ birthday: '1990-05-12' }), '05');
  assert.equal(deriveBirthdayMonth({}), '');
});

test('buildRuleActionKey / buildRulePeriodKey', () => {
  assert.equal(buildRuleActionKey('vip_gift', 42, '2026-07-01'), 'rule:vip_gift:42:2026-07-01');
  assert.match(buildRulePeriodKey('loyal_birthday_month', {}), /^\d{4}-\d{2}$/);
  assert.equal(
    buildRulePeriodKey('vip_gift', { last_visit_at: '2026-07-20T00:00:00.000Z' }),
    fmtYmd('2026-07-20T00:00:00.000Z')
  );
});

test('resolveRuleStoreId：criteria 优先于 action_payload', () => {
  assert.equal(resolveRuleStoreId({ criteria: { store_id: 'a' }, action_payload: { store_id: 'b' } }), 'a');
  assert.equal(resolveRuleStoreId({ action_payload: { store_id: 'b' } }), 'b');
});

test('filterGenericRuleCandidates：生命周期 + 门店 + ab_bucket', () => {
  const rows = [
    {
      customer_id: 1,
      store_id: 'store_a',
      phone: '13800138000',
      lifecycle_stage: 'active',
      value_tier: 'vip',
      pos_order_count: 3,
      days_since_last_visit: 10,
      visit_interval_days: 7,
    },
    {
      customer_id: 2,
      store_id: 'store_b',
      phone: '13900139000',
      lifecycle_stage: 'active',
      value_tier: 'vip',
      pos_order_count: 3,
      days_since_last_visit: 10,
      visit_interval_days: 7,
    },
  ];
  const rule = {
    rule_key: 'vip_gift',
    criteria: { lifecycle_stage: 'active', value_tier: 'vip', store_id: 'store_a' },
  };
  const matched = filterGenericRuleCandidates(rows, rule, null);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].customer_id, 1);

  const abRule = {
    rule_key: 'mj_dinner_weekend_gift',
    criteria: { lifecycle_stage: 'active', ab_bucket: phoneAbBucket('13800138000', 2) },
  };
  const abMatched = filterGenericRuleCandidates(rows, abRule, null);
  assert.ok(abMatched.some((r) => r.phone === '13800138000'));
});

test('filterGenericRuleCandidates：无人群维度不命中', () => {
  const rows = [{ lifecycle_stage: 'active', pos_order_count: 1, days_since_last_visit: 5 }];
  assert.equal(filterGenericRuleCandidates(rows, { rule_key: 'x', criteria: {} }, null).length, 0);
});

test('filterLoyalBirthdayMonthCandidates：当月生日 + 访问频次', () => {
  const month = fmtYm(new Date()).slice(5, 7);
  const ok = filterLoyalBirthdayMonthCandidates([
    {
      pos_order_count: 4,
      visit_interval_days: 8,
      customer_meta: { birthday_month: String(Number(month)) },
    },
    {
      pos_order_count: 1,
      visit_interval_days: 8,
      customer_meta: { birthday_month: String(Number(month)) },
    },
  ]);
  assert.equal(ok.length, 1);
});
