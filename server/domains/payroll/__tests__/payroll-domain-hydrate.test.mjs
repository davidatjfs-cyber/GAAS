import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hydrateStateFromAuthoritativeTables,
  loadPointRecordsFromTable,
  loadPayrollDomainFromTable,
  upsertPayrollDomain,
} from '../service.js';

function fakePool({ points = [], domain = null } = {}) {
  return {
    async query(sql, params) {
      if (/FROM point_records/i.test(sql)) {
        return {
          rows: points.map((p) => ({
            id: p.id,
            approval_id: p.approvalId || '',
            username: p.username || '',
            name: p.name || '',
            store: p.store || '',
            item_name: p.itemName || '',
            reason: p.reason || '',
            points: p.points || 0,
            amount: p.amount || 0,
            approved_at: p.approvedAt || null,
            approved_by: p.approvedBy || '',
          })),
        };
      }
      if (/FROM hrms_payroll_domain/i.test(sql)) {
        if (!domain) return { rows: [] };
        return {
          rows: [
            {
              payroll_adjustments: domain.payrollAdjustments || {},
              payroll_audits: domain.payrollAudits || {},
              salary_adjustments: domain.salaryAdjustments || [],
              monthly_confirmations: domain.monthlyConfirmations || [],
            },
          ],
        };
      }
      throw new Error('unexpected sql: ' + sql + ' params=' + JSON.stringify(params));
    },
  };
}

test('hydrate：表覆盖 state 里陈旧的 pointRecords / payrollAdjustments', async () => {
  const pool = fakePool({
    points: [{ id: 'p1', username: 'u1', points: 9, approvedAt: '2026-07-01' }],
    domain: {
      payrollAdjustments: { '2026-07': { u1: { bonus: 100 } } },
      payrollAudits: { '2026-07': true },
      salaryAdjustments: [{ id: 'sa1', amount: 50 }],
      monthlyConfirmations: [{ id: 'mc1' }],
    },
  });
  const stale = {
    pointRecords: [{ id: 'p1', points: -1 }],
    payrollAdjustments: { '2026-07': { u1: { bonus: 999 } } },
    settings: { theme: 'keep' },
  };
  const next = await hydrateStateFromAuthoritativeTables(pool, stale, 'default');
  assert.equal(next.pointRecords[0].points, 9);
  assert.equal(next.payrollAdjustments['2026-07'].u1.bonus, 100);
  assert.equal(next.payrollAudits['2026-07'], true);
  assert.equal(next.salaryAdjustments[0].id, 'sa1');
  assert.equal(next.monthlyConfirmations[0].id, 'mc1');
  assert.equal(next.settings.theme, 'keep');
});

test('hydrate：domain 表无行时保留 state 薪资字段', async () => {
  const pool = fakePool({ points: [], domain: null });
  const state = { payrollAdjustments: { keep: 1 }, pointRecords: [{ id: 'x' }] };
  const next = await hydrateStateFromAuthoritativeTables(pool, state, 'default');
  assert.deepEqual(next.payrollAdjustments, { keep: 1 });
  assert.deepEqual(next.pointRecords, []); // points 表空 → 覆盖为空数组（权威）
});

test('loadPointRecordsFromTable / loadPayrollDomainFromTable / upsertPayrollDomain', async () => {
  const points = await loadPointRecordsFromTable(
    fakePool({
      points: [{ id: 'p2', username: 'u2', points: 3, amount: 1.5, approvedAt: '2026-07-02' }],
    }),
    'default'
  );
  assert.equal(points[0].points, 3);
  assert.equal(points[0].amount, 1.5);

  assert.equal(await loadPayrollDomainFromTable(fakePool({ domain: null }), 't'), null);
  const domain = await loadPayrollDomainFromTable(
    fakePool({ domain: { payrollAudits: { a: 1 }, salaryAdjustments: [] } }),
    't'
  );
  assert.equal(domain.payrollAudits.a, 1);

  const updateParams = await upsertPayrollDomainCapture({
    currentRow: {
      payroll_adjustments: {},
      payroll_audits: {},
      salary_adjustments: [{ id: 'sa-existing' }],
      monthly_confirmations: [{ id: 'mc-existing' }],
      updated_at: 'ts1',
    },
    patch: {
      payrollAdjustments: { k: 1 },
      payrollAudits: { a: true },
      salaryAdjustments: [{ id: 1 }],
      monthlyConfirmations: [{ id: 2 }],
    },
  });
  assert.equal(JSON.parse(updateParams[1]).k, 1);
});

/** upsertPayrollDomain 走 SELECT ... FOR UPDATE 加锁合并；这里模拟事务连接并回收 UPDATE 参数。 */
async function upsertPayrollDomainCapture({ currentRow, patch, tenantId = 'default' }) {
  let updateParams = null;
  const pool = {
    async query() { return { rows: [] }; },
    async connect() {
      return {
        async query(sql, params) {
          const s = String(sql);
          if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return {};
          if (/SELECT[\s\S]*FROM hrms_payroll_domain[\s\S]*FOR UPDATE/i.test(s)) {
            return { rows: currentRow ? [currentRow] : [] };
          }
          if (/UPDATE hrms_payroll_domain/i.test(s)) {
            updateParams = params;
            return { rowCount: 1 };
          }
          if (/INSERT INTO hrms_payroll_domain/i.test(s)) return {};
          return { rows: [] };
        },
        release() {},
      };
    },
  };
  await upsertPayrollDomain(pool, tenantId, patch);
  return updateParams;
}

test('upsertPayrollDomain：并发安全——只 patch 传入的字段，其余字段保留表里当前值', async () => {
  const updateParams = await upsertPayrollDomainCapture({
    currentRow: {
      payroll_adjustments: { existingKey: { amount: 1 } },
      payroll_audits: { existingAudit: true },
      salary_adjustments: [{ id: 'sa-1' }],
      monthly_confirmations: [{ id: 'mc-1' }],
      updated_at: 'ts1',
    },
    // 只 patch payrollAdjustments 的一个新 key，模拟并发的另一次调用只改了 payrollAudits
    patch: { payrollAdjustments: { newKey: { amount: 2 } } },
  });
  const adjustments = JSON.parse(updateParams[1]);
  const audits = JSON.parse(updateParams[2]);
  const salary = JSON.parse(updateParams[3]);
  const confirmations = JSON.parse(updateParams[4]);
  // 新 key 写入了，旧 key（模拟另一次并发调用刚写入的）没有被冲掉
  assert.deepEqual(adjustments, { existingKey: { amount: 1 }, newKey: { amount: 2 } });
  // 没有出现在 patch 里的字段必须原样保留，不能被清空成 {} / []
  assert.deepEqual(audits, { existingAudit: true });
  assert.deepEqual(salary, [{ id: 'sa-1' }]);
  assert.deepEqual(confirmations, [{ id: 'mc-1' }]);
});

test('upsertPayrollDomain：patch 里对象 key 为 null 表示删除该 key', async () => {
  const updateParams = await upsertPayrollDomainCapture({
    currentRow: {
      payroll_adjustments: { a: 1, b: 2 },
      payroll_audits: {},
      salary_adjustments: [],
      monthly_confirmations: [],
      updated_at: 'ts1',
    },
    patch: { payrollAdjustments: { a: null, c: 3 } },
  });
  assert.deepEqual(JSON.parse(updateParams[1]), { b: 2, c: 3 });
});

test('hydrate：表查询失败时保留原 state', async () => {
  const pool = {
    query: async () => {
      throw new Error('db_down');
    },
  };
  const state = { pointRecords: [{ id: 'keep' }], payrollAdjustments: { x: 1 } };
  const next = await hydrateStateFromAuthoritativeTables(pool, state, 'default');
  assert.deepEqual(next.pointRecords, [{ id: 'keep' }]);
  assert.deepEqual(next.payrollAdjustments, { x: 1 });
});
