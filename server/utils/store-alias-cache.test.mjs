import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCanonicalStoreNameSync,
  resolveCanonicalStoreNameFuzzySync,
  resolveAliasBySourceSync,
  getAllCanonicalToSourceMapSync,
  getStoreAliasSetSync,
} from './store-alias-cache.js';

// 这些测试故意不调用 initStoreAliasCache()，只验证 pool 还没就绪时的兜底行为——
// 与此前硬编码 STORE_NAME_ALIASES 的行为保持一致，是重构的核心正确性保证。

test('resolveCanonicalStoreNameSync: known aliases resolve to the canonical name (bootstrap fallback)', () => {
  assert.equal(resolveCanonicalStoreNameSync('洪潮久光店'), '洪潮大宁久光店');
  assert.equal(resolveCanonicalStoreNameSync('洪潮'), '洪潮大宁久光店');
  assert.equal(resolveCanonicalStoreNameSync('64822111'), '洪潮大宁久光店');
  assert.equal(resolveCanonicalStoreNameSync('马己仙大宁店'), '马己仙上海音乐广场店');
  assert.equal(resolveCanonicalStoreNameSync('马己仙'), '马己仙上海音乐广场店');
  assert.equal(resolveCanonicalStoreNameSync('51866138'), '马己仙上海音乐广场店');
});

test('resolveCanonicalStoreNameSync: already-canonical names resolve to themselves', () => {
  assert.equal(resolveCanonicalStoreNameSync('洪潮大宁久光店'), '洪潮大宁久光店');
  assert.equal(resolveCanonicalStoreNameSync('马己仙上海音乐广场店'), '马己仙上海音乐广场店');
});

test('resolveCanonicalStoreNameSync: unknown name falls back to itself (matches pre-refactor hardcoded behavior)', () => {
  assert.equal(resolveCanonicalStoreNameSync('某个新租户的门店'), '某个新租户的门店');
});

test('resolveCanonicalStoreNameSync: handles empty/missing input without throwing', () => {
  assert.equal(resolveCanonicalStoreNameSync(''), '');
  assert.equal(resolveCanonicalStoreNameSync(undefined), '');
});

test('getStoreAliasSetSync: returns every known alias for a store, normalized (lowercase, no whitespace)', () => {
  const aliases = getStoreAliasSetSync('洪潮大宁久光店');
  assert.ok(aliases.includes('洪潮大宁久光店'));
  assert.ok(aliases.includes('洪潮久光店'));
  assert.ok(aliases.includes('洪潮'));
  assert.ok(aliases.includes('64822111'));
});

test('getStoreAliasSetSync: unknown store falls back to a single-item list of the normalized input', () => {
  assert.deepEqual(getStoreAliasSetSync('某新租户门店'), ['某新租户门店']);
});

test('resolveCanonicalStoreNameFuzzySync: matches a store keyword embedded inside a longer sentence', () => {
  assert.equal(resolveCanonicalStoreNameFuzzySync('我们大宁久光店最近怎么样'), '洪潮大宁久光店');
  assert.equal(resolveCanonicalStoreNameFuzzySync('音乐广场店的营收如何'), '马己仙上海音乐广场店');
});

test('resolveCanonicalStoreNameFuzzySync: falls back to the input unchanged when nothing matches', () => {
  assert.equal(resolveCanonicalStoreNameFuzzySync('随便聊聊天气'), '随便聊聊天气');
});

test('resolveAliasBySourceSync: returns the feishu-source alias for a canonical name', () => {
  assert.equal(resolveAliasBySourceSync('洪潮大宁久光店', 'feishu'), '洪潮久光店');
  assert.equal(resolveAliasBySourceSync('马己仙上海音乐广场店', 'feishu'), '马己仙大宁店');
});

test('getAllCanonicalToSourceMapSync: builds a canonical->feishu-alias map', () => {
  const map = getAllCanonicalToSourceMapSync('feishu');
  assert.equal(map['洪潮大宁久光店'], '洪潮久光店');
  assert.equal(map['马己仙上海音乐广场店'], '马己仙大宁店');
});
