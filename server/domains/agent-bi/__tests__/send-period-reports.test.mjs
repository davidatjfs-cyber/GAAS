import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSendPeriodReportsApi,
  splitMarkdownForCard,
  uniqBiReportRecipients,
} from '../send-period-reports.js';
import {
  feishuStoreManagersForMonthlyReportBody,
  getReportStoresForBiReportsBody,
} from '../send-period-reports-helpers.js';

test('splitMarkdownForCard chunks long markdown at section boundaries', () => {
  assert.deepEqual(splitMarkdownForCard(''), ['']);
  assert.deepEqual(splitMarkdownForCard('short'), ['short']);
  const md = `## A\n${'x'.repeat(3000)}\n## B\n${'y'.repeat(3000)}`;
  const chunks = splitMarkdownForCard(md, 3600);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length <= 3600 || c.startsWith('##')));
});

test('uniqBiReportRecipients dedupes by username case-insensitively', () => {
  assert.deepEqual(
    uniqBiReportRecipients([
      { username: 'Alice' },
      { username: 'alice' },
      { username: 'Bob' },
      { username: '  ' },
    ]),
    [{ username: 'Alice' }, { username: 'Bob' }]
  );
});

test('getReportStoresForBiReportsBody merges seed + DB and falls back on error', async () => {
  const ok = await getReportStoresForBiReportsBody({
    agentPool: {
      query: async () => ({ rows: [{ store: '洪潮静安店' }, { store: ' 马己仙人民广场店 ' }] }),
    },
    reportStoresSeed: ['种子店'],
    log: { error() {} },
  }, 'default');
  assert.deepEqual(ok, ['种子店', '洪潮静安店', '马己仙人民广场店'].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')));

  const fallback = await getReportStoresForBiReportsBody({
    agentPool: { query: async () => { throw new Error('db down'); } },
    reportStoresSeed: ['种子店'],
    log: { error() {} },
  });
  assert.deepEqual(fallback, ['种子店']);
});

test('feishuStoreManagersForMonthlyReportBody maps store managers', async () => {
  const rows = await feishuStoreManagersForMonthlyReportBody({
    pool: () => ({
      query: async () => ({ rows: [{ username: 'mgr1' }, { username: 'MGR1' }, { username: 'mgr2' }] }),
    }),
    resolveAgentCanonicalStore: (s) => s,
    dailyReportIlikePatterns: (s) => [`%${s}%`],
    log: { error() {} },
  }, '洪潮静安店');
  assert.deepEqual(rows, [{ username: 'mgr1' }, { username: 'mgr2' }]);
});

test('sendWeeklyReports delivers to admins; skips unbound users', async () => {
  const sent = [];
  const api = createSendPeriodReportsApi({
    agentPool: { query: async () => ({ rows: [{ store: '洪潮静安店' }] }) },
    pool: () => ({ query: async () => ({ rows: [] }) }),
    reportStoresSeed: [],
    getSharedState: async () => ({
      employees: [
        { username: 'admin1', role: 'admin' },
        { username: 'ghost', role: 'admin' },
      ],
    }),
    lookupFeishuUserByUsername: async (u) => (u === 'admin1' ? { open_id: 'ou_1' } : null),
    sendLarkCard: async (openId, card) => {
      sent.push({ openId, title: card.header.title.content });
      return { ok: true };
    },
    sendLarkMessage: async () => ({ ok: true }),
    prefixWithAgentName: (_a, t) => t,
    generateWeeklyReport: async (store) => ({ store }),
    generateMonthlyReport: async () => ({}),
    formatReportMarkdown: (r) => `## ${r.store}\nbody`,
    calendarLastCompletedWeekMonSunShanghai: () => ({ wsS: '2026-07-13', weS: '2026-07-19' }),
    calendarPreviousMonthRangeShanghai: () => ({ msS: '2026-06-01', meS: '2026-06-30' }),
    resolveAgentCanonicalStore: (s) => s,
    dailyReportIlikePatterns: () => [],
    log: { info() {}, error() {} },
  });

  await api.sendWeeklyReports('default');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].openId, 'ou_1');
  assert.match(sent[0].title, /洪潮静安店 周报/);
});

test('sendTestReportsToUser fails when user unbound', async () => {
  const api = createSendPeriodReportsApi({
    agentPool: { query: async () => ({ rows: [] }) },
    pool: () => ({ query: async () => ({ rows: [] }) }),
    reportStoresSeed: [],
    getSharedState: async () => ({}),
    lookupFeishuUserByUsername: async () => null,
    sendLarkCard: async () => ({ ok: true }),
    sendLarkMessage: async () => ({ ok: true }),
    prefixWithAgentName: (_a, t) => t,
    generateWeeklyReport: async () => ({}),
    generateMonthlyReport: async () => ({}),
    formatReportMarkdown: () => 'md',
    calendarLastCompletedWeekMonSunShanghai: () => ({ wsS: 'a', weS: 'b' }),
    calendarPreviousMonthRangeShanghai: () => ({ msS: 'c', meS: 'd' }),
    resolveAgentCanonicalStore: (s) => s,
    dailyReportIlikePatterns: () => [],
    log: { info() {}, error() {} },
  });
  const r = await api.sendTestReportsToUser('nobody');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'user_not_found_or_not_bound');
});

test('startWeeklyReportScheduler remains a no-op', () => {
  const logs = [];
  const api = createSendPeriodReportsApi({
    agentPool: { query: async () => ({ rows: [] }) },
    pool: () => ({ query: async () => ({ rows: [] }) }),
    reportStoresSeed: [],
    getSharedState: async () => ({}),
    lookupFeishuUserByUsername: async () => null,
    sendLarkCard: async () => ({ ok: true }),
    sendLarkMessage: async () => ({ ok: true }),
    prefixWithAgentName: (_a, t) => t,
    generateWeeklyReport: async () => ({}),
    generateMonthlyReport: async () => ({}),
    formatReportMarkdown: () => '',
    calendarLastCompletedWeekMonSunShanghai: () => ({ wsS: '', weS: '' }),
    calendarPreviousMonthRangeShanghai: () => ({ msS: '', meS: '' }),
    resolveAgentCanonicalStore: (s) => s,
    dailyReportIlikePatterns: () => [],
    log: { info: (...a) => logs.push(a.join(' ')), error() {} },
  });
  api.startWeeklyReportScheduler();
  assert.match(logs.join('\n'), /DISABLED/);
});
