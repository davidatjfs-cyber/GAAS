import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanPhone,
  cleanText,
  maskPhone,
  parseCampaignCriteria,
  aggregateStoredValueMembers,
} from '../domains/growth-stored-value/helpers.js';
import {
  previewCampaign,
  launchCampaign,
  sendCampaignSms,
  previewRemind,
  launchRemind,
} from '../domains/growth-stored-value/service.js';

function passthroughTenantContext() {
  return { run: async (_tid, fn) => fn() };
}

function baseCtx(overrides = {}) {
  return {
    pool: { async query() { return { rows: [] }; } },
    sendAliyunSms: async () => ({ provider_msg_id: 'm1', raw: {} }),
    tenantContext: passthroughTenantContext(),
    resolveTenantIdDefault: () => 'default',
    resolveTenantIdForStore: async () => 'default',
    CAMPAIGN_TYPES: {
      VIP: { coupon_count: 1, vars: ['value', 'date', 'code'] },
    },
    freqDaysEnv: (_k, d) => d,
    globalSmsCapped: async () => null,
    isPhoneSuppressed: async () => false,
    handleSmsFailure: async () => {},
    upsertCustomer: async () => ({ id: 1 }),
    upsertDeliveryLog: async () => {},
    insertGrowthEvent: async () => {},
    pickCampaignTemplate: () => 'SMS_TPL',
    pickCampaignSmsSign: () => 'SIGN',
    formatSmsValidDate: () => '2026-08-01',
    pickBalanceTemplateByStore: () => 'SMS_BAL',
    buildCampaignTargetQuery: () => ({ sql: 'SELECT 1', params: [] }),
    buildRemindTargetsQuery: () => ({ sql: 'SELECT 1', params: [] }),
    mapStoreNameToId: (n) => (n === '洪潮' ? 'hongchao' : ''),
    bitText: (v) => String(v == null ? '' : v),
    bitNum: (v) => Number(v) || 0,
    bitDateMs: (v) => (v ? Number(v) : 0),
    bitPhone: (v) => String(v || '').replace(/[^0-9]/g, ''),
    readStoredValueBitableRecords: async () => [],
    ABC_ROTATION_ORDER: {},
    ABC_STEP_DEFS: {},
    deriveAbcStep: () => ({ step: 'A', blacklisted: false, freqDaysOverride: null }),
    pickAbcTemplate: () => 'SMS_ABC',
    countCampaignSent: async () => 0,
    campaignTouchCapped: async () => false,
    marketingFatigueCapped: async () => false,
    ...overrides,
  };
}

test('helpers: clean / mask / parseCampaignCriteria', () => {
  assert.equal(cleanText('  ab  ', 2), 'ab');
  assert.equal(cleanPhone('138-0013-8000'), '13800138000');
  assert.equal(maskPhone('13800138000'), '138****8000');
  const c = parseCampaignCriteria({ store_id: 's1', min_visits: '3', max_days: '' });
  assert.equal(c.storeId, 's1');
  assert.equal(c.minVisits, 3);
  assert.ok(Number.isNaN(c.maxDays));
});

test('aggregateStoredValueMembers: latest balance + consume/recharge dates', () => {
  const helpers = {
    bitText: (v) => String(v == null ? '' : v),
    bitNum: (v) => Number(v) || 0,
    bitDateMs: (v) => Number(v) || 0,
    bitPhone: (v) => String(v || ''),
    mapStoreNameToId: () => 'store-a',
  };
  const byCard = aggregateStoredValueMembers(
    [
      {
        fields: {
          卡号: 'C1',
          交易时间: 100,
          营业日期: 100,
          交易类型: '充值',
          会员名称: '旧名',
          手机号: '13800138000',
          '交易后-储值余额': 50,
          交易门店: '洪潮',
        },
      },
      {
        fields: {
          卡号: 'C1',
          交易时间: 200,
          营业日期: 200,
          交易类型: '消费',
          会员名称: '新名',
          手机号: '13800138000',
          '交易后-储值余额': 30,
          交易门店: '洪潮',
        },
      },
    ],
    helpers
  );
  const m = byCard.get('C1');
  assert.equal(m.member_name, '新名');
  assert.equal(m.balance_fen, 3000);
  assert.equal(m.consumeMs, 200);
  assert.equal(m.rechargeMs, 100);
});

test('previewCampaign / launchCampaign: unknown_campaign_key', async () => {
  const ctx = baseCtx();
  const p = await previewCampaign(ctx, 'default', { campaign_key: 'NOPE' });
  assert.equal(p.status, 400);
  assert.equal(p.body.error, 'unknown_campaign_key');
  const l = await launchCampaign(ctx, 'default', { campaign_key: 'NOPE' });
  assert.equal(l.status, 400);
});

test('launchCampaign: missing_store_id / missing_value', async () => {
  const ctx = baseCtx();
  const noStore = await launchCampaign(ctx, 'default', { campaign_key: 'VIP', value_yuan: 20 });
  assert.equal(noStore.body.error, 'missing_store_id');
  const noVal = await launchCampaign(ctx, 'default', {
    campaign_key: 'VIP',
    store_id: 's1',
    value_yuan: 0,
  });
  assert.equal(noVal.body.error, 'missing_value');
});

test('sendCampaignSms: missing_phone / deduped', async () => {
  const noPhone = await sendCampaignSms(baseCtx(), {
    campaign_key: 'VIP',
    phone: '',
    store_id: 's1',
    coupon_code: 'X',
    value_yuan: 10,
  });
  assert.equal(noPhone.status, 400);
  assert.equal(noPhone.body.error, 'missing_phone');

  const ctx = baseCtx({
    pool: {
      async query(sql) {
        if (String(sql).includes('delivery_key')) return { rows: [{ status: 'sent' }] };
        return { rows: [] };
      },
    },
  });
  const dup = await sendCampaignSms(ctx, {
    campaign_key: 'VIP',
    phone: '13800138000',
    store_id: 's1',
    coupon_code: 'X',
    value_yuan: 10,
    idempotency_key: 'VIP:X',
  });
  assert.equal(dup.body.deduped, true);
});

test('sendCampaignSms: frequency_capped', async () => {
  const ctx = baseCtx({
    pool: {
      async query(sql) {
        if (String(sql).includes('frequency') || String(sql).includes("|| ' days'")) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      },
    },
  });
  const r = await sendCampaignSms(ctx, {
    campaign_key: 'VIP',
    phone: '13800138000',
    store_id: 's1',
    coupon_code: 'X',
    value_yuan: 10,
  });
  assert.equal(r.body.skipped, true);
  assert.equal(r.body.reason, 'frequency_capped');
});

test('previewRemind / launchRemind: missing_store_id', async () => {
  const p = await previewRemind(baseCtx(), 'default', {});
  assert.equal(p.body.error, 'missing_store_id');
  const l = await launchRemind(baseCtx(), 'default', {});
  assert.equal(l.body.error, 'missing_store_id');
});
