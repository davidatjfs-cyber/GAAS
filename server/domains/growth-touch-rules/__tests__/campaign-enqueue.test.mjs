/**
 * domains/growth-touch-rules/campaign-enqueue.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueCampaignJobsForRule } from '../campaign-enqueue.js';

function mockPool(handlers = {}) {
  return {
    async query(sql, params) {
      for (const [needle, fn] of Object.entries(handlers)) {
        if (String(sql).includes(needle)) return fn(sql, params);
      }
      if (String(sql).includes('growth_sms_suppression')) return { rows: [] };
      if (String(sql).includes('growth_delivery_logs')) return { rows: [] };
      if (String(sql).includes('growth_campaign_jobs')) return { rows: [] };
      return { rows: [] };
    },
  };
}

test('enqueueCampaignJobsForRule: unknown campaign', async () => {
  const pool = mockPool();
  const result = await enqueueCampaignJobsForRule(
    pool,
    { rule_key: 'x', enabled: true, approved_at: new Date(), action_payload: {} },
    [{ phone: '13800138000', store_id: 's1' }],
    'not_a_real_campaign_key'
  );
  assert.equal(result.enqueued, 0);
  assert.equal(result.skipped, 'unknown_campaign');
});

test('enqueueCampaignJobsForRule: governance skip when rule not approved', async () => {
  const prev = process.env.ALIYUN_SMS_ENABLED;
  process.env.ALIYUN_SMS_ENABLED = 'true';
  try {
    const pool = mockPool();
    const result = await enqueueCampaignJobsForRule(
      pool,
      { rule_key: 'x', enabled: true, approved_at: null, auto_execute: true, action_payload: {} },
      [{ phone: '13800138000', store_id: 's1' }],
      'hc_weekday_lunch'
    );
    assert.equal(result.enqueued, 0);
    assert.equal(result.skipped, 'governance');
  } finally {
    if (prev === undefined) delete process.env.ALIYUN_SMS_ENABLED;
    else process.env.ALIYUN_SMS_ENABLED = prev;
  }
});

test('enqueueCampaignJobsForRule: governance skip when SMS auto-send disabled', async () => {
  const prev = process.env.ALIYUN_SMS_ENABLED;
  process.env.ALIYUN_SMS_ENABLED = 'false';
  try {
    const pool = mockPool();
    const result = await enqueueCampaignJobsForRule(
      pool,
      { rule_key: 'x', enabled: true, approved_at: new Date(), auto_execute: true, action_payload: {} },
      [{ phone: '13800138000', store_id: 's1' }],
      'hc_weekday_lunch'
    );
    assert.equal(result.enqueued, 0);
    assert.equal(result.skipped, 'governance');
  } finally {
    if (prev === undefined) delete process.env.ALIYUN_SMS_ENABLED;
    else process.env.ALIYUN_SMS_ENABLED = prev;
  }
});

test('enqueueCampaignJobsForRule: enqueues pending job for valid candidate', async () => {
  const envBackup = {
    ALIYUN_SMS_ENABLED: process.env.ALIYUN_SMS_ENABLED,
    ALIYUN_SMS_HCWDLUNCH_DEFAULT: process.env.ALIYUN_SMS_HCWDLUNCH_DEFAULT,
    GROWTH_HOLDOUT_PCT: process.env.GROWTH_HOLDOUT_PCT,
    ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS: process.env.ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS,
  };
  process.env.ALIYUN_SMS_ENABLED = 'true';
  process.env.ALIYUN_SMS_HCWDLUNCH_DEFAULT = 'SMS_HC_LUNCH_TEST';
  process.env.GROWTH_HOLDOUT_PCT = '0';
  process.env.ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS = '0';
  let jobInserted = false;
  const pool = {
    async query(sql) {
      const s = String(sql);
      if (s.includes('growth_sms_suppression')) return { rows: [] };
      if (s.includes('growth_delivery_logs')) return { rows: [] };
      if (s.includes('SELECT 1 FROM growth_campaign_jobs')) return { rows: [] };
      if (s.includes('INSERT INTO growth_campaign_jobs')) {
        jobInserted = true;
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  try {
    const result = await enqueueCampaignJobsForRule(
      pool,
      {
        rule_key: 'hc_lunch_auto',
        enabled: true,
        approved_at: new Date(),
        auto_execute: true,
        action_payload: { valid_days: 14 },
      },
      [{ phone: '13800138000', store_id: 'unknown-store', customer_name: '张三' }],
      'hc_weekday_lunch'
    );
    assert.ok(jobInserted);
    assert.equal(result.enqueued, 1);
  } finally {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('enqueueCampaignJobsForRule: missing_value when campaign requires face value', async () => {
  const prev = process.env.ALIYUN_SMS_ENABLED;
  process.env.ALIYUN_SMS_ENABLED = 'true';
  try {
    const pool = mockPool();
    const result = await enqueueCampaignJobsForRule(
      pool,
      { rule_key: 'x', enabled: true, approved_at: new Date(), auto_execute: true, action_payload: {} },
      [{ phone: '13800138000', store_id: 's1' }],
      'mj_dinner_weekend'
    );
    assert.equal(result.enqueued, 0);
    assert.equal(result.skipped, 'missing_value');
  } finally {
    if (prev === undefined) delete process.env.ALIYUN_SMS_ENABLED;
    else process.env.ALIYUN_SMS_ENABLED = prev;
  }
});

test('enqueueCampaignJobsForRule: holdout member recorded without enqueue', async () => {
  const envBackup = {
    ALIYUN_SMS_ENABLED: process.env.ALIYUN_SMS_ENABLED,
    ALIYUN_SMS_HCWDLUNCH_DEFAULT: process.env.ALIYUN_SMS_HCWDLUNCH_DEFAULT,
    GROWTH_HOLDOUT_PCT: process.env.GROWTH_HOLDOUT_PCT,
    ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS: process.env.ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS,
  };
  process.env.ALIYUN_SMS_ENABLED = 'true';
  process.env.ALIYUN_SMS_HCWDLUNCH_DEFAULT = 'SMS_HC_LUNCH_TEST';
  process.env.GROWTH_HOLDOUT_PCT = '50';
  process.env.ALIYUN_SMS_GLOBAL_FREQUENCY_DAYS = '0';
  let holdoutInserted = false;
  const pool = {
    async query(sql) {
      const s = String(sql);
      if (s.includes('growth_sms_suppression')) return { rows: [] };
      if (s.includes('growth_delivery_logs')) return { rows: [] };
      if (s.includes('growth_holdout_members')) {
        holdoutInserted = true;
        return { rows: [] };
      }
      if (s.includes('SELECT 1 FROM growth_campaign_jobs')) return { rows: [] };
      if (s.includes('INSERT INTO growth_campaign_jobs')) return { rows: [] };
      return { rows: [] };
    },
  };
  try {
    const phones = Array.from({ length: 30 }, (_, i) => `1390013${String(i).padStart(4, '0')}`);
    const result = await enqueueCampaignJobsForRule(
      pool,
      {
        rule_key: 'hc_lunch_auto',
        enabled: true,
        approved_at: new Date(),
        auto_execute: true,
        action_payload: { valid_days: 14 },
      },
      phones.map((phone) => ({ phone, store_id: 'unknown-store', customer_name: '测' })),
      'hc_weekday_lunch'
    );
    assert.ok(holdoutInserted || result.held_out > 0);
  } finally {
    for (const [k, v] of Object.entries(envBackup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
