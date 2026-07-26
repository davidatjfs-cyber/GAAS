import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_PROFILE_SLOTS,
  CUSTOMER_PROFILE_SLOT_KEYS,
  MINIMUM_DIAGNOSIS_FIELDS,
  QUALIFIED_LEAD_FIELDS,
  OPTIONAL_PROFILE_FIELDS,
  normalizeCustomerProfileSlots,
} from './sales-lead-schema.js';

test('customer profile schema constants are frozen and coherent', () => {
  assert.ok(CUSTOMER_PROFILE_SLOTS.length >= 8);
  assert.equal(CUSTOMER_PROFILE_SLOT_KEYS.length, CUSTOMER_PROFILE_SLOTS.length);
  assert.ok(MINIMUM_DIAGNOSIS_FIELDS.includes('pain_point'));
  assert.ok(QUALIFIED_LEAD_FIELDS.includes('decision_role'));
  assert.ok(OPTIONAL_PROFILE_FIELDS.includes('contact_phone'));
});

test('normalizeCustomerProfileSlots maps aliases and compatibility fields', () => {
  const out = normalizeCustomerProfileSlots({
    category: '粤菜',
    phone_data_status: true,
    member_count: 200,
    current_system: true,
    primary_pain: '复购低',
    contact: '13800001111',
  });
  assert.equal(out.cuisine, '粤菜');
  assert.equal(out.phone_data_ready, true);
  assert.equal(out.member_estimate, 200);
  assert.equal(out.other_system_used, true);
  assert.equal(out.has_member_system, true);
  assert.equal(out.pain_point, '复购低');
  assert.equal(out.contact_phone, '13800001111');
  assert.equal(out.phone, '13800001111');
});
