import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPhone, cleanText } from '../helpers.js';
import {
  sendWinbackSms,
  upsertTouchRule,
  approveTouchRule,
  previewWinback,
  listJobs,
} from '../service.js';

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
    sendAliyunSms: async () => ({ provider_msg_id: 'noop', raw: {} }),
    tenantContext: passthroughTenantContext(),
    resolveTenantIdForStore: async () => 'default',
    pickWinbackTemplateByStore: () => 'SMS_TEST_TEMPLATE',
    freqDaysEnv: (_key, fallback) => fallback,
    globalSmsCapped: async () => null,
    isPhoneSuppressed: async () => false,
    upsertCustomer: async () => ({ id: 1 }),
    upsertDeliveryLog: async () => {},
    insertGrowthEvent: async () => {},
    handleSmsFailure: async () => {},
    inSmsQuietHours: () => false,
    CAMPAIGN_TYPES: {},
    getTouchRulesAudience: async () => ({ rules: [] }),
    ...overrides,
  };
}

const validSmsBody = {
  phone: '13800138000',
  store_id: 'store-a',
  coupon_code: 'ABC123',
  value_yuan: 20,
  valid_until: '2026-08-01',
};

test('cleanPhone / cleanText helpers', () => {
  assert.equal(cleanText('  hello  ', 4), 'hell');
  assert.equal(cleanText(null), '');
  assert.equal(cleanPhone(' 138-0013-8000 '), '13800138000');
  assert.equal(cleanPhone('+86 138abc'), '+86138');
});

test('sendWinbackSms: missing_phone / missing_coupon_code', async () => {
  const ctx = baseCtx();
  const noPhone = await sendWinbackSms(ctx, { ...validSmsBody, phone: '' });
  assert.equal(noPhone.status, 400);
  assert.equal(noPhone.body.error, 'missing_phone');

  const noCode = await sendWinbackSms(ctx, { ...validSmsBody, coupon_code: '', code: '' });
  assert.equal(noCode.status, 400);
  assert.equal(noCode.body.error, 'missing_coupon_code');
});

test('sendWinbackSms: deduped when delivery_key already sent', async () => {
  let smsCalls = 0;
  const ctx = baseCtx({
    sendAliyunSms: async () => {
      smsCalls += 1;
      return { provider_msg_id: 'x', raw: {} };
    },
    pool: {
      async query(sql) {
        if (String(sql).includes('delivery_key')) {
          return { rows: [{ status: 'sent' }] };
        }
        return { rows: [] };
      },
    },
  });
  const result = await sendWinbackSms(ctx, validSmsBody);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.deduped, true);
  assert.equal(smsCalls, 0);
});

test('sendWinbackSms: frequency_capped when recent sent', async () => {
  let smsCalls = 0;
  let queryN = 0;
  const ctx = baseCtx({
    sendAliyunSms: async () => {
      smsCalls += 1;
      return { provider_msg_id: 'x', raw: {} };
    },
    freqDaysEnv: () => 30,
    pool: {
      async query(sql) {
        queryN += 1;
        if (String(sql).includes('delivery_key')) return { rows: [] };
        if (String(sql).includes('frequency') || String(sql).includes('winback_sms')) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      },
    },
  });
  const result = await sendWinbackSms(ctx, validSmsBody);
  assert.equal(result.status, 200);
  assert.equal(result.body.skipped, true);
  assert.equal(result.body.reason, 'frequency_capped');
  assert.equal(result.body.frequency_days, 30);
  assert.equal(smsCalls, 0);
  assert.ok(queryN >= 2);
});

test('upsertTouchRule / approveTouchRule: missing_rule_key / rule_not_found', async () => {
  const ctx = baseCtx();
  const missing = await upsertTouchRule(ctx, { name: 'x' }, 'default');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, 'missing_rule_key');

  const notFound = await approveTouchRule(ctx, {
    ruleKey: 'no-such-rule',
    operatorUsername: 'admin',
    tenantId: 'default',
  });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error, 'rule_not_found');
});

test('previewWinback / listJobs: empty structure', async () => {
  const ctx = baseCtx({
    pool: {
      async query() {
        return { rows: [] };
      },
    },
  });
  const preview = await previewWinback(ctx, { tenantId: 'default' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.ok, true);
  assert.equal(preview.body.dry_run, true);
  assert.equal(preview.body.match_count, 0);
  assert.equal(preview.body.sendable_count, 0);
  assert.equal(preview.body.capped_count, 0);
  assert.deepEqual(preview.body.sample, []);

  const jobs = await listJobs(ctx, { tenantId: 'default' });
  assert.equal(jobs.status, 200);
  assert.equal(jobs.body.ok, true);
  assert.deepEqual(jobs.body.jobs, []);
});
