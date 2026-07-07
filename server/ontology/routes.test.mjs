import test from 'node:test';
import assert from 'node:assert/strict';

import { registerOntologyRoutes } from './routes.js';

function fakeApp() {
  const routes = {};
  return {
    get(path, _authRequired, handler) {
      routes[path] = handler;
    },
    post(path, _authRequired, handler) {
      routes[path] = handler;
    },
    routes,
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('GET /api/ontology/types lists registered object types', async () => {
  const app = fakeApp();
  registerOntologyRoutes(app, {}, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/types']({}, res);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.types.includes('store'));
});

test('GET /api/ontology/:type returns rows from the pool', async () => {
  const app = fakeApp();
  const fakePool = { query: async () => ({ rows: [{ name: '洪潮大宁久光店' }] }) };
  registerOntologyRoutes(app, fakePool, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/:type']({ params: { type: 'store' }, query: {} }, res);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.rows, [{ name: '洪潮大宁久光店' }]);
});

test('GET /api/ontology/:type returns 404 for an unregistered type', async () => {
  const app = fakeApp();
  registerOntologyRoutes(app, {}, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/:type']({ params: { type: 'nope' }, query: {} }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.ok, false);
});

test('GET /api/ontology/:type returns 500 on pool failure', async () => {
  const app = fakeApp();
  const fakePool = { query: async () => { throw new Error('db down'); } };
  registerOntologyRoutes(app, fakePool, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/:type']({ params: { type: 'store' }, query: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
});

test('GET /api/ontology/business/domains returns business domains', async () => {
  const app = fakeApp();
  registerOntologyRoutes(app, {}, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/business/domains']({}, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.domains.length, 4);
});

test('POST /api/ontology/business/infer returns insights, boss summary, and action plan', async () => {
  const app = fakeApp();
  registerOntologyRoutes(app, {}, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/business/infer']({
    body: { metricsInput: { repeat_purchase_rate: { current: 18, previous: 25, changeRate: -28 } } },
  }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.insights[0].issueId, 'customer_retention_weak');
  assert.ok(res.body.bossSummary);
  assert.ok(res.body.actionPlan.length > 0);
});

test('POST /api/ontology/business/task-drafts returns draft tasks', async () => {
  const app = fakeApp();
  registerOntologyRoutes(app, {}, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/business/task-drafts']({
    body: { metricsInput: { task_overdue_rate: { current: 22, previous: 11 } } },
  }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.taskDrafts[0].status, 'draft');
});

test('GET /api/ontology/metric-lint returns lint findings', async () => {
  const app = fakeApp();
  const fakePool = {
    query: async () => ({ rows: [
      { metric_id: 'a', name: '营业额', data_source: 'daily_reports', formula: 'sum(revenue)' },
      { metric_id: 'b', name: '营业额', data_source: 'pos_sales_detail', formula: 'sum(amount)' },
    ] }),
  };
  registerOntologyRoutes(app, fakePool, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/metric-lint']({}, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.findings[0].type, 'conflicting_definition');
});

test('POST /api/ontology/business/infer-marketing returns marketing insights', async () => {
  const app = fakeApp();
  registerOntologyRoutes(app, {}, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/business/infer-marketing']({
    body: {
      attributionSummary: {
        conversionRate: 0.08,
        previousConversionRate: 0.16,
        attributedRevenue: 800,
        previousAttributedRevenue: 1200,
      },
    },
  }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.marketingInsights[0].issueId, 'marketing_conversion_weak');
});

test('POST /api/ontology/business/create-task-from-draft writes ontology task metadata', async () => {
  const app = fakeApp();
  const fakePool = {
    query: async (_sql, params) => ({ rows: [{
      task_id: params[0],
      status: params[1],
      title: params[9],
      source_data: JSON.parse(params[11]),
    }] }),
  };
  registerOntologyRoutes(app, fakePool, (req, res, next) => next());
  const res = fakeRes();
  await app.routes['/api/ontology/business/create-task-from-draft']({
    body: {
      reportType: 'customer_assets',
      storeId: 'test_store',
      taskDraft: {
        title: '生成高价值客户维护名单',
        ownerRole: '店长',
        priority: 'P1',
        expectedResult: '带回高价值客户',
        trackingMetrics: ['回店人数'],
        sourceIssueId: 'customer_retention_weak',
        sourceDomain: 'customer_growth',
      },
    },
    user: { tenant_id: 'default' },
  }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.createdTask.source_data.sourceIssueId, 'customer_retention_weak');
  assert.equal(res.body.createdTask.source_data.sourceReportType, 'customer_assets');
});
