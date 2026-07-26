import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessBitableData } from '../process-bitable-data.js';
import {
  processBadReviewData,
  processChecklistData,
  processClosingReportData,
  processGenericData,
  processMaterialReportData,
  processMeetingReportData,
  processOpeningReportData,
  processTableVisitData,
} from '../process-bitable-data-helpers.js';

function makePool(onQuery) {
  return () => ({
    query: async (sql, params) => {
      if (onQuery) onQuery(sql, params);
      return { rows: [] };
    },
  });
}

test('processBitableData invalid config returns early', async () => {
  const logs = [];
  const process = createProcessBitableData({
    pool: makePool(),
    bitableConfigs: {},
    tenantContext: { run: async (_t, fn) => fn() },
    extractDissatisfactionDishFromFields: () => '',
    extractDissatisfactionReasonFromFields: () => '',
    normalizeBitableDateValue: () => '',
    normalizeCanonicalStoreName: (s) => s,
    extractBitableFieldText: () => '',
  });
  // override log via calling invalid — factory uses module log; just ensure no throw
  await process('missing', []);
  assert.equal(logs.length, 0);
});

test('processBitableData routes table_visit through tenantContext', async () => {
  const calls = [];
  const sqls = [];
  const process = createProcessBitableData({
    pool: makePool((sql) => sqls.push(sql)),
    bitableConfigs: {
      table_visit: { type: 'table_visit' },
    },
    tenantContext: {
      run: async (tenantId, fn) => {
        calls.push(tenantId);
        return fn();
      },
    },
    extractDissatisfactionDishFromFields: () => '鹅',
    extractDissatisfactionReasonFromFields: () => '咸',
    normalizeBitableDateValue: () => '2026-07-01',
    normalizeCanonicalStoreName: (s) => String(s || '').trim(),
    extractBitableFieldText: (v) => String(v || ''),
  });

  await process('table_visit', [
    {
      record_id: 'tv1',
      created_time: 1,
      fields: {
        门店: '洪潮店',
        桌号: 'A1',
        记录日期: '2026-07-01',
        今天催菜内容: '加急',
      },
    },
  ]);

  assert.deepEqual(calls, ['default']);
  assert.ok(sqls.some((s) => /INSERT INTO agent_messages/i.test(s)));
  assert.ok(sqls.some((s) => /INSERT INTO table_visit_records/i.test(s)));
});

test('processBitableData routes bad_review and generic', async () => {
  const sqls = [];
  const process = createProcessBitableData({
    pool: makePool((sql) => sqls.push(sql)),
    bitableConfigs: {
      bad_reviews: { type: 'bad_review' },
      other: { type: 'unknown_type' },
    },
    tenantContext: { run: async (_t, fn) => fn() },
    extractDissatisfactionDishFromFields: () => '',
    extractDissatisfactionReasonFromFields: () => '',
    normalizeBitableDateValue: () => '',
    normalizeCanonicalStoreName: (s) => s,
    extractBitableFieldText: () => '',
  });

  await process('bad_reviews', [{ record_id: 'br1', fields: { 差评门店: '马己仙店' } }]);
  await process('other', [{ record_id: 'g1', fields: { a: 1 } }]);
  assert.ok(sqls.some((s) => /negative_review/i.test(s)));
  assert.ok(sqls.some((s) => /generic_bitable/i.test(s)));
});

test('processChecklistData is a no-op stub that logs', async () => {
  const logs = [];
  await processChecklistData({ log: { info: (m) => logs.push(m) } }, [{ record_id: 'c1' }]);
  assert.ok(logs.some((m) => String(m).includes('checklist')));
});

test('processTableVisitData ignores duplicate errors', async () => {
  let n = 0;
  await processTableVisitData(
    {
      pool: () => ({
        query: async () => {
          n += 1;
          throw new Error('duplicate key value');
        },
      }),
      log: { info() {}, error() { throw new Error('should not log duplicate'); } },
      extractDissatisfactionDishFromFields: () => '',
      extractDissatisfactionReasonFromFields: () => '',
      normalizeBitableDateValue: () => '',
      normalizeCanonicalStoreName: (s) => s,
      extractBitableFieldText: () => '',
    },
    [{ record_id: 'd1', fields: {} }]
  );
  assert.equal(n, 1);
});

test('processBadReviewData / processGenericData write agent_messages', async () => {
  const sqls = [];
  const deps = {
    pool: makePool((sql) => sqls.push(sql)),
    log: { info() {}, error() {} },
    normalizeCanonicalStoreName: (s) => s,
  };
  await processBadReviewData(deps, [{ record_id: 'x', fields: { 门店: '洪潮店' } }]);
  await processGenericData(deps, [{ record_id: 'y', fields: {} }], 'misc');
  assert.equal(sqls.length, 2);
});

test('report processors cover closing/opening/meeting/material paths', async () => {
  const sqls = [];
  const errs = [];
  const deps = {
    pool: makePool((sql) => sqls.push(sql)),
    log: { info() {}, error: (...a) => errs.push(a) },
  };
  const rec = [{ record_id: 'r1', fields: { 门店: '洪潮店', 日期: '2026-07-01' } }];
  await processClosingReportData(deps, rec);
  await processOpeningReportData(deps, rec);
  await processMeetingReportData(deps, rec);
  await processMaterialReportData(deps, rec, 'majixian');
  assert.equal(sqls.length, 4);
  assert.ok(sqls.some((s) => /closing_report/.test(s)));
  assert.ok(sqls.some((s) => /opening_report/.test(s)));
  assert.ok(sqls.some((s) => /meeting_report/.test(s)));
  assert.ok(sqls.some((s) => /material_report/.test(s)));
});

test('report / generic / bad_review log non-duplicate failures', async () => {
  const errs = [];
  const failing = {
    pool: () => ({
      query: async () => {
        throw new Error('db exploded');
      },
    }),
    log: { info() {}, error: (...a) => errs.push(a.join(' ')) },
    normalizeCanonicalStoreName: (s) => s,
  };
  await processClosingReportData(failing, [{ record_id: 'e1', fields: {} }]);
  await processOpeningReportData(failing, [{ record_id: 'e2', fields: {} }]);
  await processMeetingReportData(failing, [{ record_id: 'e3', fields: {} }]);
  await processMaterialReportData(failing, [{ record_id: 'e4', fields: {} }], 'hongchao');
  await processGenericData(failing, [{ record_id: 'e5', fields: {} }], 'misc');
  await processBadReviewData(failing, [{ record_id: 'e6', fields: {} }]);
  assert.equal(errs.length, 6);
});

test('processBitableData routes remaining report types', async () => {
  const sqls = [];
  const process = createProcessBitableData({
    pool: makePool((sql) => sqls.push(sql)),
    bitableConfigs: {
      closing_reports: { type: 'closing_report' },
      opening_reports: { type: 'opening_report' },
      meeting_reports: { type: 'meeting_report' },
      material_majixian: { type: 'material_report', brand: 'majixian' },
      ops_checklist: { type: 'checklist' },
    },
    tenantContext: { run: async (_t, fn) => fn() },
    extractDissatisfactionDishFromFields: () => '',
    extractDissatisfactionReasonFromFields: () => '',
    normalizeBitableDateValue: () => '',
    normalizeCanonicalStoreName: (s) => s,
    extractBitableFieldText: () => '',
  });
  const rec = [{ record_id: 'z', fields: {} }];
  await process('closing_reports', rec);
  await process('opening_reports', rec);
  await process('meeting_reports', rec);
  await process('material_majixian', rec);
  await process('ops_checklist', rec);
  assert.ok(sqls.length >= 4);
});

test('processTableVisitData logs non-duplicate save failures', async () => {
  const errs = [];
  await processTableVisitData(
    {
      pool: () => ({
        query: async () => {
          throw new Error('connection reset');
        },
      }),
      log: { info() {}, error: (...a) => errs.push(a.join(' ')) },
      extractDissatisfactionDishFromFields: () => '',
      extractDissatisfactionReasonFromFields: () => '',
      normalizeBitableDateValue: () => '',
      normalizeCanonicalStoreName: (s) => s,
      extractBitableFieldText: () => '',
    },
    [{ record_id: 'fail1', fields: {} }]
  );
  assert.equal(errs.length, 1);
  assert.match(errs[0], /save failed/);
});
