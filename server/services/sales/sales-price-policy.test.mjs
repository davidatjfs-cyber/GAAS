import test from 'node:test';
import assert from 'node:assert/strict';
import { canDiscussPricing, checkPricePermission } from './sales-price-policy.js';

test('canDiscussPricing grants full / principle / none by role', () => {
  assert.deepEqual(canDiscussPricing({ role: 'sales_manager' }), { allowed: true, level: 'full' });
  assert.deepEqual(canDiscussPricing({ sales_role: 'sales_director' }), { allowed: true, level: 'full' });
  assert.deepEqual(canDiscussPricing({ role: 'sales' }), { allowed: true, level: 'principle_only' });
  assert.equal(canDiscussPricing({ role: 'viewer' }).allowed, false);
  assert.match(canDiscussPricing({ role: 'viewer' }).reason, /无报价权限/);
});

test('checkPricePermission blocks unauthorized discount and exact price', () => {
  const blocked = checkPricePermission({ role: 'viewer' }, '能不能便宜点，年费 3 万');
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.risks.length >= 1);

  const principle = checkPricePermission({ role: 'sales' }, '可以给折扣吗');
  assert.ok(principle.risks.some((r) => /价格原则/.test(r)));
  assert.equal(principle.blocked, false);

  const exact = checkPricePermission({ role: 'sales' }, '报价 2 万');
  assert.ok(exact.risks.some((r) => /负责人确认/.test(r)));

  const ok = checkPricePermission({ role: 'sales_manager' }, '年费 5 万可以折扣');
  assert.equal(ok.blocked, false);
  assert.equal(ok.risks.length, 0);
});
