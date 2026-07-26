import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskDispatchCard } from '../task-response-dispatch-card.js';
import {
  getTaskResponseFormUrl,
  mapGenericRowsToBitableRecords,
  trimProcessedTaskResponseIds,
  ensureTaskResponseBitable,
  ensureTaskResponseFormView,
  writeTaskToBitable,
  pollTaskResponseBitable,
  createBitableRecord,
  updateBitableRecord,
  collectPhotoUrlsFromFields,
  applyTaskResponse,
} from '../task-response-helpers.js';
import { createInitialTaskResponseState, TASK_RESPONSE_CONFIG_KEY } from '../task-response-constants.js';
import { createTaskResponseApi } from '../task-response.js';

test('buildTaskDispatchCard: first dispatch high severity', () => {
  const card = buildTaskDispatchCard(
    {
      task_id: 'T1',
      store: '洪潮',
      brand: '洪潮',
      severity: 'high',
      category: '营收',
      title: '异常',
      detail: '详情',
      assignee_role: 'store_manager',
    },
    'https://example.com/form',
    { isFirstDispatch: true }
  );
  assert.equal(card.header.template, 'red');
  assert.match(card.header.title.content, /T1/);
  assert.ok(card.elements.length >= 2);
});

test('getTaskResponseFormUrl prefills query', () => {
  const state = createInitialTaskResponseState();
  state.formUrl = 'https://example.com/base?table=t1';
  const url = getTaskResponseFormUrl(state, {
    task_id: 'T9',
    category: '差评',
    store: '马己仙',
    brand: '马己仙',
    severity: 'medium',
    title: '标题',
  });
  assert.match(url, /prefill_%E4%BB%BB%E5%8A%A1%E7%BC%96%E5%8F%B7=T9|prefill_任务编号=T9/);
  assert.match(url, /table=t1/);
});

test('mapGenericRowsToBitableRecords parses json strings', () => {
  const rows = mapGenericRowsToBitableRecords([
    {
      record_id: 'r1',
      fields: JSON.stringify({ 门店: '洪潮' }),
      raw: JSON.stringify({ id: 'x' }),
    },
  ]);
  assert.equal(rows[0].record_id, 'r1');
  assert.equal(rows[0].fields['门店'], '洪潮');
  assert.equal(rows[0].id, 'x');
});

test('trimProcessedTaskResponseIds trims oldest', () => {
  const set = new Set();
  for (let i = 0; i < 10; i++) set.add(`k${i}`);
  trimProcessedTaskResponseIds(set, 5, 3);
  assert.equal(set.size, 7);
  assert.equal(set.has('k0'), false);
});

test('ensureTaskResponseBitable uses configured tableId', async () => {
  const state = createInitialTaskResponseState();
  const deps = {
    axios: { post: async () => ({ data: {} }) },
    bitableConfigs: { [TASK_RESPONSE_CONFIG_KEY]: { tableId: 'tblX', appToken: 'app' } },
    getBitableTenantToken: async () => 'tok',
    log: { info() {}, error() {}, warn() {} },
    getEnvFormUrl: () => 'https://form.example',
  };
  const ok = await ensureTaskResponseBitable(deps, state);
  assert.equal(ok, true);
  assert.equal(state.tableId, 'tblX');
  assert.equal(state.formUrl, 'https://form.example');
});

test('writeTaskToBitable creates record when ready', async () => {
  const state = createInitialTaskResponseState();
  state.initialized = true;
  state.tableId = 'tblX';
  const processed = new Set();
  const deps = {
    axios: {
      post: async () => ({ data: { data: { record: { record_id: 'rec1' } } } }),
    },
    bitableConfigs: {
      [TASK_RESPONSE_CONFIG_KEY]: { tableId: 'tblX', appToken: 'app' },
    },
    getBitableTenantToken: async () => 'tok',
    log: { info() {}, error() {}, warn() {} },
  };
  const rec = await writeTaskToBitable(
    deps,
    state,
    processed,
    { task_id: 'T1', category: 'c', store: 's', brand: 'b', title: 't' }
  );
  assert.equal(rec.record_id, 'rec1');
  assert.ok(processed.has(`${TASK_RESPONSE_CONFIG_KEY}_rec1`));
});

test('pollTaskResponseBitable applies hook and marks processed', async () => {
  const state = createInitialTaskResponseState();
  state.initialized = true;
  state.tableId = 'tblX';
  const processed = new Set();
  const hooks = [];
  const updates = [];
  const deps = {
    pool: () => ({
      query: async (sql) => {
        if (/feishu_generic_records/i.test(sql)) {
          return {
            rows: [
              {
                record_id: 'r9',
                fields: {
                  任务编号: 'T9',
                  回复说明: '现场已处理完毕，已更换菜品并致歉客人。',
                  处理状态: '已回复',
                },
                raw: {},
              },
            ],
          };
        }
        if (/master_tasks/i.test(sql) && /SELECT/i.test(sql)) {
          return { rows: [{ task_id: 'T9', assignee_username: 'alice' }] };
        }
        return { rows: [] };
      },
    }),
    bitableConfigs: { [TASK_RESPONSE_CONFIG_KEY]: { tableId: 'tblX', appToken: 'app' } },
    getBitableTenantToken: async () => 'tok',
    extractBitableFieldText: (v) => String(v || ''),
    getBitableRecordImageDownloadUrl: async () => null,
    getTaskResponseHook: () => async (user, text, photos) => {
      hooks.push({ user, text, photos });
    },
    axios: {
      put: async (_url, body) => {
        updates.push(body);
        return { data: { data: { record: { record_id: 'r9' } } } };
      },
    },
    log: { info() {}, error() {}, warn() {} },
  };
  await pollTaskResponseBitable(deps, state, processed);
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].user, 'alice');
  assert.ok(processed.has(`${TASK_RESPONSE_CONFIG_KEY}_r9`));
  assert.equal(updates[0]?.fields?.['处理状态'] || updates[0]?.['处理状态'], '已处理');
});

test('createTaskResponseApi thin wrappers', async () => {
  const api = createTaskResponseApi({
    pool: () => ({ query: async () => ({ rows: [] }) }),
    axios: { post: async () => ({ data: {} }), put: async () => ({ data: {} }) },
    bitableConfigs: { [TASK_RESPONSE_CONFIG_KEY]: { tableId: 'tbl', appToken: 'a' } },
    getBitableTenantToken: async () => 't',
    getBitableRecordImageDownloadUrl: async () => null,
    extractBitableFieldText: (v) => String(v || ''),
    getTaskResponseHook: () => null,
  });
  assert.equal(await api.ensureTaskResponseBitable(), true);
  assert.equal(typeof api.buildTaskDispatchCard, 'function');
  await api.pollTaskResponseBitable();
});

test('ensureTaskResponseFormView uses host+viewId when no form url', async () => {
  const state = createInitialTaskResponseState();
  state.tableId = 'tbl1';
  await ensureTaskResponseFormView(
    {
      axios: {},
      bitableConfigs: { [TASK_RESPONSE_CONFIG_KEY]: { appToken: 'APP' } },
      getBitableTenantToken: async () => null,
      log: { info() {}, error() {} },
      getEnvFormUrl: () => '',
      getEnvHost: () => 'host.example',
      getEnvViewId: () => 'vewX',
    },
    state,
    TASK_RESPONSE_CONFIG_KEY
  );
  assert.match(state.formUrl, /host\.example/);
  assert.match(state.formUrl, /vewX/);
  assert.match(state.formUrl, /APP/);
});

test('ensureTaskResponseBitable creates table then disables after failures', async () => {
  const state = createInitialTaskResponseState();
  let posts = 0;
  const depsOk = {
    axios: {
      post: async () => {
        posts += 1;
        return { data: { data: { table_id: 'tblNew' } } };
      },
    },
    bitableConfigs: { [TASK_RESPONSE_CONFIG_KEY]: { appToken: 'APP' } },
    getBitableTenantToken: async () => 'tok',
    log: { info() {}, error() {}, warn() {} },
    getEnvFormUrl: () => 'https://f',
  };
  assert.equal(await ensureTaskResponseBitable(depsOk, state), true);
  assert.equal(state.tableId, 'tblNew');
  assert.equal(posts, 1);

  const stateFail = createInitialTaskResponseState();
  const depsFail = {
    axios: {
      post: async () => {
        const err = new Error('nope');
        err.response = { data: { code: 1254302, msg: 'perm' } };
        throw err;
      },
    },
    bitableConfigs: { [TASK_RESPONSE_CONFIG_KEY]: { appToken: 'APP' } },
    getBitableTenantToken: async () => 'tok',
    log: { info() {}, error() {}, warn() {} },
  };
  assert.equal(await ensureTaskResponseBitable(depsFail, stateFail), false);
  assert.equal(await ensureTaskResponseBitable(depsFail, stateFail), false);
  assert.equal(await ensureTaskResponseBitable(depsFail, stateFail), false);
  assert.equal(stateFail.disabled, true);
  assert.equal(await ensureTaskResponseBitable(depsFail, stateFail), false);
});

test('create/update bitable record happy and error paths', async () => {
  const deps = {
    axios: {
      post: async () => ({ data: { data: { record: { record_id: 'r1' } } } }),
      put: async () => ({ data: { data: { record: { record_id: 'r1' } } } }),
    },
    bitableConfigs: { x: { tableId: 't', appToken: 'a' } },
    getBitableTenantToken: async () => 'tok',
    log: { info() {}, error() {}, warn() {} },
  };
  assert.equal((await createBitableRecord(deps, 'x', { a: 1 })).record_id, 'r1');
  assert.equal((await updateBitableRecord(deps, 'x', 'r1', { a: 2 })).record_id, 'r1');

  const bad = {
    ...deps,
    bitableConfigs: { x: {} },
  };
  assert.equal(await createBitableRecord(bad, 'x', {}), null);
  assert.equal(await updateBitableRecord(bad, 'x', 'r1', {}), null);

  const noTok = {
    ...deps,
    getBitableTenantToken: async () => null,
  };
  assert.equal(await createBitableRecord(noTok, 'x', {}), null);
});

test('collectPhotoUrlsFromFields and applyTaskResponse fallback', async () => {
  const urls = await collectPhotoUrlsFromFields(
    {
      getBitableRecordImageDownloadUrl: async (_k, token) => `https://img/${token}`,
    },
    { 整改照片: [{ file_token: 'ft1' }, { file_token: 'ft2' }] }
  );
  assert.deepEqual(urls, ['https://img/ft1', 'https://img/ft2']);

  const updates = [];
  await applyTaskResponse(
    {
      getTaskResponseHook: () => null,
      pool: () => ({
        query: async (sql, params) => {
          updates.push({ sql, params });
          return { rows: [] };
        },
      }),
    },
    { assignee_username: 'u' },
    'T2',
    '回复内容足够长以便落库',
    ['https://img/a']
  );
  assert.ok(updates.length);
  assert.match(updates[0].sql, /UPDATE master_tasks/i);
});

test('poll skips missing task and empty responses', async () => {
  const state = createInitialTaskResponseState();
  state.initialized = true;
  state.tableId = 'tblX';
  const processed = new Set();
  await pollTaskResponseBitable(
    {
      pool: () => ({
        query: async (sql) => {
          if (/feishu_generic_records/i.test(sql)) {
            return {
              rows: [
                { record_id: 'a', fields: { 任务编号: '', 回复说明: '', 处理状态: '待回复' }, raw: {} },
                {
                  record_id: 'b',
                  fields: { 任务编号: 'TX', 回复说明: '有回复', 处理状态: '已回复' },
                  raw: {},
                },
              ],
            };
          }
          if (/master_tasks/i.test(sql)) return { rows: [] };
          return { rows: [] };
        },
      }),
      bitableConfigs: { [TASK_RESPONSE_CONFIG_KEY]: { tableId: 'tblX', appToken: 'a' } },
      extractBitableFieldText: (v) => String(v || ''),
      getBitableRecordImageDownloadUrl: async () => null,
      getTaskResponseHook: () => null,
      axios: { put: async () => ({ data: {} }) },
      getBitableTenantToken: async () => 't',
      log: { info() {}, error() {}, warn() {} },
    },
    state,
    processed
  );
  assert.ok(processed.has(`${TASK_RESPONSE_CONFIG_KEY}_a`));
  assert.ok(processed.has(`${TASK_RESPONSE_CONFIG_KEY}_b`));
});

test('writeTaskToBitable warns when not ready', async () => {
  const warns = [];
  const rec = await writeTaskToBitable(
    {
      bitableConfigs: { [TASK_RESPONSE_CONFIG_KEY]: {} },
      getBitableTenantToken: async () => null,
      log: { info() {}, error() {}, warn: (...a) => warns.push(a.join(' ')) },
      axios: {},
    },
    createInitialTaskResponseState(),
    new Set(),
    { task_id: 'T' }
  );
  assert.equal(rec, null);
  assert.ok(warns.some((w) => /not ready/i.test(w)));
});
