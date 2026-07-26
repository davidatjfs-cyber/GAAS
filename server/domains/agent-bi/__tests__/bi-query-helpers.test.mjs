import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBiFactSourceAuditBody,
  buildBiGroundingFactsBody,
  buildBiSourceAuditText,
  createBiQueryHelpersApi,
  isFactLikeQuestion,
  resolveBiRelevantSourceKeys,
  resolveDateRangeFromQuestion,
} from '../bi-query-helpers.js';

function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

test('resolveDateRangeFromQuestion covers today/yesterday/near-n', () => {
  const today = resolveDateRangeFromQuestion('今天营业额', 7, fmt);
  assert.equal(today.label, '今日');
  assert.equal(today.start, today.end);
  const near = resolveDateRangeFromQuestion('近3天差评', 7, fmt);
  assert.equal(near.label, '近3天');
  const def = resolveDateRangeFromQuestion('随便看看', 7, fmt);
  assert.equal(def.label, '近7天');
  const month = resolveDateRangeFromQuestion('2026年3月营业额', 7, fmt);
  assert.equal(month.label, '2026年3月');
  assert.equal(month.start, '2026-03-01');
  assert.equal(month.end, '2026-03-31');
});

test('isFactLikeQuestion / resolveBiRelevantSourceKeys / audit text', () => {
  assert.equal(isFactLikeQuestion(''), false);
  assert.equal(isFactLikeQuestion('洪潮店营业额多少'), true);
  assert.ok(resolveBiRelevantSourceKeys('桌访不满意菜').includes('table_visit_records'));
  assert.ok(resolveBiRelevantSourceKeys('差评情况').includes('bad_reviews'));
  assert.equal(buildBiSourceAuditText([]), '');
  assert.match(
    buildBiSourceAuditText([{ label: '日报', status: 'ok', count: 2, latest: '2026-01-01' }]),
    /可用/
  );
});

test('buildBiFactSourceAuditBody queries enabled sources', async () => {
  const rows = await buildBiFactSourceAuditBody(
    {
      pool: () => ({
        query: async () => ({ rows: [{ c: 3, latest: '2026-07-01' }] }),
      }),
      normalizeStoreLike: (s) => `%${s}%`,
      normalizeStoreKey: (s) => s,
      isBiSourceEnabled: (k) => k !== 'table_visit_bitable',
    },
    '洪潮店',
    '桌访不满意'
  );
  assert.ok(rows.some((r) => r.key === 'table_visit_records' && r.status === 'ok' && r.count === 3));
  assert.ok(rows.some((r) => r.key === 'table_visit_bitable' && r.status === 'disabled'));
});

test('buildBiGroundingFactsBody builds review + visit sections', async () => {
  const text = await buildBiGroundingFactsBody(
    {
      pool: () => ({
        query: async () => ({
          rows: [
            {
              created_at: new Date().toISOString(),
              agent_data: {
                store: '洪潮店',
                date: fmt(new Date()),
                product: '烤鱼',
                service_item: '上菜慢',
                content: '味道一般',
              },
            },
          ],
        }),
      }),
      toDateOnly: (v) => String(v || '').slice(0, 10),
      formatDate: fmt,
      extractBitableFieldText: (v) => String(v || '').trim(),
      normalizeBitableDateValue: (v) => String(v || '').slice(0, 10),
      isLikelySameStore: (a, b) => a === b,
      inDateRangeInclusive: () => true,
      loadUnifiedTableVisitRowsByStore: async () => [{ items: ['虾'] }],
      extractTableVisitItems: (row) => row.items || [],
    },
    '洪潮店',
    '差评和桌访怎么样'
  );
  assert.match(text, /差评数据/);
  assert.match(text, /桌访数据/);
  assert.match(text, /烤鱼/);
});

test('createBiQueryHelpersApi wires methods', async () => {
  const api = createBiQueryHelpersApi({
    formatDate: fmt,
    pool: () => ({ query: async () => ({ rows: [] }) }),
    normalizeStoreLike: (s) => s,
    normalizeStoreKey: (s) => s,
    isBiSourceEnabled: () => true,
    toDateOnly: (v) => String(v || '').slice(0, 10),
    extractBitableFieldText: (v) => String(v || ''),
    normalizeBitableDateValue: (v) => String(v || '').slice(0, 10),
    isLikelySameStore: () => true,
    inDateRangeInclusive: () => true,
    loadUnifiedTableVisitRowsByStore: async () => [],
    extractTableVisitItems: () => [],
  });
  assert.equal(api.resolveDateRangeFromQuestion('今天').label, '今日');
  assert.equal(await api.buildBiGroundingFacts('', '差评'), '');
});
