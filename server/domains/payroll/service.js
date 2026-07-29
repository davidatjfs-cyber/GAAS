/**
 * 薪资/积分域：表为权威，hrms_state 仅为镜像。
 *
 * - pointRecords      → point_records 表
 * - payrollAdjustments / payrollAudits / salaryAdjustments / monthlyConfirmations
 *                     → hrms_payroll_domain 表（JSONB 列）
 *
 * GET /api/state 与 getSharedState 调用方应通过 hydrateStateFromAuthoritativeTables
 * 覆盖这些字段，避免读到陈旧 state 镜像。
 */

import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'payroll', handler: 'service' });


export async function loadPointRecordsFromTable(pool, tenantId) {
  const tid = String(tenantId || 'default');
  const prRows = await pool.query(
    `SELECT id::text, approval_id, username, name, store, item_name, reason,
            points, amount, approved_at, approved_by
     FROM ${SHARED_TABLES.POINT_RECORDS}
     WHERE tenant_id = $1
     ORDER BY approved_at DESC NULLS LAST, created_at DESC`,
    [tid]
  );
  return prRows.rows.map((row) => ({
    id: row.id,
    approvalId: row.approval_id || '',
    username: row.username || '',
    name: row.name || '',
    store: row.store || '',
    itemName: row.item_name || '',
    reason: row.reason || '',
    points: Number(row.points) || 0,
    amount: Number(row.amount) || 0,
    approvedAt: row.approved_at ? String(row.approved_at) : '',
    approvedBy: row.approved_by || '',
  }));
}

export async function loadPayrollDomainFromTable(pool, tenantId) {
  const tid = String(tenantId || 'default');
  const domainR = await pool.query(
    `SELECT payroll_adjustments, payroll_audits, salary_adjustments, monthly_confirmations
     FROM ${SHARED_TABLES.HRMS_PAYROLL_DOMAIN} WHERE id = $1`,
    [tid]
  );
  const row = domainR.rows?.[0];
  if (!row) return null;
  return {
    payrollAdjustments:
      row.payroll_adjustments && typeof row.payroll_adjustments === 'object' ? row.payroll_adjustments : {},
    payrollAudits: row.payroll_audits && typeof row.payroll_audits === 'object' ? row.payroll_audits : {},
    salaryAdjustments: Array.isArray(row.salary_adjustments) ? row.salary_adjustments : [],
    monthlyConfirmations: Array.isArray(row.monthly_confirmations) ? row.monthly_confirmations : [],
  };
}

/**
 * 用权威表覆盖 state 中的积分/薪资字段。表无数据时保留 state 原值（兼容空库/迁移中）。
 */
export async function hydrateStateFromAuthoritativeTables(pool, state, tenantId) {
  const base = state && typeof state === 'object' ? { ...state } : {};
  const tid = String(tenantId || 'default');

  try {
    const points = await loadPointRecordsFromTable(pool, tid);
    if (Array.isArray(points)) base.pointRecords = points;
  } catch (e) {
    log.error({ msg: 'payroll_domain_load_point_records_failed', err: e?.message || e });
  }

  try {
    const domain = await loadPayrollDomainFromTable(pool, tid);
    if (domain) {
      base.payrollAdjustments = domain.payrollAdjustments;
      base.payrollAudits = domain.payrollAudits;
      base.salaryAdjustments = domain.salaryAdjustments;
      base.monthlyConfirmations = domain.monthlyConfirmations;
    }
  } catch (e) {
    log.error({ msg: 'payroll_domain_load_hrms_payroll_domain_failed', err: e?.message || e });
  }

  return base;
}

/**
 * hrms_payroll_domain 的字段级原子合并（同 leave-attendance/domain-service.js 的
 * upsertLeaveDomain）：SELECT ... FOR UPDATE 锁行 + 只合并 fields 里出现过的字段 +
 * 乐观锁冲突重试。之前是无条件整表覆盖四个字段——auditPayrollMonth/adjustPayrollRow
 * 各自读一份旧快照、改一个字段、把四个字段整体覆盖写回，门店财务/HR 并发操作时后写的
 * 会把先写的另一处改动整体冲掉。payrollAdjustments/payrollAudits 是对象，浅合并（patch
 * 值为 null 表示删除该 key）；salaryAdjustments/monthlyConfirmations 目前只被
 * schedulePayrollDomainSync 那条既有的定时双写路径整体覆盖写入，这里保持"未出现在
 * fields 里就维持表中原值"，不改变它们的既有同步方式。
 */
function mergePayrollDomainObjectField(current, patch) {
  const base = current && typeof current === 'object' ? current : {};
  const next = { ...base, ...patch };
  for (const k of Object.keys(next)) {
    if (next[k] === null) delete next[k];
  }
  return next;
}

export async function upsertPayrollDomain(pool, tenantId, fields) {
  const tid = String(tenantId || 'default');
  const patch = fields && typeof fields === 'object' ? fields : {};
  const touchAdjustments = Object.prototype.hasOwnProperty.call(patch, 'payrollAdjustments');
  const touchAudits = Object.prototype.hasOwnProperty.call(patch, 'payrollAudits');
  const touchSalary = Object.prototype.hasOwnProperty.call(patch, 'salaryAdjustments');
  const touchConfirmations = Object.prototype.hasOwnProperty.call(patch, 'monthlyConfirmations');
  if (!touchAdjustments && !touchAudits && !touchSalary && !touchConfirmations) return;

  const MAX_RETRY = 10;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT payroll_adjustments, payroll_audits, salary_adjustments, monthly_confirmations, updated_at
           FROM hrms_payroll_domain WHERE id = $1 FOR UPDATE`,
        [tid]
      );
      const row = r.rows?.[0];
      if (!row) {
        await client.query(
          `INSERT INTO hrms_payroll_domain (id, tenant_id, payroll_adjustments, payroll_audits, salary_adjustments, monthly_confirmations, updated_at)
           VALUES ($1::text, $1::varchar(80), '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [tid]
        );
        await client.query('COMMIT');
        client.release();
        continue; // 下一轮 SELECT ... FOR UPDATE 会锁到刚建好的行
      }

      const nextAdjustments = touchAdjustments
        ? mergePayrollDomainObjectField(row.payroll_adjustments, patch.payrollAdjustments)
        : (row.payroll_adjustments && typeof row.payroll_adjustments === 'object' ? row.payroll_adjustments : {});
      const nextAudits = touchAudits
        ? mergePayrollDomainObjectField(row.payroll_audits, patch.payrollAudits)
        : (row.payroll_audits && typeof row.payroll_audits === 'object' ? row.payroll_audits : {});
      const nextSalary = touchSalary
        ? (Array.isArray(patch.salaryAdjustments) ? patch.salaryAdjustments : [])
        : (Array.isArray(row.salary_adjustments) ? row.salary_adjustments : []);
      const nextConfirmations = touchConfirmations
        ? (Array.isArray(patch.monthlyConfirmations) ? patch.monthlyConfirmations : [])
        : (Array.isArray(row.monthly_confirmations) ? row.monthly_confirmations : []);

      const result = await client.query(
        `UPDATE hrms_payroll_domain
            SET payroll_adjustments = $2::jsonb,
                payroll_audits = $3::jsonb,
                salary_adjustments = $4::jsonb,
                monthly_confirmations = $5::jsonb,
                updated_at = NOW()
          WHERE id = $1 AND updated_at = $6`,
        [tid, JSON.stringify(nextAdjustments), JSON.stringify(nextAudits), JSON.stringify(nextSalary), JSON.stringify(nextConfirmations), row.updated_at]
      );
      if (result.rowCount > 0) {
        await client.query('COMMIT');
        client.release();
        return;
      }
      await client.query('ROLLBACK');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw e;
    }
  }
  throw new Error('upsertPayrollDomain: max retries exceeded');
}
