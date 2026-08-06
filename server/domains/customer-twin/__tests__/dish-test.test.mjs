import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDishToPersonas } from '../dish-match.js';
import { buildDishRisks } from '../dish-risk.js';
import { buildTastingChecklist } from '../dish-checklist.js';

const DISH = {
  name: '测试香茅烤鸡',
  price: 88,
  spicy_level: '中辣',
  main_ingredient: '鸡肉',
  cooking_method: '烤',
  taste_type: '浓郁',
  is_signature: '否',
  is_new: '是',
  portion_size: '中',
  suitable_scenes: '家庭聚餐、朋友聚会',
};

test('匹配器：同输入同输出（确定性）', () => {
  const a = matchDishToPersonas({ dish: DISH, avgPrice: 50 });
  const b = matchDishToPersonas({ dish: DISH, avgPrice: 50 });
  assert.deepEqual(a, b);
});

test('匹配器：高价+中辣对价格敏感/家庭客群不适合', () => {
  const m = matchDishToPersonas({ dish: DISH, avgPrice: 50 });
  const price = m.personas.find((p) => p.persona_key === 'price_sensitive');
  const family = m.personas.find((p) => p.persona_key === 'family_dinner');
  assert.equal(price.fit, '不适合');
  assert.ok(price.reasons.some((r) => r.includes('价格')));
  assert.equal(family.fit, '不适合');
  assert.ok(family.reasons.some((r) => r.includes('辣度')));
});

test('风险预判：中辣/高价/新品命中对应风险', () => {
  const risks = buildDishRisks({ dish: DISH, avgPrice: 50, corpus: [], realComplaints: [] });
  const ids = risks.map((r) => r.risk);
  assert.ok(ids.includes('辣度过高'));
  assert.ok(ids.includes('价格偏高'));
  assert.ok(ids.includes('新品不确定性'));
  const spicy = risks.find((r) => r.risk === '辣度过高');
  assert.equal(spicy.severity, '高');
});

test('风险预判：真实差评命中时引用原文', () => {
  const risks = buildDishRisks({
    dish: { ...DISH, spicy_level: '不辣', is_new: '否', portion_size: '小', price: 120 },
    avgPrice: 50,
    corpus: [],
    realComplaints: ['这个价格有点贵，分量还少，性价比太低。'],
  });
  const priceRisk = risks.find((r) => r.risk === '价格偏高');
  assert.ok(priceRisk);
  assert.equal(priceRisk.source, '数据统计');
  assert.ok(priceRisk.evidence.some((e) => e.text.includes('性价比')));
});

test('试菜验证清单：定价/口味/分量问题 3-5 条', () => {
  const m = matchDishToPersonas({ dish: DISH, avgPrice: 50 });
  const risks = buildDishRisks({ dish: m.dish, avgPrice: 50, corpus: [], realComplaints: [] });
  const checklist = buildTastingChecklist({ dish: m.dish, match: m, risks });
  assert.ok(checklist.length >= 3 && checklist.length <= 5);
  assert.ok(checklist.some((q) => q.question.includes('定价')));
  assert.ok(checklist.some((q) => q.question.includes('辣度')));
});
