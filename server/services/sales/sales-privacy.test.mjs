import test from 'node:test';
import assert from 'node:assert/strict';
import {
  maskPhone,
  canViewFullContact,
  canViewContractPrice,
  redactContractPrice,
  maskLeadContact,
  maskLeadListContact,
} from './sales-privacy.js';

test('maskPhone masks mid digits and short values', () => {
  assert.equal(maskPhone('13812345678'), '138****5678');
  assert.equal(maskPhone('123'), '***');
  assert.equal(maskPhone(''), '');
});

test('canViewFullContact allows managers and owners', () => {
  const lead = { owner_username: 'alice', assigned_to: 'bob', cs_owner_username: 'carol' };
  assert.equal(canViewFullContact({ role: 'super_admin' }, lead), true);
  assert.equal(canViewFullContact({ role: 'sales_manager' }, lead), true);
  assert.equal(canViewFullContact({ role: 'sales', username: 'alice' }, lead), true);
  assert.equal(canViewFullContact({ role: 'sales', username: 'bob' }, lead), true);
  assert.equal(canViewFullContact({ role: 'customer_service', username: 'carol' }, lead), true);
  assert.equal(canViewFullContact({ role: 'sales', username: 'other' }, lead), false);
  assert.equal(canViewFullContact({ role: 'customer_service', username: 'other' }, lead), false);
});

test('canViewContractPrice is narrower than contact access', () => {
  assert.equal(canViewContractPrice({ role: 'super_admin' }), true);
  assert.equal(canViewContractPrice({ role: 'finance' }), true);
  assert.equal(canViewContractPrice({ role: 'general_manager' }), true);
  assert.equal(canViewContractPrice({ role: 'sales_manager' }), false);
});

test('redactContractPrice strips price fields for unauthorized roles', () => {
  const lead = {
    id: 1,
    contract_price_fen: 9900,
    contract_billing_cycle: 'monthly',
    phone: '13800000000',
  };
  const redacted = redactContractPrice(lead, { role: 'sales' });
  assert.equal(redacted.contract_price_fen, undefined);
  assert.equal(redacted.contract_billing_cycle, undefined);
  assert.equal(redacted.phone, '13800000000');
  assert.equal(
    redactContractPrice(lead, { role: 'finance' }).contract_price_fen,
    9900
  );
});

test('maskLeadContact masks phones deeply for unauthorized viewers', () => {
  const lead = {
    phone: '13911112222',
    legal_contact_phone: '13933334444',
    owner_username: 'alice',
    contract_price_fen: 100,
    extracted: { phone: '13955556666', contact_phone: '13977778888', note: 'ok' },
  };
  const masked = maskLeadContact(lead, { role: 'sales', username: 'other' });
  assert.equal(masked.phone, '139****2222');
  assert.equal(masked.legal_contact_phone, '139****4444');
  assert.equal(masked.extracted.phone, '139****6666');
  assert.equal(masked.extracted.contact_phone, '139****8888');
  assert.equal(masked.extracted.note, 'ok');
  assert.equal(masked.contract_price_fen, undefined);

  const full = maskLeadContact(lead, { role: 'sales', username: 'alice' });
  assert.equal(full.phone, '13911112222');
});

test('maskLeadListContact maps over list', () => {
  const out = maskLeadListContact(
    [{ phone: '13800001111', owner_username: 'a' }],
    { role: 'sales', username: 'b' }
  );
  assert.equal(out[0].phone, '138****1111');
});
