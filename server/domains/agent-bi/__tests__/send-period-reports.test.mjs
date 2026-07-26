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

function baseDeps(overrides = {}) {
  return {
    agentPool: { query: async () => ({ rows: [{ store: '洪潮静安店' }] }) },
    pool: () => ({ query: async () => ({ rows: [{ username: 'mgr1' }] }) }),
    reportStoresSeed: [],
    getSharedState: async () => ({
      employees: [
        { username: 'admin1', role: 'admin' },
        { username: 'ghost', role: 'admin' },
        { username: 'hq1', role: 'hq_manager' },
      ],
    }),
    lookupFeishuUserByUsername: async (u) => (
      u === 'ghost' ? null : { open_id: `ou_${u}` }
    ),
    sendLarkCard: async () => ({ ok: true }),
    sendLarkMessage: async () => ({ ok: true }),
    prefixWithAgentName: (_a, t) => `prefix:${t}`,
    generateWeeklyReport: async (store) => ({ store, kind: 'weekly' }),
    generateMonthlyReport: async (store) => ({ store, kind: 'monthly' }),
    formatReportMarkdown: (r) => `## ${r.store}\n${r.kind}`,
    calendarLastCompletedWeekMonSunShanghai: () => ({ wsS: '2026-07-13', weS: '2026-07-19' }),
    calendarPreviousMonthRangeShanghai: () => ({ msS: '2026-06-01', meS: '2026-06-30' }),
    resolveAgentCanonicalStore: (s) => s,
    dailyReportIlikePatterns: (s) => [`%${s}%`],
    log: { info() {}, error() {} },
    ...overrides,
  };
}

test('sendWeeklyReports delivers to admins; skips unbound users', async () => {
  const sent = [];
  const api = createSendPeriodReportsApi(baseDeps({
    sendLarkCard: async (openId, card) => {
      sent.push({ openId, title: card.header.title.content });
      return { ok: true };
    },
  }));

  await api.sendWeeklyReports('default');
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((s) => s.openId).sort(), ['ou_admin1', 'ou_hq1']);
  assert.match(sent[0].title, /洪潮静安店 周报/);
});

test('sendMonthlyReports includes store managers and uses turquoise template', async () => {
  const sent = [];
  const api = createSendPeriodReportsApi(baseDeps({
    sendLarkCard: async (openId, card) => {
      sent.push({ openId, template: card.header.template, title: card.header.title.content });
      return { ok: true };
    },
  }));

  await api.sendMonthlyReports('default');
  assert.ok(sent.some((s) => s.openId === 'ou_mgr1'));
  assert.ok(sent.every((s) => s.template === 'turquoise'));
  assert.match(sent[0].title, /月报/);
});

test('sendBiReportToAdmins falls back to text when card send fails', async () => {
  const texts = [];
  const api = createSendPeriodReportsApi(baseDeps({
    sendLarkCard: async () => ({ ok: false }),
    sendLarkMessage: async (openId, text) => {
      texts.push({ openId, text });
      return { ok: true };
    },
  }));

  await api.sendBiReportToAdmins({
    admins: [{ username: 'admin1' }],
    title: 't',
    note: 'n',
    md: 'hello body',
  });
  assert.equal(texts.length, 1);
  assert.equal(texts[0].openId, 'ou_admin1');
  assert.match(texts[0].text, /^prefix:hello body/);
});

test('sendWeeklyReports continues when one store generation throws', async () => {
  const sent = [];
  const api = createSendPeriodReportsApi(baseDeps({
    agentPool: {
      query: async () => ({ rows: [{ store: '坏店' }, { store: '好店' }] }),
    },
    generateWeeklyReport: async (store) => {
      if (store === '坏店') throw new Error('boom');
      return { store, kind: 'weekly' };
    },
    sendLarkCard: async (_openId, card) => {
      sent.push(card.header.title.content);
      return { ok: true };
    },
  }));
  await api.sendWeeklyReports();
  assert.ok(sent.some((t) => t.includes('好店')));
  assert.ok(!sent.some((t) => t.includes('坏店')));
});

test('sendTestReportsToUser fails when user unbound', async () => {
  const api = createSendPeriodReportsApi(baseDeps({
    lookupFeishuUserByUsername: async () => null,
  }));
  const r = await api.sendTestReportsToUser('nobody');
  assert.equal(r.ok, false);
  assert.equal(r.error, 'user_not_found_or_not_bound');
});

test('sendTestReportsToUser sends weekly+monthly and records per-store results', async () => {
  const titles = [];
  const api = createSendPeriodReportsApi(baseDeps({
    sendLarkCard: async (_id, card) => {
      titles.push(card.header.title.content);
      return { ok: true };
    },
    generateWeeklyReport: async (store) => {
      if (store === '洪潮静安店') return { store, kind: 'weekly' };
      throw new Error('wfail');
    },
  }));
  const r = await api.sendTestReportsToUser('admin1');
  assert.equal(r.ok, true);
  assert.equal(r.targetUsername, 'admin1');
  assert.ok(r.results.some((x) => x.type === 'weekly' && x.ok));
  assert.ok(r.results.some((x) => x.type === 'monthly' && x.ok));
  assert.ok(titles.some((t) => t.includes('周报')));
  assert.ok(titles.some((t) => t.includes('月报')));
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
