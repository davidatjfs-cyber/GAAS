/**
 * Phase ⑥：客户未执行责任台账
 * 聚合 master_tasks + growth_actions，供月报复盘说明「系统已建议但客户未执行」。
 */
import { tenantContext } from '../utils/database.js';

function ymd(date = new Date()) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date ? new Date(date) : new Date());
}

function daysAgo(n) {
  const d = new Date(`${ymd()}T00:00:00+08:00`);
  d.setDate(d.getDate() - n);
  return ymd(d);
}

async function tableExists(pool, table) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [table]
  ).catch(() => ({ rows: [] }));
  return !!r.rows?.length;
}

const EXECUTED_TASK = new Set(['resolved', 'settled', 'closed', 'hr_filed', 'done', 'completed']);
const CONFIRMED_TASK = new Set(['pending_response', 'pending_review', 'resolved', 'settled', 'closed', 'hr_filed', 'done', 'completed']);

/**
 * @returns {{ ok, period, summary, statement, items }}
 */
export async function buildExecutionLedger(pool, opts = {}) {
  const tenantId = String(opts.tenantId || opts.tenant_id || 'default').trim() || 'default';
  const storeId = String(opts.storeId || opts.store_id || '').trim();
  const dateFrom = ymd(opts.dateFrom || opts.date_from || daysAgo(30));
  const dateTo = ymd(opts.dateTo || opts.date_to || ymd());

  const items = [];

  if (await tableExists(pool, 'master_tasks')) {
    const r = await pool.query(
      `SELECT task_id, title, status, store, assignee_role, source, created_at, updated_at, due_at
         FROM master_tasks
        WHERE tenant_id=$1
          AND created_at::date BETWEEN $2::date AND $3::date
          AND ($4::text='' OR store=$4 OR store_id::text=$4)
        ORDER BY created_at DESC
        LIMIT 200`,
      [tenantId, dateFrom, dateTo, storeId]
    ).catch(() => ({ rows: [] }));
    for (const row of r.rows || []) {
      const st = String(row.status || '');
      const executed = EXECUTED_TASK.has(st);
      const confirmed = CONFIRMED_TASK.has(st);
      let decision = 'pending';
      if (executed) decision = 'executed';
      else if (['rejected', 'closed_rejected', 'cancelled', 'archived'].includes(st)) decision = 'rejected';
      else if (!confirmed) decision = 'unconfirmed';
      else decision = 'confirmed_unexecuted';
      if (decision === 'executed') continue;
      items.push({
        source: 'master_tasks',
        ref_id: row.task_id,
        title: row.title || row.task_id,
        status: st,
        decision,
        responsible_party: /店长|manager/i.test(String(row.assignee_role || '')) ? 'store_manager' : 'employee',
        responsible_label: decision === 'unconfirmed' ? '店长未确认' : '员工未反馈执行',
        store: row.store || '',
        suggested_at: row.created_at,
        impact: '系统已给出运营建议，但本月客户侧未完成确认/执行，无法评价改善效果。',
      });
    }
  }

  if (await tableExists(pool, 'growth_actions')) {
    const r = await pool.query(
      `SELECT action_key, action_type, status, store_id, title, detail, created_at, executed_at
         FROM growth_actions
        WHERE tenant_id=$1
          AND created_at::date BETWEEN $2::date AND $3::date
          AND ($4::text='' OR store_id=$4)
          AND status IN ('proposed','ignored')
        ORDER BY created_at DESC
        LIMIT 200`,
      [tenantId, dateFrom, dateTo, storeId]
    ).catch(() => ({ rows: [] }));
    for (const row of r.rows || []) {
      const ignored = String(row.status) === 'ignored';
      items.push({
        source: 'growth_actions',
        ref_id: row.action_key,
        title: row.title || row.action_type || row.action_key,
        status: row.status,
        decision: ignored ? 'ignored' : 'proposed_unexecuted',
        responsible_party: 'tenant_admin',
        responsible_label: ignored ? '运营已忽略' : '营销建议待执行',
        store: row.store_id || '',
        suggested_at: row.created_at,
        impact: ignored
          ? '系统建议被忽略，本月不计入触达效果。'
          : '系统已提出营销动作，但客户未确认执行，归因与复盘无法验证实际改善。',
      });
    }
  }

  const byDecision = {};
  for (const it of items) byDecision[it.decision] = (byDecision[it.decision] || 0) + 1;

  const suggested = items.length;
  const unconfirmed = items.filter((x) => x.decision === 'unconfirmed').length;
  const unexecuted = items.filter((x) => ['confirmed_unexecuted', 'proposed_unexecuted'].includes(x.decision)).length;
  const ignored = items.filter((x) => x.decision === 'ignored').length;

  const statement = suggested === 0
    ? `本周期（${dateFrom}～${dateTo}）系统未产生待客户确认/执行的建议记录，或记录不在查询范围内。`
    : `本周期系统共提出 ${suggested} 条待跟进建议：其中店长未确认 ${unconfirmed} 条、已确认未执行 ${unexecuted} 条、被忽略 ${ignored} 条。系统已识别问题并给出方案，但客户侧未完成动作，因此无法评价本月实际经营改善效果。`;

  return {
    ok: true,
    tenant_id: tenantId,
    store_id: storeId || null,
    period: { date_from: dateFrom, date_to: dateTo },
    summary: {
      suggested_count: suggested,
      unconfirmed_count: unconfirmed,
      unexecuted_count: unexecuted,
      ignored_count: ignored,
      by_decision: byDecision,
    },
    statement,
    items: items.slice(0, 100),
  };
}

export async function buildExecutionLedgerForTenant(pool, tenantId, opts = {}) {
  return tenantContext.run(tenantId, () => buildExecutionLedger(pool, { ...opts, tenantId }));
}
