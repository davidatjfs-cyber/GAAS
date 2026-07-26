import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBitableDateValue,
  extractBitableFieldText,
  extractDissatisfactionDishFromFields,
  extractDissatisfactionReasonFromFields,
  extractTableVisitItems,
} from '../field-normalization.js';

test('normalizeBitableDateValue handles empty, ymd, ms, seconds', () => {
  assert.equal(normalizeBitableDateValue(null, '2026-07-01'), '2026-07-01');
  assert.equal(normalizeBitableDateValue('2026-07-15'), '2026-07-15');
  assert.equal(normalizeBitableDateValue(1721606400000), '2024-07-22');
  assert.equal(normalizeBitableDateValue(1721606400), '2024-07-22');
  assert.equal(normalizeBitableDateValue('1721606400000'), '2024-07-22');
  assert.equal(normalizeBitableDateValue(''), '');
});

test('extractBitableFieldText supports string/array/object shapes', () => {
  assert.equal(extractBitableFieldText('  a  '), 'a');
  assert.equal(extractBitableFieldText(12), '12');
  assert.equal(extractBitableFieldText([{ text: 'x' }, { text_arr: ['y', 'z'] }]), 'x，y，z');
  assert.equal(extractBitableFieldText({ text: 'obj' }), 'obj');
  assert.equal(extractBitableFieldText(null), '');
});

test('extractDissatisfactionDishFromFields priority order', () => {
  assert.equal(
    extractDissatisfactionDishFromFields({ '今天 不满意菜品': '红烧肉', 不满意菜品: '忽略' }),
    '红烧肉',
  );
  assert.equal(extractDissatisfactionDishFromFields({ 不满意菜品: '白切鸡' }), '白切鸡');
  assert.equal(extractDissatisfactionDishFromFields({}), '');
});

test('extractDissatisfactionReasonFromFields picks first non-empty', () => {
  assert.equal(
    extractDissatisfactionReasonFromFields({ 不满意原因: '偏咸', 备注: 'x' }),
    '偏咸',
  );
  assert.equal(extractDissatisfactionReasonFromFields({ 备注: '仅备注' }), '仅备注');
});

test('extractTableVisitItems splits dishes and filters 卤鹅', () => {
  assert.deepEqual(
    extractTableVisitItems({ dissatisfaction_dish: '红烧肉，卤鹅、白切鸡', unsatisfied_items: '太咸' }),
    ['红烧肉', '白切鸡'],
  );
  assert.deepEqual(extractTableVisitItems({ dissatisfaction_dish: '' }), []);
});
