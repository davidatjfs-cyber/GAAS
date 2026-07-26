/**
 * domains/growth-campaigns/sms-params.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMS_DERIVED_VARS,
  smsSafeName,
  genSmsShortCode,
  formatSmsValidDate,
  buildSmsTemplateParam,
} from '../sms-params.js';

test('smsSafeName：非中文称谓兜底「顾客」', () => {
  assert.equal(smsSafeName('John'), '顾客');
  assert.equal(smsSafeName('张先生'), '张先生');
});

test('genSmsShortCode：6 位数字', () => {
  const code = genSmsShortCode();
  assert.match(code, /^\d{6}$/);
});

test('formatSmsValidDate：M月D日', () => {
  assert.match(formatSmsValidDate(7), /^\d{1,2}月\d{1,2}日$/);
});

test('buildSmsTemplateParam：旧三变量模板', async () => {
  const r = await buildSmsTemplateParam(null, {
    phone: '13800138000',
    customer_name: '李女士',
    days_since_last_visit: 14,
    coupon_value_fen: 3000,
  }, 'store_a');
  assert.equal(r.skipReason, '');
  assert.deepEqual(r.templateParam, { name: '李女士', days: '14', value: '30' });
});

test('buildSmsTemplateParam：无券面额跳过', async () => {
  const r = await buildSmsTemplateParam(null, { phone: '13800138000', coupon_value_fen: 0 }, 'store_a');
  assert.equal(r.skipReason, 'no_coupon_value');
});

test('buildSmsTemplateParam：derived {code} 生成短码', async () => {
  const r = await buildSmsTemplateParam(null, {
    phone: '13800138000',
    content_template: '码{code} 有效期{date}',
    valid_days: 7,
  }, 'store_a');
  assert.equal(r.skipReason, '');
  assert.match(r.generatedCode, /^\d{6}$/);
  assert.equal(r.templateParam.code, r.generatedCode);
  assert.ok(SMS_DERIVED_VARS.has('code'));
});
