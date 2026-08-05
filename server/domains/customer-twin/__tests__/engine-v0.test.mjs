import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mulberry32, samplePersonas, runSimulation, expressUtterance,
  buildRichUtterance,
} from '../engine-v0.js';

test('同 seed 生成同人格（确定性）', () => {
  const a = samplePersonas({ seed: 42, count: 6 });
  const b = samplePersonas({ seed: 42, count: 6 });
  assert.deepEqual(a, b);
  const c = samplePersonas({ seed: 43, count: 6 });
  assert.notDeepEqual(a, c);
});

test('mulberry32 返回 0..1 伪随机', () => {
  const rand = mulberry32(1);
  for (let i = 0; i < 100; i += 1) {
    const v = rand();
    assert.ok(v >= 0 && v < 1);
  }
});

test('商务宴请上错菜：惩罚显著高于普通客群', () => {
  const [business] = samplePersonas({ seed: 7, count: 1, keys: ['business_banquet'] });
  const [family] = samplePersonas({ seed: 7, count: 1, keys: ['family_dinner'] });
  const events = [{ type: 'wrong_dish' }];
  const sb = runSimulation({ persona: business, events });
  const sf = runSimulation({ persona: family, events });
  assert.ok(sb.satisfaction.total < sf.satisfaction.total, '商务客群丢分应更重');
  assert.ok(sb.stats.total_loss >= 35);
});

test('恢复分不超过原始损失（铁律）', () => {
  const [persona] = samplePersonas({ seed: 9, count: 1, keys: ['couple_date'] });
  const events = [
    { type: 'wait_food', minutes: 40 },
    { type: 'manager_apology' },
    { type: 'dessert' },
    { type: 'rework' },
    { type: 'discount' },
  ];
  const sim = runSimulation({ persona, events, startEmotion: 80 });
  assert.ok(sim.stats.total_recovery <= sim.stats.total_loss, '恢复不得超过损失');
  assert.ok(sim.final_emotion <= 80, '恢复后不高于起始情绪');
});

test('情绪曲线逐步记录且不跳变到负值', () => {
  const [persona] = samplePersonas({ seed: 11, count: 1, keys: ['price_sensitive'] });
  const sim = runSimulation({ persona, events: [{ type: 'wait_food', minutes: 35 }] });
  assert.equal(sim.emotion_curve.length, 1);
  assert.ok(sim.emotion_curve[0].emotion >= 20);
  assert.ok(Number.isFinite(sim.satisfaction.total));
  assert.ok(sim.satisfaction.breakdown.dims.等待 >= 0);
});

test('表达器：返回非空文本并带事件/风格', () => {
  const [persona] = samplePersonas({ seed: 13, count: 1, keys: ['family_dinner'] });
  const sim = runSimulation({ persona, events: [{ type: 'wait_food', minutes: 30 }] });
  const corpusByCategory = {
    slow_service: [
      { code: 'NEG-100', category: 'slow_service', expression_style: 'polite', severity: 2, content: '不好意思，我们那个菜还没好吗？' },
    ],
  };
  const out = expressUtterance({ persona, sim, corpusByCategory, seedText: 'x' });
  assert.ok(out.text.length > 0);
  assert.equal(out.event, 'wait_food');
  assert.ok(['corpus', 'template'].includes(out.source));
});

test('表达器 v2：富句式填充槽位且确定性', () => {
  const a = buildRichUtterance({ category: 'slow_service', style: 'polite', minutes: 25, dish: '烧鹅', seedText: 'x1' });
  const b = buildRichUtterance({ category: 'slow_service', style: 'polite', minutes: 25, dish: '烧鹅', seedText: 'x1' });
  assert.equal(a, b);
  assert.ok(a.includes('烧鹅'));
  assert.ok(a.length > 10);
  const direct = buildRichUtterance({ category: 'wrong_dish', style: 'direct', dish: '捞鸡', seedText: 'y2' });
  assert.ok(direct.length > 8);
});
