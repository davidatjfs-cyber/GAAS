/**
 * domains/growth-ab/ab-templates.js 直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AB_TEMPLATES, getAbTemplate } from '../domains/growth-ab/ab-templates.js';

test('AB_TEMPLATES：关键模板齐全且字段结构合法', () => {
  const keys = AB_TEMPLATES.map((t) => t.key);
  for (const k of ['sms', 'coupon', 'groupbuy', 'dianping', 'xiaohongshu', 'kol', 'custom']) {
    assert.ok(keys.includes(k), k);
  }
  for (const t of AB_TEMPLATES) {
    assert.ok(t.label);
    assert.ok(['bound', 'channel'].includes(t.scope));
    assert.ok(Array.isArray(t.fields));
    assert.ok(Array.isArray(t.extra));
    if (t.key !== 'custom') {
      assert.ok(t.primary?.key);
      assert.ok(Array.isArray(t.primary.num));
    } else {
      assert.equal(t.primary, null);
    }
  }
});

test('getAbTemplate：命中/清洗/未知', () => {
  assert.equal(getAbTemplate('sms')?.label, '短信召回');
  assert.equal(getAbTemplate('  sms  ')?.key, 'sms');
  assert.equal(getAbTemplate('nope'), null);
  assert.equal(getAbTemplate(''), null);
});
