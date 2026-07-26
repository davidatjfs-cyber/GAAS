/**
 * domains/growth-touch-rules/engine.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTouchRuleEngine, POS_STALE_DAYS } from '../engine.js';

function baseDeps(overrides = {}) {
  return {
    executeGrowthActionRecord: async () => ({}),
    isMemberCouponPushConfigured: () => false,
    isSubscribePushConfigured: () => false,
    isAliyunSmsConfigured: () => true,
    isAliyunSmsAutoSendEnabled: () => false,
    log: { warn: () => {} },
    ...overrides,
  };
}

function mockPool(routeFn) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      return routeFn(String(sql), params, queries);
    },
  };
}

test('POS_STALE_DAYS is 3', () => {
  assert.equal(POS_STALE_DAYS, 3);
});

test('runTouchRuleEngine: POS stale guard skips and inserts alert', async () => {
  let alertInserted = false;
  const pool = mockPool((sql) => {
    if (sql.includes('MAX(biz_date)')) {
      return { rows: [{ latest: '2026-07-20', lag_days: 5 }] };
    }
    if (sql.includes('growth_alerts')) {
      alertInserted = true;
      return { rows: [] };
    }
    return { rows: [] };
  });
  const result = await runTouchRuleEngine(pool, { tenantId: 'default' }, baseDeps());
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'pos_data_stale');
  assert.equal(result.created, 0);
  assert.equal(result.lag_days, 5);
  assert.ok(alertInserted);
});

test('runTouchRuleEngine: balance channel rule is skipped', async () => {
  const pool = mockPool((sql) => {
    if (sql.includes('MAX(biz_date)')) return { rows: [{ latest: '2026-07-26', lag_days: 0 }] };
    if (sql.includes('growth_touch_rules')) {
      return {
        rows: [{
          rule_key: 'stored_value_balance',
          enabled: true,
          action_payload: { channel: 'balance' },
          action_type: 'send_message',
        }],
      };
    }
    if (sql.includes('growth_actions')) throw new Error('balance rule should not create actions');
    return { rows: [] };
  });
  const result = await runTouchRuleEngine(pool, {}, baseDeps());
  assert.equal(result.created, 0);
});

test('runTouchRuleEngine: campaign_key path updates last_run_at', async () => {
  const prevSms = process.env.ALIYUN_SMS_ENABLED;
  process.env.ALIYUN_SMS_ENABLED = 'true';
  let lastRunUpdated = false;
  const pool = mockPool((sql) => {
    if (sql.includes('MAX(biz_date)')) return { rows: [{ latest: '2026-07-26', lag_days: 0 }] };
    if (sql.includes('growth_touch_rules WHERE enabled')) {
      return {
        rows: [{
          rule_key: 'hc_lunch_auto',
          enabled: true,
          approved_at: new Date(),
          auto_execute: true,
          action_payload: { campaign_key: 'hc_weekday_lunch', store_id: 'hc-store-1' },
          action_type: 'send_voucher',
          name: '洪潮午市',
        }],
      };
    }
    if (sql.includes('UPDATE growth_touch_rules SET last_run_at')) {
      lastRunUpdated = true;
      return { rows: [] };
    }
    if (sql.includes('growth_customer_profiles')) return { rows: [] };
    if (sql.includes('growth_segment_members')) return { rows: [] };
    if (sql.includes('growth_sms_suppression')) return { rows: [] };
    if (sql.includes('growth_delivery_logs')) return { rows: [] };
    if (sql.includes('growth_campaign_jobs')) return { rows: [] };
    return { rows: [] };
  });
  try {
    const result = await runTouchRuleEngine(pool, {}, baseDeps());
    assert.equal(result.created, 0);
    assert.ok(lastRunUpdated);
  } finally {
    if (prevSms === undefined) delete process.env.ALIYUN_SMS_ENABLED;
    else process.env.ALIYUN_SMS_ENABLED = prevSms;
  }
});

test('runTouchRuleEngine: per-candidate path creates proposed action', async () => {
  let actionInserted = false;
  const pool = mockPool((sql) => {
    if (sql.includes('MAX(biz_date)')) return { rows: [{ latest: '2026-07-26', lag_days: 0 }] };
    if (sql.includes('growth_touch_rules WHERE enabled')) {
      return {
        rows: [{
          rule_key: 'vip_gift',
          enabled: true,
          approved_at: null,
          auto_execute: true,
          criteria: { lifecycle_stage: 'active', value_tier: 'vip' },
          action_payload: {},
          action_type: 'send_message',
          name: 'VIP礼遇',
        }],
      };
    }
    if (sql.includes('growth_customer_profiles cp')) {
      return {
        rows: [{
          customer_id: 42,
          store_id: 'store-a',
          phone: '13800138000',
          lifecycle_stage: 'active',
          value_tier: 'vip',
          pos_order_count: 5,
          days_since_last_visit: 10,
          visit_interval_days: 7,
          customer_name: '测试客',
          external_userid: null,
          openid: '',
          favorite_dishes: [],
        }],
      };
    }
    if (sql.includes('growth_segment_members')) return { rows: [] };
    if (sql.includes('growth_delivery_logs')) return { rows: [] };
    if (sql.includes('INSERT INTO growth_actions')) {
      actionInserted = true;
      return {
        rows: [{
          action_key: 'rule:vip_gift:42:2026-07-20',
          action_type: 'send_message',
          status: 'proposed',
        }],
      };
    }
    if (sql.includes('UPDATE growth_touch_rules SET last_run_at')) return { rows: [] };
    return { rows: [] };
  });
  const result = await runTouchRuleEngine(pool, {}, baseDeps({
    isAliyunSmsConfigured: () => true,
  }));
  assert.ok(actionInserted);
  assert.equal(result.created, 1);
  assert.equal(result.action_keys.length, 1);
});

test('runTouchRuleEngine: dormant winback inserts churn alert', async () => {
  let churnAlertInserted = false;
  const pool = mockPool((sql) => {
    if (sql.includes('MAX(biz_date)')) return { rows: [{ latest: '2026-07-26', lag_days: 0 }] };
    if (sql.includes('growth_touch_rules WHERE enabled')) {
      return {
        rows: [{
          rule_key: 'dormant_vip_winback',
          enabled: true,
          approved_at: null,
          auto_execute: true,
          criteria: { lifecycle_stage: 'dormant', value_tier: 'vip' },
          action_payload: {},
          action_type: 'send_message',
          name: 'VIP回流',
        }],
      };
    }
    if (sql.includes('growth_customer_profiles cp')) {
      return {
        rows: [{
          customer_id: 7,
          store_id: 'store-a',
          phone: '13800138001',
          lifecycle_stage: 'dormant',
          value_tier: 'vip',
          pos_order_count: 5,
          days_since_last_visit: 90,
          visit_interval_days: 14,
          last_visit_at: '2026-04-01',
          customer_name: '沉睡VIP',
          external_userid: null,
          openid: '',
          favorite_dishes: [],
        }],
      };
    }
    if (sql.includes('growth_segment_members')) return { rows: [] };
    if (sql.includes('growth_delivery_logs')) return { rows: [] };
    if (sql.includes('INSERT INTO growth_actions')) {
      return { rows: [{ action_key: 'rule:dormant_vip_winback:7:2026-04-01', action_type: 'send_message', status: 'proposed' }] };
    }
    if (sql.includes("alert_type, severity") && sql.includes("'churn'")) {
      churnAlertInserted = true;
      return { rows: [] };
    }
    if (sql.includes('UPDATE growth_touch_rules SET last_run_at')) return { rows: [] };
    return { rows: [] };
  });
  await runTouchRuleEngine(pool, {}, baseDeps({ isAliyunSmsConfigured: () => true }));
  assert.ok(churnAlertInserted);
});

test('runTouchRuleEngine: approved rule auto-executes via deps callback', async () => {
  let executed = false;
  const pool = mockPool((sql) => {
    if (sql.includes('MAX(biz_date)')) return { rows: [{ latest: '2026-07-26', lag_days: 0 }] };
    if (sql.includes('growth_touch_rules WHERE enabled')) {
      return {
        rows: [{
          rule_key: 'vip_gift',
          enabled: true,
          approved_at: new Date(),
          approved_by: 'admin',
          auto_execute: true,
          criteria: { lifecycle_stage: 'active', value_tier: 'vip' },
          action_payload: {},
          action_type: 'send_message',
          name: 'VIP礼遇',
        }],
      };
    }
    if (sql.includes('growth_customer_profiles cp')) {
      return {
        rows: [{
          customer_id: 42,
          store_id: 'store-a',
          phone: '13800138000',
          lifecycle_stage: 'active',
          value_tier: 'vip',
          pos_order_count: 5,
          days_since_last_visit: 10,
          visit_interval_days: 7,
          customer_name: '测试客',
          external_userid: 'wx-ext-1',
          openid: '',
          favorite_dishes: [],
        }],
      };
    }
    if (sql.includes('growth_segment_members')) return { rows: [] };
    if (sql.includes('growth_delivery_logs')) return { rows: [] };
    if (sql.includes('INSERT INTO growth_actions')) {
      return { rows: [{ action_key: 'rule:vip_gift:42:2026-07-20', action_type: 'send_message', status: 'proposed' }] };
    }
    if (sql.includes('UPDATE growth_touch_rules SET last_run_at')) return { rows: [] };
    return { rows: [] };
  });
  await runTouchRuleEngine(pool, {}, baseDeps({
    executeGrowthActionRecord: async () => {
      executed = true;
      return {};
    },
  }));
  assert.ok(executed);
});
