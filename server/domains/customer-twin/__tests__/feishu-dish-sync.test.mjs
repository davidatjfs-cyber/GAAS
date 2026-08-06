import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textOf, multiOf, numOf, dateOf, extractDishAttributes, extractNewDishRecord,
} from '../feishu-dish-sync.js';

test('文本字段提取：数组/对象/纯文本', () => {
  assert.equal(textOf({ 菜品名称: [{ text: '黑金叉烧', type: 'text' }] }, ['菜品名称']), '黑金叉烧');
  assert.equal(textOf({ 菜名: '招牌捞鸡' }, ['菜品名称', '菜名']), '招牌捞鸡');
  assert.equal(textOf({ 品牌: '洪潮' }, ['品牌']), '洪潮');
  assert.equal(textOf({}, ['品牌']), '');
});

test('多选字段：数组去空格合并', () => {
  assert.equal(multiOf({ 主食材: ['牛肉'] }, ['主食材']), '牛肉');
  assert.equal(multiOf({ 适合场景: ['商务宴请 ', '家庭聚餐', '情侣约会'] }, ['适合场景']), '商务宴请、家庭聚餐、情侣约会');
  assert.equal(multiOf({}, ['做法']), '');
});

test('数字与日期字段', () => {
  assert.equal(numOf({ 堂食售价: 78 }, ['堂食售价']), 78);
  assert.equal(numOf({ 成本: '41.56' }, ['成本']), 41.56);
  assert.equal(numOf({ 拟定售价: [{ text: '88' }] }, ['拟定售价']), 88);
  assert.equal(numOf({}, ['成本']), null);
  assert.equal(dateOf({ 研发日期: 1767225600000 }, ['研发日期']), '2026-01-01');
  assert.equal(dateOf({ 研发日期: '2026-08-05' }, ['研发日期']), '2026-08-05');
  assert.equal(dateOf({}, ['研发日期']), null);
});

test('菜品属性提取：去空格 + 多选合并', () => {
  const attrs = extractDishAttributes({
    辣度: '不辣 ',
    主食材: ['猪肉'],
    做法: ['烤'],
    口味类型: '浓郁',
    是否招牌: '是',
    是否新品: '否',
    分量感: '中',
    适合场景: ['商务宴请 ', '家庭聚餐'],
  });
  assert.deepEqual(attrs, {
    spicy_level: '不辣',
    main_ingredient: '猪肉',
    cooking_method: '烤',
    taste_type: '浓郁',
    is_signature: '是',
    is_new: '否',
    portion_size: '中',
    suitable_scenes: '商务宴请、家庭聚餐',
  });
});

test('新品研发记录字段映射完整', () => {
  const row = extractNewDishRecord({
    record_id: 'recNew1',
    fields: {
      菜品名: '香茅烤鸡',
      品牌: '洪潮',
      研发日期: 1767225600000,
      研发人: [{ name: '张三' }],
      成本: 12.5,
      拟定售价: 88,
      状态: '待试菜',
      '卖点/备注': '皮脆肉嫩',
      老板意见: '可以',
      营运意见: '定价偏高',
      '店长/出品经理意见': '分量偏小',
      试菜结论: '调整后通过',
      是否复测: '是',
      '上新30天实际销量（份）': 120,
    },
  });
  assert.equal(row.dish_name, '香茅烤鸡');
  assert.equal(row.brand, '洪潮');
  assert.equal(row.dev_date, '2026-01-01');
  assert.equal(row.cost, 12.5);
  assert.equal(row.planned_price, 88);
  assert.equal(row.status, '待试菜');
  assert.equal(row.selling_points, '皮脆肉嫩');
  assert.equal(row.boss_opinion, '可以');
  assert.equal(row.ops_opinion, '定价偏高');
  assert.equal(row.manager_opinion, '分量偏小');
  assert.equal(row.tasting_conclusion, '调整后通过');
  assert.equal(row.retest, '是');
  assert.equal(row.sales_30d, 120);
});
