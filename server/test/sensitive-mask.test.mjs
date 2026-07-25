import test from 'node:test';
import assert from 'node:assert/strict';
import { maskSensitiveText, maskLLMMessages } from '../utils/sensitive-mask.js';

test('maskSensitiveText：手机号 / 身份证 / 空', () => {
  assert.equal(maskSensitiveText(''), '');
  assert.equal(maskSensitiveText(null), '');
  assert.equal(maskSensitiveText('联系 13800138000'), '联系 138****8000');
  // 用 2000 年号避免身份证里嵌出 1[3-9]×9 位被手机号规则先命中
  assert.equal(
    maskSensitiveText('身份证 110101200001011234'),
    '身份证 1101**********1234'
  );
  assert.equal(
    maskSensitiveText('旧证 110101000101123'),
    '旧证 1101*******1123'
  );
});

test('maskLLMMessages：只改 string content，不改原数组', () => {
  assert.equal(maskLLMMessages(null), null);
  const msgs = [
    { role: 'user', content: '我的手机 13912345678' },
    { role: 'assistant', content: 123 },
    'skip',
    null,
  ];
  const out = maskLLMMessages(msgs);
  assert.notEqual(out, msgs);
  assert.equal(out[0].content, '我的手机 139****5678');
  assert.equal(msgs[0].content, '我的手机 13912345678');
  assert.equal(out[1].content, 123);
  assert.equal(out[2], 'skip');
});
