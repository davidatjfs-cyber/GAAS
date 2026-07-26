import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  normalizePaymentTags,
  paymentRuleToSync,
  parseOptionalNonNegInt,
  VALID_PAYMENT_TAGS,
} from '../helpers.js';
import {
  upsertPaymentRule,
  deletePaymentRule,
  syncPaymentRules,
} from '../service.js';

function baseCtx(overrides = {}) {
  return {
    pool: {
      async query() {
        return { rows: [] };
      },
    },
    tenantContext: { run: async (_t, fn) => fn() },
    ...overrides,
  };
}

test('helpers: cleanText / VALID_PAYMENT_TAGS / normalizePaymentTags', () => {
  assert.equal(cleanText('  x  ', 1), 'x');
  assert.ok(VALID_PAYMENT_TAGS.has('vip'));
  assert.deepEqual(normalizePaymentTags(['vip', 'bogus', ' new ', 'vip']), ['vip', 'new', 'vip']);
  assert.deepEqual(normalizePaymentTags('dormant'), ['dormant']);
  assert.deepEqual(normalizePaymentTags(null), []);
});

test('paymentRuleToSync: maps template + null limits', () => {
  const sync = paymentRuleToSync({
    rule_key: 'r1',
    store_id: 's1',
    name: '规则',
    priority: 2,
    member_template_id: 'T1',
    target_tags: ['vip'],
    trigger_value: null,
    daily_user_limit: null,
    global_daily_limit: '3',
  });
  assert.equal(sync.trigger_type, 'payment');
  assert.equal(sync.action_config.template_id, 'T1');
  assert.equal(sync.trigger_value, '');
  assert.equal(sync.daily_user_limit, null);
  assert.equal(sync.global_daily_limit, 3);
});

test('parseOptionalNonNegInt', () => {
  assert.equal(parseOptionalNonNegInt(null), null);
  assert.equal(parseOptionalNonNegInt(''), null);
  assert.equal(parseOptionalNonNegInt(-5), 0);
  assert.equal(parseOptionalNonNegInt('4.9'), 4);
});

test('upsertPaymentRule: missing fields', async () => {
  const ctx = baseCtx();
  assert.equal((await upsertPaymentRule(ctx, 'default', {}, {})).body.error, 'missing_store_id');
  assert.equal(
    (await upsertPaymentRule(ctx, 'default', { store_id: 's1' }, {})).body.error,
    'missing_name'
  );
  assert.equal(
    (
      await upsertPaymentRule(ctx, 'default', { store_id: 's1', name: 'n' }, {})
    ).body.error,
    'missing_member_template_id'
  );
});

test('deletePaymentRule: rule_not_found', async () => {
  const r = await deletePaymentRule(baseCtx(), 'missing');
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'rule_not_found');
});

test('syncPaymentRules: only active rules in rules[], all keys listed', async () => {
  const ctx = baseCtx({
    pool: {
      async query() {
        return {
          rows: [
            {
              rule_key: 'a',
              store_id: 's1',
              name: 'A',
              priority: 1,
              active: true,
              member_template_id: 'T',
              target_tags: ['vip'],
              trigger_value: '100',
              daily_user_limit: 1,
              global_daily_limit: null,
            },
            {
              rule_key: 'b',
              store_id: 's1',
              name: 'B',
              priority: 2,
              active: false,
              member_template_id: 'T2',
              target_tags: [],
              trigger_value: '',
              daily_user_limit: null,
              global_daily_limit: null,
            },
          ],
        };
      },
    },
  });
  const r = await syncPaymentRules(ctx, 'default');
  assert.deepEqual(r.body.all_rule_keys, ['a', 'b']);
  assert.equal(r.body.rules.length, 1);
  assert.equal(r.body.rules[0].rule_key, 'a');
  assert.equal(r.body.rules[0].action_config.template_id, 'T');
});
