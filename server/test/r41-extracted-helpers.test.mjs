/**
 * R41：冲高 feishu-bitable/api、employees/service、growth-pos/ingest|feishu-service。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getFeishuAccessToken,
  createFeishuBitableRecord,
  getFeishuBitableData,
} from '../domains/feishu-bitable/api.js';

import {
  employeeRowToStateShape,
  loadEmployeesFromTable,
  hydrateEmployeesFromTable,
  upsertEmployeeFromStateShape,
  upsertEmployeesFromStateShape,
  renameEmployeeUsername,
  deleteEmployeeFromTable,
  patchEmployeeStatus,
} from '../domains/employees/service.js';

import {
  clampSnapshotDays,
  refreshSalesGrowthSnapshot,
  linkPosOrdersToCustomers,
  ingestPosOrders,
} from '../domains/growth-pos/ingest.js';

import {
  buildPosFeishuConfig,
  getPosFeishuConfig,
  savePosFeishuConfig,
  mapFeishuSyncError,
  syncPosFromFeishu,
} from '../domains/growth-pos/feishu-service.js';

function safeErr(e) {
  return String(e?.message || e);
}

// —— feishu-bitable/api ——
test('feishu-bitable/api: token / create / get with mocks', async () => {
  assert.equal(
    await getFeishuAccessToken({
      isExternalEnabled: () => false,
      axios: {},
      safeErrMessage: safeErr,
    }),
    ''
  );
  assert.equal(
    await getFeishuAccessToken({
      isExternalEnabled: () => true,
      axios: {},
      safeErrMessage: safeErr,
      appId: '',
      appSecret: '',
    }),
    ''
  );

  const token = await getFeishuAccessToken({
    isExternalEnabled: () => true,
    axios: {
      async post() {
        return { data: { code: 0, tenant_access_token: 'tok-1' } };
      },
    },
    safeErrMessage: safeErr,
    feishuEnv: { appId: 'id', appSecret: 'sec', baseUrl: 'https://example.test' },
  });
  assert.equal(token, 'tok-1');

  await assert.rejects(
    () =>
      getFeishuAccessToken({
        isExternalEnabled: () => true,
        axios: {
          async post() {
            return { data: { code: 1, msg: 'bad' } };
          },
        },
        safeErrMessage: safeErr,
        appId: 'id',
        appSecret: 'sec',
      }),
    /Feishu API error/
  );

  await assert.rejects(
    () =>
      getFeishuAccessToken({
        isExternalEnabled: () => true,
        axios: {
          async post() {
            const err = new Error('net');
            err.response = { data: { code: 999, msg: 'denied' } };
            throw err;
          },
        },
        safeErrMessage: safeErr,
        appId: 'id',
        appSecret: 'sec',
      }),
    /denied/
  );

  assert.equal(
    await createFeishuBitableRecord({
      isExternalEnabled: () => false,
      axios: {},
      safeErrMessage: safeErr,
      appToken: 'a',
      tableId: 't',
      fields: { x: 1 },
      accessToken: 'tok',
    }),
    null
  );
  assert.equal(
    await createFeishuBitableRecord({
      isExternalEnabled: () => true,
      axios: {},
      safeErrMessage: safeErr,
      appToken: '',
      tableId: 't',
      fields: { x: 1 },
      accessToken: 'tok',
    }),
    null
  );
  assert.equal(
    await createFeishuBitableRecord({
      isExternalEnabled: () => true,
      axios: {},
      safeErrMessage: safeErr,
      appToken: 'a',
      tableId: 't',
      fields: null,
      accessToken: 'tok',
    }),
    null
  );

  const created = await createFeishuBitableRecord({
    isExternalEnabled: () => true,
    axios: {
      async post() {
        return { data: { code: 0, data: { record: { record_id: 'r1' } } } };
      },
    },
    safeErrMessage: safeErr,
    appToken: 'app',
    tableId: 'tbl',
    fields: { Name: 'n' },
    accessToken: 'tok',
  });
  assert.equal(created.record_id, 'r1');

  await assert.rejects(
    () =>
      createFeishuBitableRecord({
        isExternalEnabled: () => true,
        axios: {
          async post() {
            return { data: { code: 2, msg: 'create fail' } };
          },
        },
        safeErrMessage: safeErr,
        appToken: 'app',
        tableId: 'tbl',
        fields: { Name: 'n' },
        accessToken: 'tok',
      }),
    /Create API error/
  );

  await assert.rejects(
    () =>
      createFeishuBitableRecord({
        isExternalEnabled: () => true,
        axios: {
          async post() {
            const err = new Error('net');
            err.response = { data: { code: 3, msg: 'create denied' } };
            throw err;
          },
        },
        safeErrMessage: safeErr,
        appToken: 'app',
        tableId: 'tbl',
        fields: { Name: 'n' },
        accessToken: 'tok',
      }),
    /create denied/
  );

  const empty = await getFeishuBitableData(
    { isExternalEnabled: () => false, axios: {}, safeErrMessage: safeErr },
    'a',
    't',
    'tok'
  );
  assert.deepEqual(empty.items, []);

  let page = 0;
  const paged = await getFeishuBitableData(
    {
      isExternalEnabled: () => true,
      axios: {
        async get(_url, opts) {
          page += 1;
          if (page === 1) {
            assert.equal(opts.params.page_size, 500);
            return {
              data: {
                code: 0,
                data: {
                  items: [{ record_id: '1' }],
                  has_more: true,
                  page_token: 'p2',
                },
              },
            };
          }
          return {
            data: {
              code: 0,
              data: {
                items: [{ record_id: '2' }],
                has_more: false,
              },
            },
          };
        },
      },
      safeErrMessage: safeErr,
      feishuEnv: { baseUrl: 'https://example.test' },
    },
    'app',
    'tbl',
    'tok'
  );
  assert.equal(paged.items.length, 2);

  // has_more 但无 page_token → 防御返回
  const defensive = await getFeishuBitableData(
    {
      isExternalEnabled: () => true,
      axios: {
        async get() {
          return {
            data: {
              code: 0,
              data: { items: [{ record_id: 'x' }], has_more: true, page_token: '' },
            },
          };
        },
      },
      safeErrMessage: safeErr,
    },
    'a',
    't',
    'tok'
  );
  assert.equal(defensive.has_more, false);
  assert.equal(defensive.items.length, 1);

  await assert.rejects(
    () =>
      getFeishuBitableData(
        {
          isExternalEnabled: () => true,
          axios: {
            async get() {
              return { data: { code: 9, msg: 'bitable down' } };
            },
          },
          safeErrMessage: safeErr,
        },
        'a',
        't',
        'tok'
      ),
    /Bitable API error/
  );

  await assert.rejects(
    () =>
      getFeishuBitableData(
        {
          isExternalEnabled: () => true,
          axios: {
            async get() {
              const err = new Error('boom');
              err.response = { data: { code: 1, msg: 'resp' } };
              throw err;
            },
          },
          safeErrMessage: safeErr,
        },
        'a',
        't',
        'tok'
      ),
    /resp/
  );
});

// —— employees/service ——
test('employees/service: upsert / rename / delete / patch / hydrate error', async () => {
  assert.equal(employeeRowToStateShape(null), null);

  const writes = [];
  const pool = {
    async query(sql, params) {
      const s = String(sql);
      writes.push({ s: s.slice(0, 60), params });
      if (/SELECT id, username/i.test(s) || /FROM employees/i.test(s) && /SELECT/i.test(s)) {
        if (writes.filter((w) => /SELECT/i.test(w.s)).length > 1 || /patch|status/i.test(s)) {
          // load for patch
        }
        if (s.includes('ORDER BY username') || s.includes('WHERE tenant_id')) {
          // after upsert, patch loads list
          if (writes.some((w) => /INSERT INTO/i.test(w.s))) {
            return {
              rows: [{
                id: 'e1',
                username: 'alice',
                name: 'Alice',
                role: 'store_manager',
                store: '洪潮',
                department: '',
                position: '店长',
                status: 'active',
                gender: '',
                phone: '',
                email: '',
                join_date: '2024-01-01',
                birthday: '',
                salary: '',
                password_hash: 'p',
                manager_username: '',
                id_card_number: '',
                bank_card: '',
                extra_json: { level: 'L2' },
                created_at: '2024-01-01T00:00:00.000Z',
                updated_at: null,
              }],
            };
          }
          return { rows: [] };
        }
      }
      if (/INSERT INTO/i.test(s)) return { rows: [] };
      if (/DELETE FROM/i.test(s)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };

  const up = await upsertEmployeeFromStateShape(pool, 'default', {
    username: 'alice',
    name: 'Alice',
    role: 'store_manager',
    store: '洪潮',
    level: 'L2',
    createdAt: '2024-01-01T00:00:00.000Z',
  });
  assert.equal(up.username, 'alice');

  assert.equal(await upsertEmployeeFromStateShape(pool, 'default', { name: 'no-user' }), null);

  const n = await upsertEmployeesFromStateShape(pool, 'default', [
    { username: 'bob', name: 'Bob' },
    { name: 'skip' },
  ]);
  assert.equal(n, 1);

  const renamed = await renameEmployeeUsername(pool, 'default', 'alice', {
    username: 'alice2',
    name: 'Alice2',
  });
  assert.equal(renamed.username, 'alice2');

  const sameCase = await renameEmployeeUsername(pool, 'default', 'Alice', {
    username: 'alice',
    name: 'Alice',
  });
  assert.equal(sameCase.username, 'alice');

  await assert.rejects(
    () => renameEmployeeUsername(pool, 'default', '', { username: 'x' }),
    /missing_username/
  );

  assert.equal(await deleteEmployeeFromTable(pool, 'default', 'alice'), 1);
  assert.equal(await deleteEmployeeFromTable(pool, 'default', ''), 0);

  const patchPool = {
    async query(sql) {
      const s = String(sql);
      if (/SELECT/i.test(s) && /employees/i.test(s)) {
        return {
          rows: [{
            id: 'e1',
            username: 'carol',
            name: 'Carol',
            role: 'staff',
            store: '马己仙',
            department: '',
            position: '',
            status: 'active',
            gender: '',
            phone: '',
            email: '',
            join_date: '',
            birthday: '',
            salary: '',
            password_hash: '',
            manager_username: '',
            id_card_number: '',
            bank_card: '',
            extra_json: {},
            created_at: null,
            updated_at: null,
          }],
        };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  const patched = await patchEmployeeStatus(patchPool, 'default', 'carol', 'inactive', {
    resignedAt: '2026-07-25',
  });
  assert.equal(patched.status, 'inactive');
  assert.equal(patched.resignedAt, '2026-07-25');

  await assert.rejects(
    () => patchEmployeeStatus(patchPool, 'default', '', 'inactive'),
    /missing_username_or_status/
  );
  await assert.rejects(
    () =>
      patchEmployeeStatus(
        { async query() { return { rows: [] }; } },
        'default',
        'ghost',
        'inactive'
      ),
    (e) => e?.code === 'not_found' || /not_found/.test(String(e.message))
  );

  const hydrated = await hydrateEmployeesFromTable(
    {
      async query() {
        throw new Error('db down');
      },
    },
    { employees: [{ username: 'keep' }] },
    'default'
  );
  assert.equal(hydrated.employees[0].username, 'keep');

  const loaded = await loadEmployeesFromTable(patchPool, 'default');
  assert.equal(loaded[0].username, 'carol');
});

// —— growth-pos/ingest ——
test('growth-pos/ingest: refresh / link / ingest orders+items', async () => {
  assert.equal(clampSnapshotDays('nope'), 7);
  assert.equal(clampSnapshotDays(3), 3);

  const refreshPool = {
    async query(_sql, params) {
      assert.equal(params[0], 5);
      return { rowCount: 12 };
    },
  };
  assert.equal(await refreshSalesGrowthSnapshot(refreshPool, 5, 'default'), 12);

  let linkSteps = 0;
  const linkPool = {
    async query() {
      linkSteps += 1;
      return { rowCount: linkSteps === 1 ? 3 : 0 };
    },
  };
  assert.equal(await linkPosOrdersToCustomers(linkPool), 3);

  const ingestSql = [];
  const ingestPool = {
    async query(sql) {
      ingestSql.push(String(sql).slice(0, 40));
      return { rowCount: 1 };
    },
  };
  const result = await ingestPosOrders(ingestPool, 'default', {
    storeId: '64822111',
    orders: [
      {
        order_no: 'O1',
        phone: '13800138000',
        biz_date: '2026-07-25',
        order_time: '2026-07-25 12:00:00',
        checkout_time: '2026-07-25 13:00:00',
        amount_after_discount: 100,
        store_name: '洪潮店',
        order_type: '堂食',
        diners: 2,
      },
      {
        order_no: 'O2',
        phone: '',
        biz_date: '2026-07-25',
        amount_after_discount: 50,
      },
    ],
    items: [
      {
        order_no: 'O1',
        dish_name: '牛肉',
        biz_date: '2026-07-25',
        qty: 1,
        amount_after_discount: 80,
        store_code: '64822111',
      },
    ],
  });
  assert.equal(result.ordersUpserted, 2);
  assert.equal(result.itemsUpserted, 1);
  assert.ok(result.customersLinked >= 0);
  assert.ok(ingestSql.some((s) => /pos_orders/i.test(s)));
  assert.ok(ingestSql.some((s) => /pos_order_items/i.test(s)));

  const empty = await ingestPosOrders(ingestPool, 'default', {});
  assert.equal(empty.ordersUpserted, 0);
  assert.equal(empty.itemsUpserted, 0);
});

// —— growth-pos/feishu-service ——
test('growth-pos/feishu-service: config + mapError + sync happy path', async () => {
  const cfg = buildPosFeishuConfig({
    orders_app_token: ' oa ',
    orders_table_id: ' ot ',
    items_app_token: 'ia',
    items_table_id: 'it',
    store_id: 's1',
    app_id: 'aid',
    app_secret: 'asec',
  });
  assert.equal(cfg.orders_app_token, 'oa');
  assert.equal(cfg.store_id, 's1');

  const got = await getPosFeishuConfig({
    async query() {
      return { rows: [{ data: cfg }] };
    },
  });
  assert.equal(got.orders_table_id, 'ot');

  const saved = await savePosFeishuConfig(
    {
      async query() {
        return { rows: [] };
      },
    },
    {
      orders_app_token: 'oa',
      orders_table_id: 'ot',
      items_app_token: 'ia',
      items_table_id: 'it',
      store_id: 's1',
      app_id: 'aid',
      app_secret: 'asec',
    }
  );
  assert.equal(saved.orders_app_token, 'oa');

  assert.equal(mapFeishuSyncError({ code: 'bad_request', message: 'x' }).status, 400);
  assert.equal(mapFeishuSyncError({ code: 'no_config', message: 'x' }).status, 400);
  assert.equal(mapFeishuSyncError({ code: 'no_credentials', message: 'x' }).status, 503);
  assert.equal(mapFeishuSyncError({ code: 'lark_token_failed', message: 'x' }).status, 502);
  assert.equal(mapFeishuSyncError({ code: 'lark_token_empty' }).body.error, 'lark_token_empty');
  assert.equal(mapFeishuSyncError({ code: 'bitable_error', detail: 'd' }).status, 502);
  assert.equal(mapFeishuSyncError({ code: 'items_bitable_error', detail: 'd' }).status, 502);
  assert.equal(mapFeishuSyncError({ code: 'other' }).status, 500);

  // syncPosFromFeishu：注入 override config + mock axios 路径较重，走 no_config / 缺凭据分支即可抬覆盖
  await assert.rejects(
    () =>
      syncPosFromFeishu(
        {
          async query() {
            return { rows: [] };
          },
        },
        'default',
        { config: null }
      ),
    (e) => e?.code === 'no_config' || /config/i.test(String(e?.message || e))
  );

  await assert.rejects(
    () =>
      syncPosFromFeishu(
        {
          async query() {
            return { rows: [] };
          },
        },
        'default',
        {
          config: {
            orders_app_token: 'oa',
            orders_table_id: 'ot',
            items_app_token: '',
            items_table_id: '',
            store_id: 's1',
            app_id: '',
            app_secret: '',
          },
        }
      ),
    (e) => e?.code === 'no_credentials' || /credential|secret|app/i.test(String(e?.message || e))
  );
});
