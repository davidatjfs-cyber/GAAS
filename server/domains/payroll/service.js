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

export async function upsertPayrollDomain(pool, tenantId, fields) {
  const tid = String(tenantId || 'default');
  const pa = fields.payrollAdjustments && typeof fields.payrollAdjustments === 'object' ? fields.payrollAdjustments : {};
  const pau = fields.payrollAudits && typeof fields.payrollAudits === 'object' ? fields.payrollAudits : {};
  const sa = Array.isArray(fields.salaryAdjustments) ? fields.salaryAdjustments : [];
  const mc = Array.isArray(fields.monthlyConfirmations) ? fields.monthlyConfirmations : [];
  await pool.query(
    `INSERT INTO hrms_payroll_domain (id, tenant_id, payroll_adjustments, payroll_audits, salary_adjustments, monthly_confirmations, updated_at)
     VALUES ($1::text, $1::varchar(80), $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET
       payroll_adjustments = EXCLUDED.payroll_adjustments,
       payroll_audits = EXCLUDED.payroll_audits,
       salary_adjustments = EXCLUDED.salary_adjustments,
       monthly_confirmations = EXCLUDED.monthly_confirmations,
       updated_at = NOW()`,
    [tid, JSON.stringify(pa), JSON.stringify(pau), JSON.stringify(sa), JSON.stringify(mc)]
  );
}
