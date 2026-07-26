import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  cleanPhone,
  num,
  uniqueClean,
  sqlLikePattern,
  storeKeywordsFromName,
  posStoreFilterSql,
} from '../ops-helpers.js';

test('cleanText / cleanPhone / num basics', () => {
  assert.equal(cleanText('  ab  ', 2), 'ab');
  assert.equal(cleanPhone('+86 138-0000-0000'), '13800000000');
  assert.equal(num('12.5'), 12.5);
  assert.equal(num('x'), 0);
});

test('uniqueClean / sqlLikePattern / storeKeywordsFromName', () => {
  assert.deepEqual(uniqueClean(['a', ' a ', 'b', '']), ['a', 'b']);
  assert.equal(sqlLikePattern('洪潮'), '%洪潮%');
  assert.ok(Array.isArray(storeKeywordsFromName('年年有喜·洪潮店')));
});

test('posStoreFilterSql uses placeholders', () => {
  const sql = posStoreFilterSql('o');
  assert.match(sql, /\$3/);
  assert.match(sql, /o\./);
});
