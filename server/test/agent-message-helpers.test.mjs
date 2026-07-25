/**
 * agent-message helpers 纯逻辑单测。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isShortOptionReply,
  resolveStoreFromKnownList,
  resolveStoreFromCanonicalMap,
  brandPrefixFromText,
  buildOpsChecklistResponse,
  isTrainingApprovalText,
  isTrainingExamStartText,
  isTrainingExamAnswerText,
  evaluateTrainingExamAnswer,
  formatActiveTaskContext,
} from '../domains/agent-message/helpers.js';
import { tryHandleTrainingFlows } from '../domains/agent-message/training-flow.js';

test('isShortOptionReply', () => {
  assert.equal(isShortOptionReply('2'), true);
  assert.equal(isShortOptionReply('三'), true);
  assert.equal(isShortOptionReply('你好'), false);
});

test('resolveStoreFromKnownList exact + prefix', () => {
  const known = ['洪潮大宁久光店', '马己仙静安店'];
  assert.equal(resolveStoreFromKnownList('看看洪潮大宁久光店营收', known, '总部'), '洪潮大宁久光店');
  assert.equal(resolveStoreFromKnownList('洪潮怎么样', known, '总部'), '洪潮大宁久光店');
  assert.equal(resolveStoreFromKnownList('随便', known, '已绑店'), '已绑店');
});

test('resolveStoreFromCanonicalMap overrides different brand', () => {
  const map = [
    { keywords: ['洪潮'], canonical: '洪潮大宁久光店' },
    { keywords: ['马己仙'], canonical: '马己仙静安店' },
  ];
  const r = resolveStoreFromCanonicalMap({
    text: '马己仙毛利',
    boundStore: '洪潮大宁久光店',
    storeCanonicalMap: map,
    inferBrandFromStoreName: (s) => (String(s).includes('马') ? '马己仙' : '洪潮'),
  });
  assert.equal(r.resolvedStore, '马己仙静安店');
  assert.equal(r.overridden, true);
});

test('brandPrefixFromText / checklist / training gates', () => {
  assert.equal(brandPrefixFromText('洪潮营收'), '洪潮');
  assert.equal(brandPrefixFromText('马己仙'), '马己仙');
  assert.ok(buildOpsChecklistResponse({ text: '开市检查', brand: '洪潮', store: 'A' }).includes('开市检查表'));
  assert.ok(buildOpsChecklistResponse({ text: '巡检', brand: 'x', store: 'S' }).includes('营运巡检'));
  assert.equal(buildOpsChecklistResponse({ text: '你好', brand: '洪潮', store: 'A' }), '');
  assert.equal(isTrainingApprovalText('审核通过并下发', 'admin'), true);
  assert.equal(isTrainingExamStartText('开始考核'), true);
  assert.equal(isTrainingExamAnswerText('1. a\n2. b', 'train_advisor'), true);
  assert.equal(evaluateTrainingExamAnswer('短'), false);
  assert.equal(evaluateTrainingExamAnswer('这是一段超过二十个字符的培训答卷内容啊啊！'), true);
});

test('formatActiveTaskContext', () => {
  const ctx = formatActiveTaskContext([
    { priority: 'high', title: 'T1', status: 'pending', category: 'ops', detail: 'd'.repeat(200) },
  ]);
  assert.ok(ctx.includes('活跃任务'));
  assert.ok(ctx.includes('T1'));
  assert.ok(ctx.includes('详情'));
});

test('tryHandleTrainingFlows: approval path', async () => {
  const queries = [];
  const pool = {
    async query(sql, _params) {
      queries.push(String(sql).slice(0, 40));
      if (String(sql).includes('pending_approval')) {
        return {
          rows: [{ id: 1, title: 'SOP课', assignee_username: 'bob' }],
        };
      }
      return { rows: [] };
    },
  };
  const r = await tryHandleTrainingFlows(pool, {
    text: '审核通过，请下发',
    senderRole: 'admin',
    senderUsername: 'admin1',
    route: 'general',
  });
  assert.equal(r.handled, true);
  assert.ok(r.response.includes('SOP课'));
  assert.ok(queries.some((q) => q.includes('UPDATE')));
});
