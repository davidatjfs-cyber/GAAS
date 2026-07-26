/**
 * Master Agent HTTP route helpers (pure, testable).
 */

export function exportCsv(rows = [], columns = []) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    if (!/[",\n]/.test(s)) return s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const header = columns.join(',');
  const body = rows
    .map((r) => columns.map((c) => esc(r?.[c])).join(','))
    .join('\n');
  return `${header}\n${body}`;
}

export function summarizeEvidenceExport(tasks = [], events = []) {
  const byStatus = {};
  for (const t of tasks) {
    const k = String(t?.status || 'unknown');
    byStatus[k] = (byStatus[k] || 0) + 1;
  }
  const byEventType = {};
  for (const e of events) {
    const k = String(e?.event_type || 'unknown');
    byEventType[k] = (byEventType[k] || 0) + 1;
  }
  return { byStatus, byEventType };
}

export const MASTER_EVIDENCE_TASK_COLUMNS = [
  'task_id',
  'source',
  'category',
  'severity',
  'store',
  'brand',
  'title',
  'status',
  'assignee_role',
  'assignee_username',
  'created_at',
  'updated_at',
];

export const MASTER_EVIDENCE_EVENT_COLUMNS = [
  'task_id',
  'event_type',
  'from_agent',
  'to_agent',
  'status_before',
  'status_after',
  'created_at',
];

export function buildMasterEvidenceCsv(tasks, events) {
  const taskCsv = exportCsv(tasks, MASTER_EVIDENCE_TASK_COLUMNS);
  const eventCsv = exportCsv(events, MASTER_EVIDENCE_EVENT_COLUMNS);
  return ['# master_tasks', taskCsv, '', '# master_events', eventCsv].join('\n');
}

/** POS 健康检查表与时间列映射（sales_raw 已下线，POS 走 pos_sales_detail） */
export const DATA_SOURCE_HEALTH_TABLES = [
  'daily_reports',
  'pos_sales_detail',
  'table_visit_records',
  'master_tasks',
];

export const DATA_SOURCE_HEALTH_TIME_COLUMNS = {
  pos_sales_detail: 'checkout_time',
};
