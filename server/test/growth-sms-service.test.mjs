import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  normalizeSmsContent,
  buildSilentFailureMessage,
  STALE_HOURS,
} from '../domains/growth-sms/helpers.js';
import { checkSmsSilentFailure } from '../domains/growth-sms/health.js';
import { runSmsTemplateReconcile } from '../domains/growth-sms/reconcile.js';

test('helpers: cleanText / normalizeSmsContent', () => {
  assert.equal(cleanText('  x  ', 1), 'x');
  assert.equal(normalizeSmsContent('你好  世界\n'), '你好世界');
});

test('buildSilentFailureMessage includes pending + last sent', () => {
  const msg = buildSilentFailureMessage(3, new Date('2026-07-01T00:00:00Z'), 5);
  assert.ok(msg.includes('3 条'));
  assert.ok(msg.includes('2026-07-01'));
  assert.ok(msg.includes('5.0'));
});

test('checkSmsSilentFailure: quiet_hours / sms_disabled / no pending', async () => {
  const pool = {
    async query() {
      return { rows: [{ n: 0 }] };
    },
  };
  assert.equal(
    (await checkSmsSilentFailure(pool, { inSmsQuietHours: () => true })).skipped,
    'quiet_hours'
  );
  assert.equal(
    (
      await checkSmsSilentFailure(pool, {
        inSmsQuietHours: () => false,
        isAliyunSmsAutoSendEnabled: () => false,
      })
    ).skipped,
    'sms_disabled'
  );
  const ok = await checkSmsSilentFailure(pool, {
    inSmsQuietHours: () => false,
    isAliyunSmsAutoSendEnabled: () => true,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.pending, 0);
});

test('checkSmsSilentFailure: alerts when pending + stale send', async () => {
  let alerted = '';
  const pool = {
    async query(sql) {
      if (String(sql).includes('growth_campaign_jobs')) {
        return { rows: [{ n: 5 }] };
      }
      return { rows: [{ last_sent: new Date(Date.now() - 5 * 3600000).toISOString() }] };
    },
  };
  const r = await checkSmsSilentFailure(pool, {
    inSmsQuietHours: () => false,
    isAliyunSmsAutoSendEnabled: () => true,
    getSendGrowthAlert: () => async (msg) => {
      alerted = msg;
    },
    now: () => Date.now(),
  });
  assert.equal(r.ok, false);
  assert.ok(r.hours_since_last_sent > STALE_HOURS);
  assert.ok(alerted.includes('停摆'));
});

test('runSmsTemplateReconcile: mismatch + remote query failure', async () => {
  let alertMsg = '';
  const pool = {};
  const r = await runSmsTemplateReconcile(pool, {
    listSmsTemplates: async () => [
      {
        template_code: 'SMS_A',
        brand_suffix: 'hc',
        slot: 'VIP',
        content: '你好${name}',
      },
      { template_code: 'SMS_B', brand_suffix: 'hc', slot: 'X', content: 'ok' },
    ],
    querySmsTemplate: async (code) => {
      if (code === 'SMS_B') throw new Error('not found');
      return { status: 1, content: '你好 ${name} ' }; // whitespace differs → normalize equal
    },
    getSendGrowthAlert: () => async (msg) => {
      alertMsg = msg;
    },
  });
  // SMS_A normalizes equal → no content mismatch; SMS_B query fails → 1 mismatch
  assert.equal(r.checked, 2);
  assert.equal(r.mismatches, 1);
  assert.ok(alertMsg.includes('SMS_B'));
});

test('runSmsTemplateReconcile: content mismatch after normalize', async () => {
  const r = await runSmsTemplateReconcile(
    {},
    {
      listSmsTemplates: async () => [
        { template_code: 'SMS_C', brand_suffix: 'hc', slot: 'VIP', content: 'A版正文' },
      ],
      querySmsTemplate: async () => ({ status: 1, content: 'B版正文' }),
      getSendGrowthAlert: () => null,
    }
  );
  assert.equal(r.mismatches, 1);
});
