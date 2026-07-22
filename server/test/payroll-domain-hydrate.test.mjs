import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateStateFromAuthoritativeTables } from '../domains/payroll/service.js';

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
