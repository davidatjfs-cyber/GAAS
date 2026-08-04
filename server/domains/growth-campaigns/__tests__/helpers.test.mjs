/**
 * domains/growth-campaigns/helpers.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_TYPES,
  ABC_ROTATION_ORDER,
  ABC_STEP_DEFS,
  freqDaysEnv,
  deriveAbcStep,
  inSmsQuietHours,
  buildCampaignTargetQuery,
  interpolateTemplate,
  buildActionMessage,
  phoneHashPct,
  phoneAbBucket,
  holdoutPct,
  isSmsPermanentFailure,
} from '../helpers.js';

test('isSmsPermanentFailure：识别阿里云永久失败报错', () => {
  for (const msg of [
    '黑名单管控',
    '用户已退订营销短信',
    '手机号码格式错误',
    '手机号格式错误',
    '空号',
    '号码状态错误',
    '号码不存在',
    'isv.MOBILE_NUMBER_ILLEGAL',
    'BLACK_KEY_CONTROL_LIMIT',
    'BLACK_USER_CONTROL_LIMIT',
  ]) {
    assert.equal(isSmsPermanentFailure(msg), true, msg);
  }
  for (const msg of [
    '账户余额不足',
    '该账号下找不到对应模板',
    '业务停机',
    'fetch failed',
    'There is a risk of leakage of this AccessKey.',
    '',
    null,
  ]) {
    assert.equal(isSmsPermanentFailure(msg), false, String(msg));
  }
});

test('freqDaysEnv：缺省/空串用默认值，0 表示关闭', () => {
  const key = 'TEST_FREQ_DAYS_' + Date.now();
  assert.equal(freqDaysEnv(key, 30), 30);
  process.env[key] = '';
  assert.equal(freqDaysEnv(key, 30), 30);
  process.env[key] = '0';
  assert.equal(freqDaysEnv(key, 30), 0);
  process.env[key] = '14';
  assert.equal(freqDaysEnv(key, 30), 14);
  delete process.env[key];
});

test('deriveAbcStep：轮换步骤与红名单门槛', () => {
  assert.deepEqual(deriveAbcStep('unknown_key', 0), {
    step: null,
    freqDaysOverride: null,
    blacklisted: false,
  });
  assert.equal(deriveAbcStep('vip_gift', 0).step, 'giftA');
  assert.equal(deriveAbcStep('vip_gift', 1).step, 'giftB');
  assert.equal(deriveAbcStep('vip_gift', 5).step, 'coupon2x50');
  assert.equal(deriveAbcStep('vip_gift', 6).blacklisted, true);
  assert.equal(deriveAbcStep('dormant_60_90', 0).step, 'coupon30');
  assert.equal(deriveAbcStep('vip_gift', 5).freqDaysOverride, 75);
});

test('inSmsQuietHours：默认窗口内可发', () => {
  const inWindow = new Date('2026-07-26T03:00:00.000Z'); // 北京时间 11:00
  assert.equal(inSmsQuietHours(inWindow), false);
  const night = new Date('2026-07-26T16:00:00.000Z'); // 北京时间 00:00
  assert.equal(inSmsQuietHours(night), true);
});

test('buildCampaignTargetQuery：无人群维度返回 null', () => {
  assert.equal(buildCampaignTargetQuery({ ruleKey: 'vip_gift', freqDays: 7 }), null);
});

test('buildCampaignTargetQuery：带筛选生成 SQL 与参数', () => {
  const q = buildCampaignTargetQuery({
    storeId: 'store_a',
    valueTier: 'vip',
    lifecycleStage: 'active',
    minVisits: 2,
    maxDays: 90,
    ruleKey: 'vip_gift',
    freqDays: 30,
    limit: 100,
  });
  assert.ok(q.sql.includes('cp.store_id = $2'));
  assert.ok(q.sql.includes('cp.value_tier = $3'));
  assert.ok(q.sql.includes('cp.lifecycle_stage = $4'));
  assert.ok(q.sql.includes('pos_order_count,0) >= 2'));
  assert.ok(q.sql.includes('growth_sms_suppression s'));
  assert.ok(q.sql.includes('LIMIT 100'));
  assert.deepEqual(q.params, ['30', 'store_a', 'vip', 'active', 'vip_gift']);
});

test('interpolateTemplate / buildActionMessage', () => {
  assert.equal(interpolateTemplate('Hi {name}', { name: '张三' }), 'Hi 张三');
  assert.equal(interpolateTemplate('Hi {missing}', {}), 'Hi ');
  const msg = buildActionMessage(
    { title: '默认标题' },
    { content_template: '{customer_name}，券{coupon_value_text}', coupon_value_fen: 5000 }
  );
  assert.match(msg, /您好/);
  assert.match(msg, /¥50/);
});

test('phoneHashPct / phoneAbBucket 确定性', () => {
  const p = '13800138000';
  assert.equal(phoneHashPct(p), phoneHashPct(p));
  assert.equal(phoneAbBucket(p, 2), phoneAbBucket(p, 2));
  assert.ok(phoneHashPct(p) >= 0 && phoneHashPct(p) < 100);
  assert.ok(phoneAbBucket(p, 2) >= 0 && phoneAbBucket(p, 2) < 2);
});

test('holdoutPct 钳制在 0-50', () => {
  const key = 'GROWTH_HOLDOUT_PCT';
  const prev = process.env[key];
  process.env[key] = '999';
  assert.equal(holdoutPct(), 50);
  process.env[key] = '-5';
  assert.equal(holdoutPct(), 0);
  if (prev === undefined) delete process.env[key];
  else process.env[key] = prev;
});

test('CAMPAIGN_TYPES / ABC 配置结构', () => {
  assert.ok(CAMPAIGN_TYPES.vip_gift);
  assert.ok(CAMPAIGN_TYPES.prospect_recall.vars.includes('code'));
  assert.equal(ABC_ROTATION_ORDER.vip_gift.length, 6);
  assert.equal(ABC_STEP_DEFS.coupon50.coupon_value_fen, 5000);
  assert.equal(ABC_STEP_DEFS.coupon2x50.coupon_count, 2);
});
