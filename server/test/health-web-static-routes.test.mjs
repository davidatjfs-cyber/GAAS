/**
 * domains/health/web-static.js — registerWebStaticRoutes
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWebStaticRoutes, isWebStaticPathAllowed } from '../domains/health/web-static.js';

function mockApp() {
  const uses = [];
  const gets = new Map();
  return {
    use(fn) {
      uses.push(fn);
    },
    get(path, fn) {
      gets.set(path, fn);
    },
    _uses: uses,
    _gets: gets,
  };
}

function mockRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    body: null,
    setHeader(k, v) {
      headers[k] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    sendFile(p) {
      this.body = `file:${p}`;
      return this;
    },
  };
}

test('isWebStaticPathAllowed：白名单 / hashed / 拒绝', () => {
  assert.equal(isWebStaticPathAllowed('assets/x.png'), true);
  assert.equal(isWebStaticPathAllowed('app.deadbeef.js'), true);
  assert.equal(isWebStaticPathAllowed(''), true);
  assert.equal(isWebStaticPathAllowed('server/index.js'), false);
});

test('registerWebStaticRoutes：中间件放行/拒绝；/ 与 agent 入口', () => {
  const setHeaderCalls = [];
  const app = mockApp();
  const express = {
    static: (_dir, opts) => {
      const fakeRes = {
        setHeader: (...a) => setHeaderCalls.push(a),
      };
      opts.setHeaders(fakeRes, '/page.HTML');
      opts.setHeaders(fakeRes, '/sw.js');
      opts.setHeaders(fakeRes, '/x.bin');
      return (req, res, next) => {
        res.body = 'static';
        next();
      };
    },
  };
  const fs = {
    existsSync: (p) => String(p).endsWith('working-fixed.html'),
  };
  const path = {
    join: (...parts) => parts.join('/'),
  };

  registerWebStaticRoutes(app, { express, fs, path, webRootDir: '/web' });
  assert.ok(setHeaderCalls.some((c) => c[0] === 'Content-Type'));
  assert.ok(setHeaderCalls.some((c) => c[0] === 'Pragma'));

  const mw = app._uses[0];
  let nextCount = 0;
  const next = () => {
    nextCount += 1;
  };

  // non-GET → next
  mw({ method: 'POST', path: '/working-fixed.html' }, mockRes(), next);
  assert.equal(nextCount, 1);

  // disallowed → next
  mw({ method: 'GET', path: '/secret.env' }, mockRes(), next);
  assert.equal(nextCount, 2);

  // allowed hashed → static
  const resOk = mockRes();
  mw({ method: 'GET', path: '/app.abc123.css' }, resOk, next);
  assert.equal(resOk.body, 'static');

  // agent route
  const resAgent = mockRes();
  app._gets.get('/agent/tenant-operation-inspection')({}, resAgent);
  assert.equal(resAgent.headers['Cache-Control'], 'no-cache');
  assert.match(String(resAgent.body), /agents-admin\.html/);

  // root with working-fixed
  const resRoot = mockRes();
  app._gets.get('/')({}, resRoot);
  assert.match(String(resRoot.body), /working-fixed\.html/);

  // root missing → 404
  const fsEmpty = { existsSync: () => false };
  const app2 = mockApp();
  registerWebStaticRoutes(app2, { express, fs: fsEmpty, path, webRootDir: '/web' });
  const res404 = mockRes();
  app2._gets.get('/')({}, res404);
  assert.equal(res404.statusCode, 404);
  assert.match(String(res404.body), /Missing/);

  // root fallback index.html
  const fsIndex = {
    existsSync: (p) => String(p).endsWith('index.html'),
  };
  const app3 = mockApp();
  registerWebStaticRoutes(app3, { express, fs: fsIndex, path, webRootDir: '/web' });
  const resIdx = mockRes();
  app3._gets.get('/')({}, resIdx);
  assert.match(String(resIdx.body), /index\.html/);
});
