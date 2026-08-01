import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validateUploadHistoryAuth,
  resolveUploadHistoryStore,
  validateUploadHistoryFileInput,
  buildUploadHistoryParseFailure,
  applyUploadHistoryBizType,
  logUploadHistoryStoreOverride,
  findUploadHistoryDuplicateDates,
  buildUploadHistoryDuplicateError,
  groupUploadHistoryRows,
  buildUploadHistoryGroupedBreakdown,
  persistUploadHistoryGroups,
  parseUploadHistoryRows,
  runUploadHistoryFile,
} from '../upload-history-file-helpers.js';

const ctx = {
  canAccessAnalyticsReports: (role) => role === 'admin',
  pickMyStoreFromState: () => '洪潮店',
  isForecastStoreScopedRole: (role) => role === 'store_manager',
  normalizeForecastBizType: (v) => (v === 'takeaway' ? 'takeaway' : v === 'dinein' ? 'dinein' : ''),
  normalizeForecastSlot: (v) => (['lunch', 'dinner'].includes(v) ? v : ''),
  normalizeForecastStoreName: (v) => String(v || '').trim(),
  normalizeForecastStoreKey: (v) => String(v || '').trim(),
  inferForecastUploadDateFromFilename: () => '2026-07-24',
  parseInventoryForecastRowsFromTableMatrix: (matrix) => {
    const header = matrix[0] || [];
    const nameIdx = header.indexOf('菜品名称');
    const qtyIdx = header.indexOf('销售数量');
    if (nameIdx < 0 || qtyIdx < 0) return [];
    const rows = [];
    for (let i = 1; i < matrix.length; i += 1) {
      const line = matrix[i];
      if (!line?.[nameIdx]) continue;
      rows.push({
        date: '2026-07-24',
        bizType: '',
        slot: 'lunch',
        store: '洪潮店',
        productQuantities: { [line[nameIdx]]: Number(line[qtyIdx]) || 0 },
      });
    }
    return rows;
  },
  parseInventoryForecastRowsFromPdfPath: () => [],
  parseInventoryForecastRowsFromPdfBuffer: () => [],
  upsertInventoryForecastHistoryInState: (state, { store, bizType, slot, rowsRaw }) => ({
    state: {
      ...state,
      inventoryForecastHistory: [
        ...(state.inventoryForecastHistory || []),
        { store, bizType, slot, date: rowsRaw[0]?.date },
      ],
    },
    inserted: rowsRaw.length,
    updated: 0,
    skipped: 0,
    accepted: rowsRaw.length,
    evaluated: rowsRaw.length,
  }),
  saveSharedState: async () => {},
};

const log = { debug: () => {}, info: () => {}, warn: () => {} };

test('validateUploadHistoryAuth: missing_user and forbidden', () => {
  assert.equal(validateUploadHistoryAuth({ username: '', role: 'admin' }, ctx).error, 'missing_user');
  assert.equal(validateUploadHistoryAuth({ username: 'u1', role: 'guest' }, ctx).status, 403);
  assert.equal(validateUploadHistoryAuth({ username: 'u1', role: 'admin' }, ctx).ok, true);
});

test('resolveUploadHistoryStore: scoped role uses myStore', () => {
  assert.equal(
    resolveUploadHistoryStore(ctx, { body: { store: '其它店' } }, {}, 'u1', 'store_manager').store,
    '洪潮店'
  );
  assert.equal(
    resolveUploadHistoryStore(ctx, { body: { store: '马己仙店' } }, {}, 'u1', 'admin').store,
    '马己仙店'
  );
  assert.equal(resolveUploadHistoryStore(ctx, { body: {} }, {}, 'u1', 'admin').error, 'missing_store');
});

test('validateUploadHistoryFileInput: missing_file', () => {
  assert.equal(validateUploadHistoryFileInput({ file: null }).error, 'missing_file');
  assert.equal(validateUploadHistoryFileInput({ file: { path: '/tmp/x.csv' } }).ok, true);
});

test('buildUploadHistoryParseFailure: returns structured error', () => {
  const out = buildUploadHistoryParseFailure(
    { originalname: 'bad.txt', size: 10 },
    { parsedRows: [], parseMode: 'csv_attempt', parseErrors: ['csv:empty'], ext: '.txt', mime: 'text/plain', debugMatrixSample: [['a']] }
  );
  assert.equal(out.error, 'invalid_rows');
  assert.match(out.message, /未识别到有效明细/);
  assert.equal(out.debug.parseMode, 'csv_attempt');
});

test('applyUploadHistoryBizType and logUploadHistoryStoreOverride', () => {
  const rows = [{ bizType: '' }];
  applyUploadHistoryBizType(rows, 'dinein', log);
  assert.equal(rows[0].bizType, 'dinein');
  logUploadHistoryStoreOverride(
    [{ store: '马己仙店' }],
    ctx,
    '洪潮店',
    log
  );
});

test('findUploadHistoryDuplicateDates and duplicate error', () => {
  const state0 = {
    inventoryForecastHistory: [{ store: '洪潮店', bizType: 'dinein', date: '2026-07-24' }],
  };
  const dupes = findUploadHistoryDuplicateDates(
    [{ date: '2026-07-24' }, { date: '2026-07-25' }],
    state0,
    '洪潮店',
    'dinein'
  );
  assert.deepEqual(dupes, ['2026-07-24']);
  const err = buildUploadHistoryDuplicateError(['2026-07-24'], 'takeaway');
  assert.equal(err.status, 409);
  assert.match(err.message, /外卖/);
});

test('groupUploadHistoryRows and breakdown', () => {
  const byGroup = groupUploadHistoryRows([
    { bizType: 'dinein', slot: 'lunch', date: '2026-07-24', productQuantities: { 牛腩: 5 } },
    { bizType: 'dinein', slot: 'dinner', date: '2026-07-24', productQuantities: { 牛腩: 3 } },
  ], ctx);
  assert.equal(byGroup.size, 2);
  const breakdown = buildUploadHistoryGroupedBreakdown(byGroup);
  assert.equal(breakdown.length, 2);
});

test('persistUploadHistoryGroups: aggregates counters', async () => {
  const byGroup = new Map([
    ['dinein||lunch', [{ date: '2026-07-24', productQuantities: { 牛腩: 5 } }]],
    ['dinein||dinner', [{ date: '2026-07-24', productQuantities: { 牛腩: 3 } }]],
  ]);
  const out = await persistUploadHistoryGroups(ctx, {}, byGroup, '洪潮店', 'u1');
  assert.equal(out.inserted, 2);
  assert.equal(out.accepted, 2);
});

test('parseUploadHistoryRows: parses csv file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-upload-'));
  const filePath = path.join(dir, 'history.csv');
  fs.writeFileSync(filePath, '菜品名称,销售数量\n牛腩,5\n');
  const out = await parseUploadHistoryRows(
    { path: filePath, originalname: 'history.csv', mimetype: 'text/csv', size: 20 },
    ctx,
    log,
    dir
  );
  assert.equal(out.parsedRows.length, 1);
  assert.equal(out.parseMode, 'csv');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runUploadHistoryFile: invalid_biz_type', async () => {
  const localCtx = {
    ...ctx,
    getSharedState: async () => ({}),
  };
  const out = await runUploadHistoryFile(localCtx, {
    username: 'u1',
    role: 'admin',
    body: { store: '洪潮店', bizType: '' },
    file: { path: '/tmp/x', originalname: 'x.csv' },
  }, { log, uploadsDir: os.tmpdir() });
  assert.equal(out.error, 'invalid_biz_type');
});

test('runUploadHistoryFile: duplicate dates blocked', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-upload-'));
  const filePath = path.join(dir, 'history.csv');
  fs.writeFileSync(filePath, '菜品名称,销售数量\n牛腩,5\n');
  const localCtx = {
    ...ctx,
    getSharedState: async () => ({
      inventoryForecastHistory: [{ store: '洪潮店', bizType: 'dinein', date: '2026-07-24' }],
    }),
  };
  const out = await runUploadHistoryFile(localCtx, {
    username: 'u1',
    role: 'admin',
    body: { store: '洪潮店', bizType: 'dinein' },
    file: { path: filePath, originalname: 'history.csv', mimetype: 'text/csv', size: 20 },
  }, { log, uploadsDir: dir });
  assert.equal(out.error, 'date_already_exists');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runUploadHistoryFile: successful csv upload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-upload-'));
  const filePath = path.join(dir, 'history.csv');
  fs.writeFileSync(filePath, '菜品名称,销售数量\n牛腩,5\n');
  let saved = null;
  const localCtx = {
    ...ctx,
    getSharedState: async () => ({ inventoryForecastHistory: [] }),
    saveSharedState: async (s) => { saved = s; },
  };
  const out = await runUploadHistoryFile(localCtx, {
    username: 'u1',
    role: 'admin',
    body: { store: '洪潮店', bizType: 'dinein' },
    file: { path: filePath, originalname: 'history.csv', mimetype: 'text/csv', size: 20 },
  }, { log, uploadsDir: dir });
  assert.equal(out.ok, true);
  assert.equal(out.parsedRows, 1);
  assert.equal(out.grouped, 1);
  assert.ok(saved);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runUploadHistoryFile: missing_user short-circuit', async () => {
  const out = await runUploadHistoryFile(ctx, { username: '', role: 'admin', body: {}, file: null }, { log, uploadsDir: os.tmpdir() });
  assert.equal(out.error, 'missing_user');
});
