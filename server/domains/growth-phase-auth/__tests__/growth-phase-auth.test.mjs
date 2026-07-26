import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  cleanText,
  cleanPhone,
  authPhaseApi,
  getPhaseApiTenantId,
  requirePhaseAuth,
} from '../../growth-phase-auth.js';

const JWT = 'test-jwt-growth-phase-auth';
const SYNC = 'sync-secret-phase-auth';

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('cleanText / cleanPhone', () => {
  assert.equal(cleanText(null), '');
  assert.equal(cleanText('  ab  ', 2), 'ab');
  assert.equal(cleanPhone(' +86 138-0013 '), '+861380013');
});

test('authPhaseApi：无 MINIPROGRAM_SYNC_SECRET → 503', () => {
  withEnv({ MINIPROGRAM_SYNC_SECRET: undefined, JWT_SECRET: JWT }, () => {
    const r = authPhaseApi({ headers: {} });
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    assert.equal(r.error, 'miniprogram_sync_disabled');
  });
});

test('authPhaseApi：header secret / bearer secret / JWT / 失败', () => {
  withEnv({ MINIPROGRAM_SYNC_SECRET: SYNC, JWT_SECRET: JWT }, () => {
    assert.equal(
      authPhaseApi({ headers: { 'x-miniprogram-sync-secret': SYNC } }).ok,
      true
    );
    assert.equal(
      authPhaseApi({ headers: { authorization: `Bearer ${SYNC}` } }).user.role,
      'system'
    );
    const token = jwt.sign({ username: 'alice', role: 'admin' }, JWT);
    const jwtOk = authPhaseApi({ headers: { authorization: `Bearer ${token}` } });
    assert.equal(jwtOk.ok, true);
    assert.equal(jwtOk.user.username, 'alice');
    assert.equal(jwtOk.user.role, 'admin');
    const bad = authPhaseApi({ headers: { authorization: 'Bearer not-a-token' } });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 401);
  });
});

test('getPhaseApiTenantId：JWT tenant / 默认 / 坏 token', () => {
  withEnv({ JWT_SECRET: JWT }, () => {
    assert.equal(getPhaseApiTenantId({ headers: {} }), 'default');
    const t = jwt.sign({ username: 'a', tenant_id: 't-42' }, JWT);
    assert.equal(
      getPhaseApiTenantId({ headers: { authorization: `Bearer ${t}` } }),
      't-42'
    );
    assert.equal(
      getPhaseApiTenantId({ headers: { authorization: 'Bearer junk' } }),
      'default'
    );
  });
});

test('requirePhaseAuth：失败写响应，成功返回 true', () => {
  withEnv({ MINIPROGRAM_SYNC_SECRET: SYNC, JWT_SECRET: JWT }, () => {
    let status = 0;
    let body = null;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(payload) {
        body = payload;
      },
    };
    assert.equal(requirePhaseAuth({ headers: {} }, res), false);
    assert.equal(status, 401);
    assert.equal(body.error, 'unauthorized');
    assert.equal(
      requirePhaseAuth({ headers: { 'x-miniprogram-sync-secret': SYNC } }, res),
      true
    );
  });
});
