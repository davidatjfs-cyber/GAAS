import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  clampLimit,
  parseSemanticFallback,
  buildWhere,
} from '../helpers.js';
import {
  handleFeishuCallback,
  semanticParse,
  semanticWriteback,
  listCustomers,
} from '../service.js';

function baseCtx(overrides = {}) {
  return {
    pool: {
      async query() {
        return { rows: [] };
      },
    },
    tenantContext: { run: async (_t, fn) => fn() },
    getActiveTenantIds: async () => ['default'],
    appendExecutionLog: async () => {},
    ...overrides,
  };
}

test('helpers: cleanText / clampLimit / buildWhere', () => {
  assert.equal(cleanText('  ab  ', 2), 'ab');
  assert.equal(clampLimit(9999), 500);
  // Number(0) || 50 → 50（与迁移前口径一致）
  assert.equal(clampLimit(0), 50);
  const { where, params, nextIdx } = buildWhere([
    ['phone', '138'],
    ['(first_store_id = $N OR last_store_id = $N)', 's1'],
    ['openid', ''],
  ]);
  assert.equal(where, 'WHERE phone = $1 AND (first_store_id = $2 OR last_store_id = $2)');
  assert.deepEqual(params, ['138', 's1']);
  assert.equal(nextIdx, 3);
});

test('parseSemanticFallback: tags + emotion + return_intent', () => {
  const r = parseSemanticFallback('麻辣牛肉汤很好吃，下次再来');
  assert.ok(r.taste_tags.includes('麻辣'));
  assert.ok(r.taste_tags.includes('肉食'));
  assert.ok(r.taste_tags.includes('汤品'));
  assert.equal(r.emotion, '正面');
  assert.equal(r.return_intent, true);
  assert.equal(r.source, 'keyword_fallback');

  const bad = parseSemanticFallback('很差很失望');
  assert.equal(bad.emotion, '负面');
});

test('handleFeishuCallback: secret / auth / missing / not found', async () => {
  const prev = process.env.FEISHU_CALLBACK_SECRET;
  delete process.env.FEISHU_CALLBACK_SECRET;
  delete process.env.MINIPROGRAM_SYNC_SECRET;
  const noSecret = await handleFeishuCallback(baseCtx(), {}, {});
  assert.equal(noSecret.status, 503);

  process.env.FEISHU_CALLBACK_SECRET = 'sec';
  const unauth = await handleFeishuCallback(baseCtx(), { secret: 'wrong' }, {});
  assert.equal(unauth.status, 403);

  const missing = await handleFeishuCallback(baseCtx(), { secret: 'sec' }, {});
  assert.equal(missing.status, 400);

  const notFound = await handleFeishuCallback(
    baseCtx(),
    { secret: 'sec', action_key: 'a1', decision: 'execute' },
    {}
  );
  assert.equal(notFound.status, 404);

  if (prev == null) delete process.env.FEISHU_CALLBACK_SECRET;
  else process.env.FEISHU_CALLBACK_SECRET = prev;
});

test('handleFeishuCallback: execute decision', async () => {
  const prev = process.env.FEISHU_CALLBACK_SECRET;
  process.env.FEISHU_CALLBACK_SECRET = 'sec';
  let logged = false;
  const ctx = baseCtx({
    pool: {
      async query(sql) {
        if (String(sql).includes('SELECT * FROM growth_actions')) {
          return { rows: [{ action_key: 'a1', store_id: 's1', action_type: 'send' }] };
        }
        return { rows: [] };
      },
    },
    appendExecutionLog: async () => {
      logged = true;
    },
  });
  const r = await handleFeishuCallback(
    ctx,
    { secret: 'sec', action_key: 'a1', decision: 'execute' },
    {}
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.action, 'executed');
  assert.equal(logged, true);
  if (prev == null) delete process.env.FEISHU_CALLBACK_SECRET;
  else process.env.FEISHU_CALLBACK_SECRET = prev;
});

test('semanticParse: missing_text + keyword fallback', async () => {
  const missing = await semanticParse(baseCtx(), {});
  assert.equal(missing.status, 400);

  const prevJwt = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'dev';
  const fb = await semanticParse(baseCtx(), { text: '清淡少油' });
  assert.equal(fb.body.source, 'keyword_fallback');
  assert.ok(fb.body.taste_tags.includes('清淡'));
  if (prevJwt == null) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = prevJwt;
});

test('semanticWriteback: missing_customer_id', async () => {
  const r = await semanticWriteback(baseCtx(), 'default', { tags: ['x'] });
  assert.equal(r.status, 400);
});

test('listCustomers: clamps limit', async () => {
  let seenLimit;
  const ctx = baseCtx({
    pool: {
      async query(_sql, params) {
        seenLimit = params[params.length - 2];
        return { rows: [] };
      },
    },
  });
  await listCustomers(ctx, 'default', { limit: 9999 });
  assert.equal(seenLimit, 500);
});
