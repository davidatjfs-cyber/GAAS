import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanPhone,
  cleanText,
  parseOccurredAt,
  EVENT_TYPES,
} from '../domains/growth-metrics/helpers.js';
import {
  sanitizeRedeemAmountFen,
  recomputeDailyMetrics,
  ingestMiniprogramEvent,
  resolveAlert,
  computeAbcDistributionForCampaign,
  abcDistribution,
  posConsumption,
} from '../domains/growth-metrics/service.js';

function passthroughTenantContext() {
  return {
    run: async (_tid, fn) => fn(),
  };
}

function baseCtx(overrides = {}) {
  return {
    pool: {
      async query() {
        return { rows: [] };
      },
    },
    tenantContext: passthroughTenantContext(),
    resolveTenantIdForStore: async () => 'default',
    verifyServerTenantBinding: async () => ({ ok: true }),
    upsertCustomer: async () => ({ id: 42 }),
    recomputeDiningSegments: async () => ({ updated: 0 }),
    loadRuleCandidates: async () => [],
    ABC_ROTATION_ORDER: {},
    deriveAbcStep: () => ({ step: 'A', blacklisted: false }),
    ...overrides,
  };
}

test('helpers: cleanText / cleanPhone / parseOccurredAt / EVENT_TYPES', () => {
  assert.equal(cleanText('  hello  ', 4), 'hell');
  assert.equal(cleanPhone(' 138-0013-8000 '), '13800138000');
  assert.ok(EVENT_TYPES.has('coupon_redeemed'));
  assert.equal(parseOccurredAt('not-a-date') instanceof Date, true);
  assert.equal(parseOccurredAt('2026-01-15T12:00:00Z').toISOString(), '2026-01-15T12:00:00.000Z');
});

test('sanitizeRedeemAmountFen: clears short_code*100 and absurd amounts', () => {
  const confused = sanitizeRedeemAmountFen(1234500, { short_code: '12345' });
  assert.equal(confused.cleared, true);
  assert.equal(confused.amountFen, 0);

  const huge = sanitizeRedeemAmountFen(600000, { short_code: 'AB' });
  assert.equal(huge.cleared, true);
  assert.equal(huge.amountFen, 0);

  const ok = sanitizeRedeemAmountFen(12800, { short_code: 'AB99' });
  assert.equal(ok.cleared, false);
  assert.equal(ok.amountFen, 12800);
});

test('recomputeDailyMetrics: clamps days to [1,90] (0/falsy → 7)', async () => {
  let seen;
  const pool = {
    async query(_sql, params) {
      seen = params[0];
      return { rows: [] };
    },
  };
  // Number(0) || 7 → 7（与迁移前口径一致，勿把 0 当成 1）
  assert.equal(await recomputeDailyMetrics(pool, 0), 7);
  assert.equal(seen, 7);
  assert.equal(await recomputeDailyMetrics(pool, 999), 90);
  assert.equal(seen, 90);
  assert.equal(await recomputeDailyMetrics(pool, 'nope'), 7);
});

test('ingestMiniprogramEvent: rejects invalid_event_type', async () => {
  const result = await ingestMiniprogramEvent(baseCtx(), {
    body: { event_type: 'not_real' },
    req: {},
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'invalid_event_type');
});

test('ingestMiniprogramEvent: forwards tenant binding failure', async () => {
  const ctx = baseCtx({
    verifyServerTenantBinding: async () => ({ ok: false, status: 403, error: 'tenant_mismatch' }),
  });
  const result = await ingestMiniprogramEvent(ctx, {
    body: { event_type: 'campaign_scan', store_id: 's1' },
    req: {},
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, 'tenant_mismatch');
});

test('resolveAlert: alert_not_found', async () => {
  const result = await resolveAlert(baseCtx(), 'default', 'missing-key', 'admin');
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'alert_not_found');
});

test('abcDistribution: disabled when campaign not in ABC_ROTATION_ORDER', async () => {
  const result = await abcDistribution(baseCtx(), 'default', 'unknown_campaign');
  assert.equal(result.status, 200);
  assert.equal(result.body.enabled, false);
});

test('computeAbcDistributionForCampaign: null when no rotation order', async () => {
  const result = await computeAbcDistributionForCampaign(baseCtx(), 'x', 'default');
  assert.equal(result, null);
});

test('posConsumption: empty phones returns matched 0', async () => {
  const result = await posConsumption(baseCtx(), {
    body: { phones: [] },
    headers: {},
    tenantIdFromAuth: 'default',
    req: {},
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.matched, 0);
  assert.deepEqual(result.body.data, {});
});
