/**
 * train_advisor / sop_advisor：KB 与培训任务上下文拼接。
 */

/**
 * @param {Array<{ title?: string, content?: string }>} kbResults
 */
export function formatKnowledgeBaseContext(kbResults) {
  const list = Array.isArray(kbResults) ? kbResults : [];
  if (!list.length) return '';
  return (
    '\n\n相关知识库内容：\n' +
    list.map((r) => `【${r.title}】${String(r.content || '').slice(0, 300)}...`).join('\n')
  );
}

/**
 * @param {Array<{ task_id?: string, type?: string, title?: string, status?: string, due_date?: any }>} rows
 * @param {{ formatDueDate?: (d: any) => string }} [opts]
 */
export function formatTrainingTasksContext(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return '';
  const formatDue =
    typeof opts.formatDueDate === 'function'
      ? opts.formatDueDate
      : (d) => (d ? new Date(d).toLocaleDateString() : '无');
  return (
    '\n\n该用户近期的培训任务：\n' +
    list
      .map(
        (t) =>
          `- [${t.task_id}] ${t.title} (${t.type}) | 状态：${t.status} | 截止：${formatDue(t.due_date)}`
      )
      .join('\n')
  );
}
