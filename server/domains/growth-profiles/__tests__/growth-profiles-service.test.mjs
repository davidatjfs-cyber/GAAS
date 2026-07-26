import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  normalizeConstraintFields,
  buildStrategyContextSummary,
} from '../helpers.js';
import {
  upsertStoreProfile,
  upsertStoreConstraint,
  getStrategyContext,
  recomputeProfiles,
} from '../service.js';

function baseCtx(overrides = {}) {
  return {
    pool: {
      async query() {
        return { rows: [] };
      },
    },
    tenantContext: { run: async (_t, fn) => fn() },
    recomputeCustomerProfiles: async (_p, days) => days,
    upsertCustomer: async () => ({ id: 1 }),
    parseOccurredAt: (v) => (v ? new Date(v) : new Date()),
    resolveTenantIdForStore: async () => 'default',
    ...overrides,
  };
}

test('helpers: cleanText / normalizeConstraintFields defaults', () => {
  assert.equal(cleanText('  x  ', 1), 'x');
  const f = normalizeConstraintFields({});
  assert.equal(f.max_touch_per_72h, 1);
  assert.equal(f.cooldown_hours_after_payment, 24);
  assert.equal(f.active, true);
  assert.equal(f.max_coupon_value_fen, null);
  assert.deepEqual(f.allowed_channels, []);
});

test('normalizeConstraintFields: clamps negative fen to 0', () => {
  const f = normalizeConstraintFields({
    max_coupon_value_fen: -10,
    monthly_budget_fen: -5,
    max_touch_per_72h: -1,
  });
  assert.equal(f.max_coupon_value_fen, 0);
  assert.equal(f.monthly_budget_fen, 0);
  assert.equal(f.max_touch_per_72h, 0);
});

test('buildStrategyContextSummary', () => {
  assert.deepEqual(buildStrategyContextSummary({ profile: null, constraints: { a: 1 } }), {
    has_profile: false,
    has_constraints: true,
  });
});

test('upsertStoreProfile / upsertStoreConstraint: missing_store_id', async () => {
  const p = await upsertStoreProfile(baseCtx(), 'default', {});
  assert.equal(p.status, 400);
  assert.equal(p.body.error, 'missing_store_id');
  const c = await upsertStoreConstraint(baseCtx(), {});
  assert.equal(c.status, 400);
});

test('getStrategyContext: empty store returns null profile/constraints', async () => {
  const r = await getStrategyContext(baseCtx(), '', 'wecom', 'vip');
  assert.equal(r.status, 200);
  assert.equal(r.body.context.profile, null);
  assert.equal(r.body.summary.has_profile, false);
  assert.equal(r.body.context.channel, 'wecom');
});

test('getStrategyContext: loads profile + constraints when store set', async () => {
  const ctx = baseCtx({
    pool: {
      async query(sql) {
        if (String(sql).includes('store_marketing_profiles')) {
          return { rows: [{ store_id: 's1', brand: '洪潮' }] };
        }
        return { rows: [{ store_id: 's1', max_touch_per_72h: 2 }] };
      },
    },
  });
  const r = await getStrategyContext(ctx, 's1', '', '');
  assert.equal(r.body.summary.has_profile, true);
  assert.equal(r.body.summary.has_constraints, true);
  assert.equal(r.body.context.profile.brand, '洪潮');
});

test('recomputeProfiles: forwards days', async () => {
  const r = await recomputeProfiles(baseCtx(), 'default', { days: 30 });
  assert.equal(r.body.days, 30);
});
