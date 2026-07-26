import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTagsForLead,
  recommendCaseTheme,
  recommendAssets,
  recommendNextSteps,
} from './sales-tags.js';

test('deriveTagsForLead applies base / need / sales tags', () => {
  const tags = deriveTagsForLead({
    store_count: 12,
    cuisine: '粤菜正餐',
    phone_data_ready: true,
    member_estimate: 1000,
    pain_point: '老客复购低，营业额下降，店长执行弱',
    intent_level: 'high',
    stage: 'need_identified',
    decision_role: '老板',
    demo_count: 1,
    budget_range: 'high',
    events: [{ type: 'ASK_PRICE' }, { type: 'COMPETITOR_MENTIONED' }],
  });
  assert.ok(tags.includes('连锁客户'));
  assert.ok(tags.includes('大型连锁'));
  assert.ok(tags.includes('高客单餐厅'));
  assert.ok(tags.includes('有POS数据'));
  assert.ok(tags.includes('老客复购低'));
  assert.ok(tags.includes('高意向'));
  assert.ok(tags.includes('已看Demo'));
  assert.ok(tags.includes('已询价'));
  assert.ok(tags.includes('决策人已参与'));
});

test('deriveTagsForLead marks single store and lost/on_hold', () => {
  const tags = deriveTagsForLead({
    store_count: 1,
    cuisine: '快餐小吃',
    phone_data_ready: false,
    member_estimate: 0,
    stage: 'lost',
    notes: '暂缓考虑',
  });
  assert.ok(tags.includes('单店客户'));
  assert.ok(tags.includes('快餐客户'));
  assert.ok(tags.includes('无数据基础'));
  assert.ok(tags.includes('失单'));
  assert.ok(tags.includes('暂缓'));
});

test('recommendCaseTheme maps pain points to themes', () => {
  assert.equal(recommendCaseTheme({ pain_point: '老客流失' }), '老客回店增长案例');
  assert.equal(recommendCaseTheme({ pain_point: '营业额下滑' }), '营业额归因与增长案例');
  assert.equal(recommendCaseTheme({ pain_point: '店长执行力差' }), '门店执行闭环案例');
  assert.equal(recommendCaseTheme({ pain_point: '员工培训难' }), '人才培养与绩效案例');
  assert.equal(recommendCaseTheme({ pain_point: '多店管理标准化' }), '多店统一管理案例');
  assert.equal(recommendCaseTheme({ pain_point: '老板看不见数据' }), '老板经营日报案例');
  assert.equal(recommendCaseTheme({}), '30天试跑案例');
});

test('recommendAssets follows tags with fallback', () => {
  assert.deepEqual(
    recommendAssets({ tags: ['老客复购低', '连锁客户'] }).slice(0, 3),
    ['老客回店增长案例', '客户分层自动营销介绍', '连锁客户方案与报价']
  );
  assert.deepEqual(recommendAssets({ tags: [] }), ['30天试跑方案']);
});

test('recommendNextSteps varies by stage and events', () => {
  const early = recommendNextSteps({ stage: 'new' });
  assert.ok(early.includes('确认门店数量'));
  assert.ok(early.includes('确认核心经营痛点'));

  const need = recommendNextSteps({ stage: 'need_identified', demo_count: 0 });
  assert.ok(need.includes('发送匹配案例'));
  assert.ok(need.includes('邀约Demo'));

  const afterDemo = recommendNextSteps({
    stage: 'demo_completed',
    demo_count: 1,
    decision_role: '店长',
    events: [{ type: 'ASK_PRICE' }],
    trial_status: 'in_progress',
  });
  assert.ok(afterDemo.includes('确认决策人是否参与'));
  assert.ok(afterDemo.includes('询问内部最大顾虑'));
  assert.ok(afterDemo.includes('检查试跑数据与目标达成'));
});
