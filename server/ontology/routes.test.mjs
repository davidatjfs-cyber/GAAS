import test from 'node:test';
import assert from 'node:assert/strict';

import { registerOntologyRoutes } from './routes.js';

function fakeApp() {
  const routes = {};
  return {
    get(path, _authRequired, handler) {
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
