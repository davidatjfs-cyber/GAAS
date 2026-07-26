import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFetchStoreRatingForProfileDisplay,
  shanghaiCalendarYm,
  shanghaiPrevCalendarYm,
} from '../fetch-store-rating-for-profile.js';

test('shanghai ym helpers', () => {
  const now = () => Date.parse('2026-07-15T12:00:00+08:00');
  assert.equal(shanghaiCalendarYm(now), '2026-07');
  assert.equal(shanghaiPrevCalendarYm(now), '2026-06');
  const jan = () => Date.parse('2026-01-05T12:00:00+08:00');
  assert.equal(shanghaiPrevCalendarYm(jan), '2025-12');
});

/** canon === raw → 单 key；查询序号见各用例注释 */
function makeFetcher(rowsByCall, overrides = {}) {
  const calls = [];
  const fetch = createFetchStoreRatingForProfileDisplay({
    pool: () => ({
      query: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        const rows = rowsByCall[calls.length - 1] || [];
        return { rows };
      },
    }),
    resolveAgentCanonicalStore: (s) => s,
    dailyReportIlikePatterns: (s) => [`%${s}%`],
    feishuStoreSearchPatterns: (s) => [`%${s}%`],
    nowFn: () => Date.parse('2026-07-15T12:00:00+08:00'),
    ...overrides,
  });
  return { fetch, calls };
}

test('empty store', async () => {
  const { fetch } = makeFetcher([]);
  assert.deepEqual(await fetch(''), { rating: null, period: null });
});

test('exact key hit on wantYm', async () => {
  const { fetch, calls } = makeFetcher([[{ rating: 'A', period: '2026-06' }]]);
  const r = await fetch('洪潮久光店');
  assert.equal(r.rating, 'A');
  assert.match(calls[0].sql, /store = \$1 AND period = \$2/);
});

test('ILIKE period hit after exact miss', async () => {
  // 0 exact want, 1 ILIKE want
  const { fetch } = makeFetcher([[], [{ rating: 'B', period: '2026-06' }]]);
  const r = await fetch('洪潮久光店');
  assert.equal(r.rating, 'B');
  assert.equal(r.isFallback, false);
});

test('strictPeriod exact <= fallback', async () => {
  // 0 exact want, 1 ILIKE want, 2 exact <=
  const { fetch } = makeFetcher([
    [],
    [],
    [{ rating: 'C', period: '2026-05' }],
  ]);
  const r = await fetch('洪潮久光店', '2026-06');
  assert.equal(r.rating, 'C');
  assert.equal(r.isFallback, true);
  assert.equal(r.requestedPeriod, '2026-06');
});

test('strictPeriod ILIKE <= fallback', async () => {
  // 0-1 want miss, 2 exact <= miss, 3 ILIKE <=
  const { fetch } = makeFetcher([
    [],
    [],
    [],
    [{ rating: 'D', period: '2026-04' }],
  ]);
  const r = await fetch('洪潮久光店', '2026-06');
  assert.equal(r.rating, 'D');
  assert.equal(r.isFallback, true);
});

test('strictPeriod miss', async () => {
  const { fetch } = makeFetcher([[], [], [], []]);
  const r = await fetch('洪潮久光店', '2026-06');
  assert.deepEqual(r, {
    rating: null,
    period: '2026-06',
    requestedPeriod: '2026-06',
    isFallback: false,
  });
});

test('non-strict exact period < curYm', async () => {
  // 0 exact want, 1 ILIKE want, 2 exact < curYm
  const { fetch } = makeFetcher([
    [],
    [],
    [{ rating: 'E', period: '2026-05' }],
  ]);
  assert.equal((await fetch('洪潮久光店')).rating, 'E');
});

test('non-strict ILIKE < curYm', async () => {
  // 0-2 miss, 3 ILIKE < curYm
  const { fetch } = makeFetcher([[], [], [], [{ rating: 'F', period: '2026-03' }]]);
  assert.equal((await fetch('洪潮久光店')).rating, 'F');
});

test('non-strict exact any latest', async () => {
  // 0-3 miss, 4 exact any
  const { fetch } = makeFetcher([
    [],
    [],
    [],
    [],
    [{ rating: 'G', period: '2025-12' }],
  ]);
  assert.equal((await fetch('洪潮久光店')).rating, 'G');
});

test('final ILIKE any with isFallback', async () => {
  // 0-4 miss, 5 final ILIKE
  const { fetch } = makeFetcher([
    [],
    [],
    [],
    [],
    [],
    [{ rating: 'H', period: '2025-01' }],
  ]);
  const r = await fetch('洪潮久光店');
  assert.equal(r.rating, 'H');
  assert.equal(r.isFallback, true);
  assert.equal(r.requestedPeriod, '2026-06');
});

test('final miss → null', async () => {
  const { fetch } = makeFetcher([[], [], [], [], [], []]);
  const r = await fetch('洪潮久光店');
  assert.equal(r.rating, null);
  assert.equal(r.period, null);
});

test('dual keys when canon differs', async () => {
  const { fetch, calls } = makeFetcher(
    [
      [], // canon exact
      [{ rating: 'I', period: '2026-06' }], // raw exact
    ],
    { resolveAgentCanonicalStore: (s) => (s === '久光' ? '洪潮久光店' : s) }
  );
  const r = await fetch('久光');
  assert.equal(r.rating, 'I');
  assert.equal(calls.length, 2);
});
