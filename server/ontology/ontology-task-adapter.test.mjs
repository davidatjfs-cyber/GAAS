import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOntologyTaskInsert,
  createOntologyTaskFromDraft,
  reviewOntologyTaskHistory,
} from './ontology-task-adapter.js';

const draft = {
  title: '生成高价值客户维护名单',
  description: '老客维护不足：7天内带回高价值客户',
  ownerRole: '店长',
  priority: 'P1',
  dueDate: '2026-07-10T00:00:00.000Z',
  expectedResult: '7天内带回高价值客户，并追踪贡献营业额',
  trackingMetrics: ['回店人数', '贡献营业额'],
  sourceIssueId: 'customer_retention_weak',
  sourceDomain: 'customer_growth',
  status: 'draft',
};

test('buildOntologyTaskInsert preserves ontology source fields in source_data', () => {
  const task = buildOntologyTaskInsert(draft, { reportType: 'customer_assets', storeId: 'test_store' });
  assert.equal(task.title, draft.title);
  assert.equal(task.assigneeRole, '店长');
  assert.equal(task.sourceData.sourceIssueId, 'customer_retention_weak');
  assert.deepEqual(task.sourceData.trackingMetrics, ['回店人数', '贡献营业额']);
  assert.equal(task.sourceData.sourceReportType, 'customer_assets');
});

test('createOntologyTaskFromDraft writes a formal master task', async () => {
  const calls = [];
  const fakePool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ task_id: params[0], title: params[9], source_data: JSON.parse(params[11]) }] };
    },
  };
  const result = await createOntologyTaskFromDraft(fakePool, draft, { reportType: 'customer_assets', storeId: 'test_store', tenantId: 'default' });
  assert.equal(result.createdTask.source_data.sourceIssueId, 'customer_retention_weak');
  assert.equal(result.createdTask.source_data.sourceReportType, 'customer_assets');
  assert.ok(calls[0].sql.includes('INSERT INTO master_tasks'));
});

test('reviewOntologyTaskHistory returns insufficient_data when no completed metrics exist', async () => {
  const fakePool = {
    query: async () => ({ rows: [{ task_id: 'ONT-1', status: 'pending_dispatch', source_data: { sourceIssueId: 'x' } }] }),
  };
  const review = await reviewOntologyTaskHistory(fakePool, { storeId: 'test_store', reportType: 'customer_assets', sourceIssueId: 'x' });
  assert.equal(review.resultReviewStatus, 'insufficient_data');
  assert.equal(review.tasksCreated, 1);
});
