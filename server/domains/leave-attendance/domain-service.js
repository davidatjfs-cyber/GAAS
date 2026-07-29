/**
 * 欠休域：hrms_leave_domain / hrms_leave_records 为权威，hrms_state 仅为镜像。
 */

import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'leave-attendance', handler: 'domain-service' });

export async function loadLeaveDomainFromTable(pool, tenantId) {
  const tid = String(tenantId || 'default');
  const r = await pool.query(
    `SELECT leave_balance_overrides, leave_balance_adjustments, leave_cumulative_close_snapshots
       FROM hrms_leave_domain
      WHERE id = $1`,
    [tid]
  );
  const row = r.rows?.[0];
  if (!row) return null;
  return {
    leaveBalanceOverrides:
      row.leave_balance_overrides && typeof row.leave_balance_overrides === 'object'
        ? row.leave_balance_overrides
        : {},
    leaveBalanceAdjustments: Array.isArray(row.leave_balance_adjustments)
      ? row.leave_balance_adjustments
      : [],
    leaveCumulativeCloseSnapshots:
      row.leave_cumulative_close_snapshots && typeof row.leave_cumulative_close_snapshots === 'object'
        ? row.leave_cumulative_close_snapshots
        : {},
  };
}

export function leaveRecordRowToStateShape(row) {
  if (!row) return null;
  const id = String(row.id || '').trim();
  if (!id) return null;
  return {
    id,
    approvalId: row.approval_id ? String(row.approval_id) : '',
    applicant: String(row.username || '').trim(),
    applicantName: String(row.name || '').trim(),
    store: String(row.store || '').trim(),
    brand: String(row.brand || '').trim(),
    startDate: row.start_date ? String(row.start_date).slice(0, 10) : '',
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : '',
    days: row.days != null ? Number(row.days) : '',
    type: String(row.type || 'leave').trim(),
    reason: String(row.reason || '').trim(),
    status: String(row.status || 'pending').trim(),
    createdAt: row.created_at ? String(row.created_at) : '',
    approvedBy: String(row.approved_by || '').trim(),
    approvedAt: row.approved_at ? String(row.approved_at) : '',
  };
}

export async function loadLeaveRecordsFromTable(pool, tenantId, limit = 2000) {
  const tid = String(tenantId || 'default');
  const lim = Math.min(5000, Math.max(1, Number(limit) || 2000));
  let r;
  try {
    r = await pool.query(
      `SELECT id, username, name, store, brand, start_date, end_date, days, type, reason,
              status, approval_id, approved_by, approved_at, created_at
         FROM hrms_leave_records
        WHERE tenant_id = $1
        ORDER BY start_date DESC, created_at DESC
        LIMIT $2`,
      [tid, lim]
    );
  } catch (e) {
    if (!/tenant_id|column/i.test(String(e?.message || ''))) throw e;
    r = await pool.query(
      `SELECT id, username, name, store, brand, start_date, end_date, days, type, reason,
              status, approval_id, approved_by, approved_at, created_at
         FROM hrms_leave_records
        ORDER BY start_date DESC, created_at DESC
        LIMIT $1`,
      [lim]
    );
  }
  return (r.rows || []).map(leaveRecordRowToStateShape).filter(Boolean);
}

export async function hydrateLeaveDomainFromTable(pool, state, tenantId) {
  const base = state && typeof state === 'object' ? { ...state } : {};
  try {
    const domain = await loadLeaveDomainFromTable(pool, tenantId);
    if (domain) {
      base.leaveBalanceOverrides = domain.leaveBalanceOverrides;
      base.leaveBalanceAdjustments = domain.leaveBalanceAdjustments;
      base.leaveCumulativeCloseSnapshots = domain.leaveCumulativeCloseSnapshots;
    }
  } catch (e) {
    log.error({ msg: 'leave_domain_hydrate_failed', err: e?.message || String(e) });
  }
  return base;
}

export async function hydrateLeaveRecordsFromTable(pool, state, tenantId) {
  const base = state && typeof state === 'object' ? { ...state } : {};
  try {
    const fromTable = await loadLeaveRecordsFromTable(pool, tenantId);
    if (fromTable.length > 0) {
      base.leaveRecords = fromTable;
    }
  } catch (e) {
    log.error({ msg: 'leave_records_hydrate_failed', err: e?.message || String(e) });
  }
  return base;
}

/**
 * hrms_leave_domain 的字段级原子合并（口径与 hrms-state-store.js 的
 * mergeSharedStateFieldsImpl 一致：SELECT ... FOR UPDATE 锁行 + 只合并 patches 里
 * 出现过的字段 + 乐观锁冲突重试）。
 *
 * 之前这里是无条件 INSERT ... ON CONFLICT DO UPDATE 整表覆盖三个字段——不管调用方
 * 有没有传某个字段都会被覆盖成调用方给的值（缺省 {}/[]）。close-snapshot.js 只想改
 * leaveCumulativeCloseSnapshots，但每次都会把 leaveBalanceOverrides/leaveBalanceAdjustments
 * 也覆盖成调用方读到的（可能是几秒前的）旧快照；setLeaveBalance 在非 carryover 模式下
 * 甚至完全不传 leaveCumulativeCloseSnapshots，会把整个字段直接清空成 {}。多店并发调用时
 * 谁后写谁赢，后写的还会把别的门店/别的字段的改动一起冲掉——这正是旧代码里被删掉的那条
 * 注释警告过的"并发覆盖丢失"。
 *
 * 约定：
 * - fields 里没出现的字段，保持当前值不变（不会被清空）。
 * - leaveBalanceOverrides / leaveCumulativeCloseSnapshots 是对象：浅合并，patch 值为 null
 *   表示删除该 key（JSON Merge Patch 语义），其余 key（含并发写入的）保留。
 * - leaveBalanceAdjustments 是数组：按 id 合并——patch 里的记录覆盖同 id 旧记录，其余
 *   （含并发新增的）保留。
 */
function mergeLeaveDomainObjectField(current, patch) {
  const base = current && typeof current === 'object' ? current : {};
  const next = { ...base, ...patch };
  for (const k of Object.keys(next)) {
    if (next[k] === null) delete next[k];
  }
  return next;
}

function mergeLeaveDomainAdjustments(current, patch) {
  const existing = Array.isArray(current) ? current : [];
  const patchArr = Array.isArray(patch) ? patch : [];
  const getKey = (item) => String(item?.id || '');
  const patchKeys = new Set(patchArr.map(getKey));
  const retained = existing.filter((e) => !patchKeys.has(getKey(e)));
  return [...patchArr, ...retained];
}

export async function upsertLeaveDomain(pool, tenantId, fields) {
  const tid = String(tenantId || 'default');
  const patch = fields && typeof fields === 'object' ? fields : {};
  const touchOverrides = Object.prototype.hasOwnProperty.call(patch, 'leaveBalanceOverrides');
  const touchAdjustments = Object.prototype.hasOwnProperty.call(patch, 'leaveBalanceAdjustments');
  const touchSnapshots = Object.prototype.hasOwnProperty.call(patch, 'leaveCumulativeCloseSnapshots');
  if (!touchOverrides && !touchAdjustments && !touchSnapshots) return;

  const MAX_RETRY = 10;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `SELECT leave_balance_overrides, leave_balance_adjustments, leave_cumulative_close_snapshots, updated_at
           FROM hrms_leave_domain WHERE id = $1 FOR UPDATE`,
        [tid]
      );
      const row = r.rows?.[0];
      if (!row) {
        await client.query(
          `INSERT INTO hrms_leave_domain (id, tenant_id, leave_balance_overrides, leave_balance_adjustments, leave_cumulative_close_snapshots, updated_at)
           VALUES ($1::text, $1::varchar(80), '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [tid]
        );
        await client.query('COMMIT');
        client.release();
        continue; // 下一轮循环会 SELECT ... FOR UPDATE 到刚建好的行，再正常合并
      }

      const currentOverrides = row.leave_balance_overrides;
      const currentAdjustments = row.leave_balance_adjustments;
      const currentSnapshots = row.leave_cumulative_close_snapshots;

      const nextOverrides = touchOverrides
        ? mergeLeaveDomainObjectField(currentOverrides, patch.leaveBalanceOverrides)
        : (currentOverrides && typeof currentOverrides === 'object' ? currentOverrides : {});
      const nextAdjustments = touchAdjustments
        ? mergeLeaveDomainAdjustments(currentAdjustments, patch.leaveBalanceAdjustments)
        : (Array.isArray(currentAdjustments) ? currentAdjustments : []);
      const nextSnapshots = touchSnapshots
        ? mergeLeaveDomainObjectField(currentSnapshots, patch.leaveCumulativeCloseSnapshots)
        : (currentSnapshots && typeof currentSnapshots === 'object' ? currentSnapshots : {});

      const result = await client.query(
        `UPDATE hrms_leave_domain
            SET leave_balance_overrides = $2::jsonb,
                leave_balance_adjustments = $3::jsonb,
                leave_cumulative_close_snapshots = $4::jsonb,
                updated_at = NOW()
          WHERE id = $1 AND updated_at = $5`,
        [tid, JSON.stringify(nextOverrides), JSON.stringify(nextAdjustments), JSON.stringify(nextSnapshots), row.updated_at]
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
  throw new Error('upsertLeaveDomain: max retries exceeded');
}
