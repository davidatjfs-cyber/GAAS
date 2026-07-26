import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLeadCompleteness,
  STAGES_REQUIRING_COMPLETE_INFO,
} from './sales-lead-completeness.js';

test('checkLeadCompleteness reports all missing required fields', () => {
  const r = checkLeadCompleteness({});
  assert.equal(r.complete, false);
  assert.ok(r.missing.includes('门店数量'));
  assert.ok(r.missing.includes('POS品牌'));
  assert.ok(r.missing.includes('手机号数据情况'));
  assert.ok(r.missing.includes('对接人决策角色'));
});

test('checkLeadCompleteness requires phone_data_ready === true', () => {
  const base = {
    store_count: 2,
    pos_brand: '客如云',
    decision_role: '老板',
    phone_data_ready: false,
  };
  assert.equal(checkLeadCompleteness(base).complete, false);
  assert.deepEqual(checkLeadCompleteness(base).missing, ['手机号数据情况']);
  assert.equal(checkLeadCompleteness({ ...base, phone_data_ready: true }).complete, true);
});

test('STAGES_REQUIRING_COMPLETE_INFO gates mid/late funnel stages', () => {
  assert.ok(STAGES_REQUIRING_COMPLETE_INFO.has('qualified'));
  assert.ok(STAGES_REQUIRING_COMPLETE_INFO.has('trial'));
  assert.ok(STAGES_REQUIRING_COMPLETE_INFO.has('won'));
  assert.equal(STAGES_REQUIRING_COMPLETE_INFO.has('need_identified'), false);
});
