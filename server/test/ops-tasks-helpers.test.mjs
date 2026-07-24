import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpsTaskHelpers } from '../domains/ops-tasks/create-helpers.js';

let queryCalls = 0;
const helpers = createOpsTaskHelpers({
  pool: {
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
  },
  safeDateOnly: (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim().slice(0, 10) : null,
  getSharedState: async () => ({ stores: [{ name: '洪潮大宁久光店', brand: '洪潮传统潮汕菜' }] }),
  resolveTenantIdDefault: () => 'default',
  pickStoreRoleUsernameByStore: () => 'store_mgr_1',
  runForActiveTenants: async (fn) => { await fn('default'); },
  ensureOpsTasksTable: async () => {},
});

test('normalizeOpsRole aliases store_product_manager', () => {
  assert.equal(helpers.normalizeOpsRole('store_product_manager'), 'store_production_manager');
  assert.equal(helpers.normalizeOpsRole('store_manager'), 'store_manager');
  assert.equal(helpers.normalizeOpsRole('unknown_role'), 'unknown_role');
});

test('buildOpsFeedback on-time + enough photos + contentVerified → score 5 verified', () => {
  const dueAt = new Date('2026-07-24T11:00:00');
  const completedAt = new Date('2026-07-24T10:30:00');
  const out = helpers.buildOpsFeedback(
    { due_at: dueAt, required_photos: 3 },
    completedAt,
    3,
    { contentVerified: true }
  );
  assert.equal(out.score, 5);
  assert.equal(out.verificationStatus, 'verified');
});

test('buildOpsFeedback late + short photos + !contentVerified → reduced score unverified', () => {
  const dueAt = new Date('2026-07-24T11:00:00');
  const completedAt = new Date('2026-07-24T12:00:00');
  const out = helpers.buildOpsFeedback(
    { due_at: dueAt, required_photos: 3 },
    completedAt,
    1,
    { contentVerified: false }
  );
  assert.equal(out.score, 1);
  assert.equal(out.verificationStatus, 'unverified');
  assert.match(out.feedback, /照片不足/);
});

test('buildOpsTaskTemplates returns 6 items with dueAt Dates', () => {
  const items = helpers.buildOpsTaskTemplates('洪潮大宁久光店', '洪潮传统潮汕菜', '2026-07-24');
  assert.equal(items.length, 6);
  for (const t of items) {
    assert.ok(t.dueAt instanceof Date);
    assert.ok(Number.isFinite(t.dueAt.getTime()));
  }
});

test('opsDateOnly returns YYYY-MM-DD', () => {
  const d = helpers.opsDateOnly(new Date(2026, 6, 24, 15, 30, 0));
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(d, '2026-07-24');
});

test('createOpsTaskIfAbsent with empty dedupeKey does not call pool.query', async () => {
  queryCalls = 0;
  await helpers.createOpsTaskIfAbsent({ dedupeKey: '' });
  await helpers.createOpsTaskIfAbsent({});
  assert.equal(queryCalls, 0);
});

test('createOpsTaskIfAbsent with dedupeKey calls pool.query once', async () => {
  queryCalls = 0;
  await helpers.createOpsTaskIfAbsent({
    dedupeKey: '2026-07-24||洪潮大宁久光店||opening_lunch||store_mgr_1',
    bizDate: '2026-07-24',
    store: '洪潮大宁久光店',
    brand: '洪潮传统潮汕菜',
    taskType: 'opening_lunch',
    scheduleKey: 'opening_lunch',
    title: '午市开档检查（11:00前）',
    checklist: [],
    requiredPhotos: 3,
    assigneeUsername: 'store_mgr_1',
    assigneeRole: 'store_manager',
    dueAt: new Date('2026-07-24T11:00:00'),
  });
  assert.equal(queryCalls, 1);
});
