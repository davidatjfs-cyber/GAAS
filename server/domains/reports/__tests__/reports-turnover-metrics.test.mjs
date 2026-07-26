/**
 * turnover-metrics.js — computeTurnoverReportPayload 纯逻辑直测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeTurnoverReportPayload } from '../turnover-metrics.js';
import { bindReportsRuntimeDeps } from '../helpers.js';

bindReportsRuntimeDeps({
  pool: {},
  safeMonthOnly: (m) => (/^\d{4}-\d{2}$/.test(String(m || '')) ? String(m) : ''),
  resolveAgentCanonicalStore: (s) => String(s || '').trim().replace(/大宁/g, ''),
  getSharedState: async () => ({}),
});

const MONTH = '2026-07';

function baseEmployees() {
  return [
    {
      username: 'alice',
      name: '爱丽丝',
      store: '洪潮大宁久光店',
      status: 'active',
      joinDate: '2025-01-01',
      level: '2',
    },
    {
      username: 'bob',
      name: '鲍勃',
      store: '洪潮大宁久光店',
      status: '离职',
      joinDate: '2024-06-01',
      offboardingDate: '2026-07-10',
      coreTalent: true,
      level: '3',
    },
    {
      username: 'carol',
      name: '卡罗尔',
      store: '洪潮大宁久光店',
      status: 'active',
      joinDate: '2026-06-01',
    },
    {
      username: 'dave',
      name: '戴夫',
      store: '洪潮大宁久光店',
      status: '离职',
      joinDate: '2026-06-15',
      offboardingDate: '2026-07-20',
    },
    {
      username: 'eve',
      name: '伊芙',
      store: '马己仙静安店',
      status: 'active',
      joinDate: '2025-03-01',
    },
  ];
}

test('computeTurnoverReportPayload: 空员工 → 零值结构', () => {
  const payload = computeTurnoverReportPayload({
    month: MONTH,
    store: '',
    storeEmps: [],
    empByLower: new Map(),
    offDeparted: new Map(),
    yr: 2026,
    mo: 7,
  });

  assert.equal(payload.month, MONTH);
  assert.equal(payload.totalHeadcount, 0);
  assert.equal(payload.totalDeparted, 0);
  assert.equal(payload.overallTurnoverRate, 0);
  assert.deepEqual(payload.criticalTalent, { total: 0, departed: 0, rate: 0 });
  assert.deepEqual(payload.newHire, {
    total: 0,
    departed: 0,
    turnoverRate: 0,
    retentionRate: 1,
  });
  assert.deepEqual(payload.voluntaryInvoluntary, {
    voluntary: 0,
    involuntary: 0,
    voluntaryRate: 0,
    involuntaryRate: 0,
  });
  assert.deepEqual(payload.departedDetails, []);
  assert.deepEqual(payload.storeBreakdown, []);
});

test('computeTurnoverReportPayload: 离职率 / 关键人才 / 新员工', () => {
  const storeEmps = baseEmployees().filter((e) => e.store.includes('洪潮'));
  const empByLower = new Map(storeEmps.map((e) => [e.username.toLowerCase(), e]));
  const offDeparted = new Map([
    ['bob', { resignDate: '2026-07-10', reason: '个人原因', isVoluntary: true }],
    ['dave', { resignDate: '2026-07-20', reason: '劝退', isVoluntary: false }],
  ]);

  const payload = computeTurnoverReportPayload({
    month: MONTH,
    store: '洪潮久光店',
    storeEmps,
    empByLower,
    offDeparted,
    yr: 2026,
    mo: 7,
  });

  assert.equal(payload.totalHeadcount, 4);
  assert.equal(payload.totalDeparted, 2);
  assert.equal(payload.overallTurnoverRate, 0.5);

  assert.equal(payload.criticalTalent.total, 1);
  assert.equal(payload.criticalTalent.departed, 1);
  assert.equal(payload.criticalTalent.rate, 1);

  assert.equal(payload.newHire.total, 2);
  assert.equal(payload.newHire.departed, 1);
  assert.equal(payload.newHire.turnoverRate, 0.5);
  assert.equal(payload.newHire.retentionRate, 0.5);

  assert.equal(payload.voluntaryInvoluntary.voluntary, 1);
  assert.equal(payload.voluntaryInvoluntary.involuntary, 1);
  assert.equal(payload.voluntaryInvoluntary.voluntaryRate, 0.5);
  assert.equal(payload.voluntaryInvoluntary.involuntaryRate, 0.5);
});

test('computeTurnoverReportPayload: departedDetails 与 storeBreakdown', () => {
  const storeEmps = baseEmployees();
  const empByLower = new Map(storeEmps.map((e) => [e.username.toLowerCase(), e]));
  const offDeparted = new Map([
    ['bob', { resignDate: '2026-07-10', reason: '个人原因', isVoluntary: true }],
    ['dave', { resignDate: '2026-07-20', reason: '劝退', isVoluntary: false }],
  ]);

  const payload = computeTurnoverReportPayload({
    month: MONTH,
    store: '',
    storeEmps,
    empByLower,
    offDeparted,
    yr: 2026,
    mo: 7,
  });

  assert.equal(payload.departedDetails.length, 2);
  const bobDetail = payload.departedDetails.find((d) => d.username === 'bob');
  assert.ok(bobDetail);
  assert.equal(bobDetail.departureType, 'voluntary');
  assert.equal(bobDetail.isCoreTalent, true);
  assert.equal(bobDetail.isNewHire, false);

  const daveDetail = payload.departedDetails.find((d) => d.username === 'dave');
  assert.ok(daveDetail);
  assert.equal(daveDetail.departureType, 'involuntary');
  assert.equal(daveDetail.isNewHire, true);

  assert.ok(payload.storeBreakdown.length >= 2);
  const hcStore = payload.storeBreakdown.find((s) => s.store.includes('洪潮'));
  assert.ok(hcStore);
  assert.equal(hcStore.headcount, 4);
  assert.equal(hcStore.departed, 2);
  assert.equal(hcStore.turnoverRate, 0.5);
});

test('computeTurnoverReportPayload: 无 offboarding 记录时 voluntary 回落为 totalDeparted', () => {
  const storeEmps = [
    {
      username: 'solo',
      name: '单人',
      store: '测试店',
      status: '离职',
      offboardingDate: '2026-07-05',
      joinDate: '2024-01-01',
    },
  ];
  const empByLower = new Map([['solo', storeEmps[0]]]);

  const payload = computeTurnoverReportPayload({
    month: MONTH,
    store: '',
    storeEmps,
    empByLower,
    offDeparted: new Map(),
    yr: 2026,
    mo: 7,
  });

  assert.equal(payload.totalDeparted, 1);
  assert.equal(payload.voluntaryInvoluntary.voluntary, 1);
  assert.equal(payload.voluntaryInvoluntary.involuntary, 0);
  assert.equal(payload.voluntaryInvoluntary.voluntaryRate, 1);
});

test('computeTurnoverReportPayload: store 筛选过滤 departedDetails', () => {
  const storeEmps = baseEmployees();
  const empByLower = new Map(storeEmps.map((e) => [e.username.toLowerCase(), e]));
  const offDeparted = new Map([
    ['bob', { resignDate: '2026-07-10', reason: '个人原因', isVoluntary: true }],
    ['dave', { resignDate: '2026-07-20', reason: '劝退', isVoluntary: false }],
  ]);

  const payload = computeTurnoverReportPayload({
    month: MONTH,
    store: '马己仙静安店',
    storeEmps: storeEmps.filter((e) => e.store === '马己仙静安店'),
    empByLower,
    offDeparted,
    yr: 2026,
    mo: 7,
  });

  assert.equal(payload.departedDetails.length, 0);
  assert.equal(payload.totalHeadcount, 1);
  assert.equal(payload.totalDeparted, 0);
});
