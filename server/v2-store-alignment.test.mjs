import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveAgentCanonicalStore,
  toFeishuStoreName,
  expandAgentStoreLabels,
  dailyReportIlikePatterns,
  feishuStoreSearchPatterns,
  dailyReportRowMatches,
  feishuTableRowMatches,
} from './v2-store-alignment.js';

// 这些测试锁定重构前STORE_TO_FEISHU硬编码字典的行为，确保收口进store_name_aliases表
// (migration 096)后没有回归。

test('resolveAgentCanonicalStore: fuzzy-matches store keywords embedded in free text', () => {
  assert.equal(resolveAgentCanonicalStore('洪潮门店今天怎么样'), '洪潮大宁久光店');
  assert.equal(resolveAgentCanonicalStore('大宁久光店的数据'), '洪潮大宁久光店');
  assert.equal(resolveAgentCanonicalStore('音乐广场店营收如何'), '马己仙上海音乐广场店');
});

test('toFeishuStoreName: canonical -> feishu short name', () => {
  assert.equal(toFeishuStoreName('洪潮大宁久光店'), '洪潮久光店');
  assert.equal(toFeishuStoreName('马己仙上海音乐广场店'), '马己仙大宁店');
});

test('expandAgentStoreLabels: returns every known label variant for a store', () => {
  const labels = expandAgentStoreLabels('洪潮');
  assert.ok(labels.includes('洪潮大宁久光店'));
  assert.ok(labels.includes('洪潮久光店'));
});

test('dailyReportIlikePatterns / feishuStoreSearchPatterns still generate usable ILIKE patterns', () => {
  const drPats = dailyReportIlikePatterns('洪潮大宁久光店');
  assert.ok(drPats.some((p) => p.includes('洪潮久光店')));

  const fsPats = feishuStoreSearchPatterns('洪潮大宁久光店');
  assert.ok(fsPats.some((p) => p.includes('洪潮')));
  assert.ok(fsPats.some((p) => p.includes('大宁久光')));
});

test('dailyReportRowMatches / feishuTableRowMatches: cross-source name variants still match', () => {
  assert.equal(dailyReportRowMatches('洪潮大宁久光店', '洪潮久光店'), true);
  assert.equal(feishuTableRowMatches('马己仙上海音乐广场店', '马己仙大宁店'), true);
});
