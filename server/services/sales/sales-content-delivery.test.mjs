import test from 'node:test';
import assert from 'node:assert/strict';
import { renderContentAssetText } from './sales-content-delivery.js';

test('培育资料只替换白名单客户变量并保留未知模板字段', () => {
  const text = renderContentAssetText(
    '{{customer_name}}，上次您关注的是{{pain_point}}，建议先选{{store_count}}家门店验证。{{unsafe}}',
    { company: '某餐饮品牌', store_count: 3, extracted: { pain_point: '多店管理' } }
  );
  assert.equal(text, '某餐饮品牌，上次您关注的是多店管理，建议先选3家门店验证。{{unsafe}}');
});

test('客户画像不完整时使用自然兜底，不输出undefined', () => {
  const text = renderContentAssetText('围绕{{pain_point}}，先看{{city}}的实际门店。', {});
  assert.equal(text, '围绕门店经营问题，先看所在城市的实际门店。');
  assert.doesNotMatch(text, /undefined|null/);
});
