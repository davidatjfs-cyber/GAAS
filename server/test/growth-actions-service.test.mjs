import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  deriveReach,
  scoreActionFeedback,
  PLATFORM_CHANNELS,
} from '../domains/growth-actions/helpers.js';
import {
  executeAction,
  ignoreAction,
  listActions,
  submitActionFeedback,
} from '../domains/growth-actions/service.js';

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
    resolveTenantIdDefault: () => 'default',
    runTouchRuleEngine: async () => ({ ran: true }),
    executeGrowthActionRecord: async () => ({ action: { action_key: 'k' }, execution: {} }),
    appendExecutionLog: async () => {},
    ...overrides,
  };
}

test('helpers: cleanText / PLATFORM_CHANNELS', () => {
  assert.equal(cleanText('  ab  ', 2), 'ab');
  assert.ok(PLATFORM_CHANNELS.includes('wecom'));
});

test('deriveReach: ignored / reached / failed / skipped / internal_only', () => {
  assert.equal(deriveReach({ decision: 'ignored', delivery_total: 5 }), 'ignored');
  assert.equal(deriveReach({ decision: 'executed', delivery_total: 0 }), 'internal_only');
  assert.equal(
    deriveReach({ decision: 'executed', delivery_total: 2, delivery_delivered: 1 }),
    'reached'
  );
  assert.equal(
    deriveReach({
      decision: 'executed',
      delivery_total: 2,
      delivery_delivered: 0,
      delivery_failed: 2,
    }),
    'failed'
  );
  assert.equal(
    deriveReach({
      decision: 'executed',
      delivery_total: 2,
      delivery_delivered: 0,
      delivery_failed: 0,
      delivery_skipped: 2,
    }),
    'skipped'
  );
});

test('scoreActionFeedback: null without actuals; 有效 when meeting targets', () => {
  assert.equal(scoreActionFeedback({}, { reach: 100 }), null);

  const score = scoreActionFeedback(
    { actual_reach: 100, actual_redemptions: 20, actual_revenue_fen: 100000 },
    { reach: 100, redemption_rate: 20, revenue_fen: 100000 }
  );
  assert.equal(score.effectiveness, '有效');
  assert.equal(score.effectiveness_score, 80);
  assert.equal(score.actual_redemption_rate, 20);
});

test('scoreActionFeedback: 无效 when far below targets', () => {
  const score = scoreActionFeedback(
    { actual_reach: 10, actual_redemptions: 0, actual_revenue_fen: 0 },
    { reach: 100, redemption_rate: 20, revenue_fen: 100000 }
  );
  assert.equal(score.effectiveness, '无效');
  assert.ok(score.effectiveness_score < 40);
});

test('executeAction / ignoreAction: action_not_found', async () => {
  const ctx = baseCtx();
  const exec = await executeAction(ctx, 'default', 'missing', { username: 'u', role: 'admin' }, {});
  assert.equal(exec.status, 404);
  assert.equal(exec.body.error, 'action_not_found');

  const ign = await ignoreAction(ctx, 'default', 'missing', { username: 'u', role: 'admin' }, {});
  assert.equal(ign.status, 404);
});

test('listActions: clamps limit and returns empty slice', async () => {
  const ctx = baseCtx({
    pool: {
      async query() {
        return { rows: [] };
      },
    },
  });
  const result = await listActions(ctx, 'default', { limit: 9999, offset: 0 });
  assert.equal(result.status, 200);
  assert.equal(result.body.limit, 500);
  assert.deepEqual(result.body.actions, []);
});

test('submitActionFeedback: action_not_found', async () => {
  const result = await submitActionFeedback(
    baseCtx(),
    'default',
    'missing',
    { username: 'u', role: 'admin' },
    { note: 'x' }
  );
  assert.equal(result.status, 404);
  assert.equal(result.body.error, 'action_not_found');
});
