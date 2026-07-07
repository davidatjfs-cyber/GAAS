function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function severityFromPriority(priority) {
  const p = clean(priority, 20).toUpperCase();
  if (p === 'P1') return 'high';
  if (p === 'P2') return 'medium';
  return 'low';
}

function makeTaskId(prefix = 'ONT') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildOntologyTaskInsert(taskDraft = {}, options = {}) {
  const sourceData = {
    ontology: true,
    sourceIssueId: clean(taskDraft.sourceIssueId || options.sourceIssueId, 120),
    sourceDomain: clean(taskDraft.sourceDomain || options.sourceDomain, 120),
    sourceReportType: clean(options.reportType || taskDraft.sourceReportType, 120),
    ontologyInsightId: clean(options.ontologyInsightId || taskDraft.ontologyInsightId, 160),
    expectedResult: clean(taskDraft.expectedResult, 1000),
    trackingMetrics: Array.isArray(taskDraft.trackingMetrics) ? taskDraft.trackingMetrics : [],
    dueDate: taskDraft.dueDate || null,
    ownerRole: clean(taskDraft.ownerRole, 120),
    ownerUserId: clean(options.ownerUserId || taskDraft.ownerUserId, 120),
    resultReview: {
      actualResult: null,
      actualMetrics: null,
      completionNote: null,
      completedAt: null,
      resultReviewStatus: 'insufficient_data',
    },
  };
  return {
    taskId: makeTaskId(),
    status: 'pending_dispatch',
    source: 'ontology_business',
    sourceRef: sourceData.sourceIssueId || sourceData.sourceReportType || 'ontology',
    currentAgent: 'master',
    category: sourceData.sourceIssueId || '经营语义层任务',
    severity: severityFromPriority(taskDraft.priority),
    store: clean(options.storeId || taskDraft.storeId, 200),
    brand: clean(options.brand || '', 120),
    assigneeUsername: clean(options.ownerUserId || taskDraft.ownerUserId, 120),
    assigneeRole: clean(taskDraft.ownerRole, 120),
    title: clean(taskDraft.title, 500),
    detail: clean(taskDraft.description || taskDraft.expectedResult, 4000),
    sourceData,
  };
}

export async function createOntologyTaskFromDraft(pool, taskDraft = {}, options = {}) {
  if (!taskDraft?.title) throw new Error('taskDraft.title_required');
  const task = buildOntologyTaskInsert(taskDraft, options);
  const tenantId = options.tenantId || 'default';
  const result = await pool.query(
    `INSERT INTO master_tasks (
       task_id, status, source, source_ref, current_agent, category, severity, store, brand,
       title, detail, source_data, assignee_role, assignee_username, tenant_id
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)
     RETURNING *`,
    [
      task.taskId,
      task.status,
      task.source,
      task.sourceRef,
      task.currentAgent,
      task.category,
      task.severity,
      task.store,
      task.brand,
      task.title,
      task.detail,
      JSON.stringify(task.sourceData),
      task.assigneeRole,
      task.assigneeUsername,
      tenantId,
    ]
  );
  const createdTask = result.rows?.[0] || {
    task_id: task.taskId,
    title: task.title,
    status: task.status,
    assignee_role: task.assigneeRole,
    assignee_username: task.assigneeUsername,
    source_data: task.sourceData,
  };
  return {
    createdTask,
    sourceIssueId: task.sourceData.sourceIssueId,
    sourceDomain: task.sourceData.sourceDomain,
  };
}

export async function reviewOntologyTaskHistory(pool, options = {}) {
  const tenantId = options.tenantId || 'default';
  const storeId = clean(options.storeId, 200);
  const reportType = clean(options.reportType, 120);
  const sourceIssueId = clean(options.sourceIssueId, 120);
  const days = Math.max(1, Number(options.days || 30));
  const result = await pool.query(
    `SELECT task_id, title, status, assignee_role, assignee_username, created_at, updated_at, source_data
       FROM master_tasks
      WHERE tenant_id = $1
        AND source = 'ontology_business'
        AND ($2::text = '' OR store = $2)
        AND ($3::text = '' OR source_data->>'sourceReportType' = $3)
        AND ($4::text = '' OR source_data->>'sourceIssueId' = $4)
        AND created_at >= NOW() - ($5::int * INTERVAL '1 day')
      ORDER BY created_at DESC
      LIMIT 50`,
    [tenantId, storeId, reportType, sourceIssueId, days]
  );
  const rows = result.rows || [];
  const completed = rows.filter(r => ['done', 'closed', 'completed', 'resolved', 'settled'].includes(String(r.status)));
  const withReview = completed.filter(r => r.source_data?.resultReview?.actualMetrics || r.source_data?.resultReview?.actualResult);
  return {
    resultReviewStatus: withReview.length ? 'improved' : 'insufficient_data',
    tasksCreated: rows.length,
    tasksCompleted: completed.length,
    tasks: rows,
    summary: rows.length
      ? (withReview.length
        ? `上期动作已有 ${rows.length} 个任务，完成 ${completed.length} 个，已记录复盘结果。`
        : '上期动作已有记录，但当前追踪数据不足，暂无法判断改善结果。')
      : '上期暂无由经营语义层创建的任务。',
  };
}
