/**
 * domains/points/helpers.js 纯函数 + 依赖注入路径单测
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindPointsRuntimeDeps,
  normalizePointsAdminRecordStatus,
  mapApprovalRowToPointsAdminItem,
  canApplyPointsByRole,
  GLOBAL_SOCIAL_POINT_RULE_ID,
  isTripleSocialMediaPointRuleItem,
  dedupePointRulesApiItems,
  dedupeGlobalSocialMediaPointRules,
  ensureGlobalSocialMediaPointRule,
  canonicalizeStoreKeyForPoints,
} from '../helpers.js';

test('normalizePointsAdminRecordStatus：pending/applied/默认 approved', () => {
  assert.equal(normalizePointsAdminRecordStatus('pending'), 'pending');
  assert.equal(normalizePointsAdminRecordStatus('未审批'), 'pending');
  assert.equal(normalizePointsAdminRecordStatus('applied'), 'applied');
  assert.equal(normalizePointsAdminRecordStatus('已申请'), 'applied');
  assert.equal(normalizePointsAdminRecordStatus('submitted'), 'applied');
  assert.equal(normalizePointsAdminRecordStatus('approved'), 'approved');
  assert.equal(normalizePointsAdminRecordStatus(''), 'approved');
});

test('canApplyPointsByRole：仅一线员工类可申请', () => {
  assert.equal(canApplyPointsByRole('store_employee'), true);
  assert.equal(canApplyPointsByRole('front_manager'), true);
  assert.equal(canApplyPointsByRole('front_supervisor'), true);
  assert.equal(canApplyPointsByRole('employee'), true);
  assert.equal(canApplyPointsByRole('hq_manager'), false);
  assert.equal(canApplyPointsByRole('admin'), false);
  assert.equal(canApplyPointsByRole(''), false);
  assert.equal(canApplyPointsByRole(null), false);
});

test('mapApprovalRowToPointsAdminItem：聚合积分与中文状态', () => {
  const pending = mapApprovalRowToPointsAdminItem({
    id: 'a1',
    status: 'pending',
    applicant_username: 'u1',
    created_at: '2026-07-01T00:00:00Z',
    payload: { applicantName: '张三', store: '测试店', totalPoints: 8, reason: '社媒' },
  });
  assert.equal(pending.points, 8);
  assert.equal(pending.amount, 4);
  assert.equal(pending.recordStatusZh, '未审批');
  assert.equal(pending.approvedAt, '');
  assert.equal(pending.name, '张三');

  const fromItems = mapApprovalRowToPointsAdminItem({
    id: 'a2',
    status: 'approved',
    applicant_username: 'u2',
    executed_at: '2026-07-02T12:00:00Z',
    payload: { items: [{ points: 3 }, { points: 2 }] },
  });
  assert.equal(fromItems.points, 5);
  assert.equal(fromItems.recordStatusZh, '已审批');
  assert.equal(fromItems.approvedAt, '2026-07-02T12:00:00Z');
  assert.equal(fromItems.name, 'u2');

  const rejected = mapApprovalRowToPointsAdminItem({
    id: 'a3',
    status: 'rejected',
    payload: { points: 1 },
  });
  assert.equal(rejected.recordStatusZh, '已驳回');

  const returned = mapApprovalRowToPointsAdminItem({
    id: 'a4',
    status: 'returned',
    payload: {},
  });
  assert.equal(returned.recordStatusZh, '已退回');
  assert.equal(returned.itemName, '积分申请');
});

test('社媒规则识别与 API 去重', () => {
  const social = {
    id: 'dup',
    itemName: '抖音/小红书/大众点评各发布一条',
  };
  const socialCanon = {
    id: GLOBAL_SOCIAL_POINT_RULE_ID,
    itemName: '抖音小红书大众点评宣传',
  };
  const other = { id: 'x', itemName: '迟到扣分' };
  assert.equal(isTripleSocialMediaPointRuleItem(social), true);
  assert.equal(isTripleSocialMediaPointRuleItem(other), false);

  const out = dedupePointRulesApiItems([social, socialCanon, other, social]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, GLOBAL_SOCIAL_POINT_RULE_ID);
  assert.equal(out[1].id, 'x');

  assert.deepEqual(dedupePointRulesApiItems([other]), [other]);
  assert.deepEqual(dedupePointRulesApiItems(null), []);
});

test('canonicalizeStoreKeyForPoints：马已仙→马己仙并去空格小写', () => {
  assert.equal(canonicalizeStoreKeyForPoints('马已仙 上海音乐广场店'), '马己仙上海音乐广场店');
  assert.equal(canonicalizeStoreKeyForPoints('  Hong Chao  '), 'hongchao');
  assert.equal(canonicalizeStoreKeyForPoints(''), '');
});

test('dedupeGlobalSocialMediaPointRules：多条社媒规则合并为 canonical', async () => {
  let saved = null;
  bindPointsRuntimeDeps({
    getSharedState: async () => ({
      pointRules: [
        { id: 'old1', itemName: '抖音/小红书/大众点评 A', points: 5 },
        { id: GLOBAL_SOCIAL_POINT_RULE_ID, itemName: '抖音/小红书/大众点评 B', points: 9 },
        { id: 'other', itemName: '全勤', points: 1 },
      ],
    }),
    saveSharedState: async (s) => {
      saved = s;
    },
    mergeSharedStateFields: async () => {},
    hrmsNowISO: () => '2026-07-26T00:00:00.000Z',
  });
  await dedupeGlobalSocialMediaPointRules();
  assert.ok(saved);
  assert.equal(saved.pointRules.length, 2);
  assert.equal(saved.pointRules[0].id, GLOBAL_SOCIAL_POINT_RULE_ID);
  assert.equal(saved.pointRules[0].points, 10);
  assert.equal(saved.pointRules[1].id, 'other');
});

test('dedupeGlobalSocialMediaPointRules：≤1 条时不写 state', async () => {
  let saved = false;
  bindPointsRuntimeDeps({
    getSharedState: async () => ({
      pointRules: [{ id: 'one', itemName: '抖音/小红书/大众点评', points: 10 }],
    }),
    saveSharedState: async () => {
      saved = true;
    },
    mergeSharedStateFields: async () => {},
    hrmsNowISO: () => 't',
  });
  await dedupeGlobalSocialMediaPointRules();
  assert.equal(saved, false);
});

test('ensureGlobalSocialMediaPointRule：merge 写入 canonical', async () => {
  let merged = null;
  bindPointsRuntimeDeps({
    getSharedState: async () => ({}),
    saveSharedState: async () => {},
    mergeSharedStateFields: async (patch, opts) => {
      merged = { patch, opts };
    },
    hrmsNowISO: () => '2026-07-26T01:00:00.000Z',
  });
  await ensureGlobalSocialMediaPointRule();
  assert.equal(merged.patch.pointRules[0].id, GLOBAL_SOCIAL_POINT_RULE_ID);
  assert.equal(merged.opts.pointRules, 'id');
});
