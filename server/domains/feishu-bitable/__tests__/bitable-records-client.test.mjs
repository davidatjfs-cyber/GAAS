import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBitableRecordsClient,
  isDataNotReadyError,
  isFeishuInternalError,
  isTransientBitableError,
} from '../bitable-records-client.js';

test('error classifiers', () => {
  assert.equal(isDataNotReadyError('1254607 data not ready'), true);
  assert.equal(isFeishuInternalError('1255001'), true);
  assert.equal(isTransientBitableError('ETIMEDOUT'), true);
  assert.equal(isTransientBitableError('permanent_nope'), false);
});

function makeClient(overrides = {}) {
  const sleeps = [];
  const posts = [];
  const gets = [];
  const axios = {
    post: async (url, body) => {
      posts.push({ url, body });
      if (overrides.post) return overrides.post(url, body);
      return { data: { tenant_access_token: 'tok', expire: 7200 } };
    },
    get: async (url, opts) => {
      gets.push({ url, opts });
      if (overrides.get) return overrides.get(url, opts);
      return { data: { data: { items: [{ record_id: 'r1' }], has_more: false, total: 1 } } };
    },
  };
  const client = createBitableRecordsClient({
    bitableConfigs: {
      ops_checklist: {
        appId: 'app',
        appSecret: 'sec',
        appToken: 'appt',
        tableId: 'tbl',
      },
    },
    axios,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides.deps,
  });
  return { client, posts, gets, sleeps };
}

test('getBitableTenantToken caches until expiry', async () => {
  const { client, posts } = makeClient();
  const a = await client.getBitableTenantToken('ops_checklist');
  const b = await client.getBitableTenantToken('ops_checklist');
  assert.equal(a, 'tok');
  assert.equal(b, 'tok');
  assert.equal(posts.length, 1);
});

test('getBitableTenantToken invalid config / failure', async () => {
  const { client } = makeClient({
    post: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(await client.getBitableTenantToken('missing'), '');
  assert.equal(await client.getBitableTenantToken('ops_checklist'), '');
});

test('getBitableRecords success and invalid config / no token', async () => {
  const { client } = makeClient();
  const ok = await client.getBitableRecords('ops_checklist', { pageSize: 50 });
  assert.equal(ok.ok, true);
  assert.equal(ok.records[0].record_id, 'r1');

  const bad = await client.getBitableRecords('nope');
  assert.deepEqual(bad, { ok: false, error: 'invalid_config' });

  const { client: c2 } = makeClient({
    post: async () => ({ data: {} }),
  });
  const noTok = await c2.getBitableRecords('ops_checklist');
  assert.deepEqual(noTok, { ok: false, error: 'no_token' });
});

test('getBitableRecords data-not-ready fails within DATA_NOT_READY attempt cap', async () => {
  let n = 0;
  const { client, sleeps } = makeClient({
    get: async () => {
      n += 1;
      const err = new Error('x');
      err.response = { data: { code: 1254607, msg: 'data not ready' } };
      throw err;
    },
  });
  const r = await client.getBitableRecords('ops_checklist');
  assert.equal(r.error, '1254607_data_not_ready');
  assert.equal(n, 1);
  assert.deepEqual(sleeps, []);
});
test('getBitableRecords retries transient then succeeds', async () => {
  let n = 0;
  const { client, sleeps } = makeClient({
    get: async () => {
      n += 1;
      if (n === 1) {
        const err = new Error('timeout');
        err.response = { data: { code: 1255001, msg: 'internal' } };
        throw err;
      }
      return { data: { data: { items: [], has_more: false, total: 0 } } };
    },
  });
  const r = await client.getBitableRecords('ops_checklist');
  assert.equal(r.ok, true);
  assert.equal(sleeps.length, 1);
});

test('getBitableRecords network transient without response body', async () => {
  let n = 0;
  const { client } = makeClient({
    get: async () => {
      n += 1;
      if (n < 2) throw new Error('ETIMEDOUT');
      return { data: { data: { items: [], has_more: false } } };
    },
  });
  const r = await client.getBitableRecords('ops_checklist');
  assert.equal(r.ok, true);
});

test('getBitableRecords permanent biz error', async () => {
  const { client } = makeClient({
    get: async () => {
      const err = new Error('x');
      err.response = { data: { code: 99999, msg: 'nope' } };
      throw err;
    },
  });
  const r = await client.getBitableRecords('ops_checklist');
  assert.equal(r.ok, false);
  assert.equal(r.error, '99999');
});

test('getBitableRecordImageDownloadUrl success / fallback / fail', async () => {
  const { client } = makeClient({
    get: async (url) => {
      if (url.includes('download_url')) {
        return { data: { data: { download_url: 'https://img/x' } } };
      }
      return { data: Buffer.from('abc') };
    },
  });
  assert.equal(await client.getBitableRecordImageDownloadUrl('ops_checklist', 'ft'), 'https://img/x');

  const { client: c2 } = makeClient({
    get: async (url) => {
      if (url.includes('download_url')) {
        const err = new Error('fail');
        err.response = { data: { msg: 'no' } };
        throw err;
      }
      return { data: Buffer.from('abc') };
    },
  });
  const dataUrl = await c2.getBitableRecordImageDownloadUrl('ops_checklist', 'ft2');
  assert.match(dataUrl, /^data:image\/jpeg;base64,/);

  const { client: c3 } = makeClient({
    get: async () => {
      throw new Error('all fail');
    },
  });
  assert.equal(await c3.getBitableRecordImageDownloadUrl('ops_checklist', 'ft3'), null);

  const { client: c4 } = makeClient({
    post: async () => ({ data: {} }),
  });
  assert.equal(await c4.getBitableRecordImageDownloadUrl('ops_checklist', 'ft4'), null);
});
