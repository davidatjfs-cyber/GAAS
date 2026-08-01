/**
 * Master orchestration tick builders (P4 peel from master-agent.js).
 */

/**
 * @param {Function} tenantTick
 * @param {{
 *   pool: () => { query: Function },
 *   dataAuditorListener: (tenantId: string) => Promise<number>,
 *   transitionTask: Function,
 *   log: { info: Function },
 * }} deps
 */
export function buildAuditTick(tenantTick, deps) {
  const { pool, dataAuditorListener, transitionTask, log } = deps;
  return tenantTick('Data Auditor created', async (tenantId) => {
    const created = await dataAuditorListener(tenantId);
    const manualTasks = await pool().query(
      `SELECT * FROM master_tasks
       WHERE status = 'pending_audit'
       AND source IN ('manual_campaign', 'manual', 'hq_planning')
       AND tenant_id = $1
       ORDER BY created_at ASC LIMIT 5`,
      [tenantId]
    );
    for (const task of manualTasks.rows || []) {
      await transitionTask(task.task_id, 'pending_dispatch', 'data_auditor', {
        audit_result: {
          approved: true,
          reason: '手动创建任务自动通过审计',
          timestamp: new Date().toISOString(),
        },
      }, tenantId);
      log.info(`[master:audit] Auto-approved manual task ${task.task_id}`);
    }
    return created;
  }, { formatMessage: (n) => `${n} tasks` });
}

/**
 * @param {Function} tenantTick
 * @param {{
 *   pool: () => { query: Function },
 *   masterDispatcher: (tenantId: string) => Promise<number>,
 * }} deps
 */
export function buildDispatchTick(tenantTick, deps) {
  const { pool, masterDispatcher } = deps;
  return tenantTick('Dispatched', async (tenantId) => {
    await pool().query(`
      UPDATE master_tasks
      SET severity = CASE
        WHEN severity = 'low' THEN 'medium'
        WHEN severity = 'medium' THEN 'high'
        ELSE severity
      END,
      escalation_level = escalation_level + 1,
      escalation_history = COALESCE(escalation_history, '[]'::jsonb) ||
        jsonb_build_object(
          'timestamp', NOW()::text,
          'from', severity,
          'to', CASE WHEN severity = 'low' THEN 'medium' WHEN severity = 'medium' THEN 'high' ELSE severity END,
          'reason', '任务超时自动升级'
        )::jsonb
      WHERE status IN ('pending_dispatch', 'dispatched', 'pending_response')
      AND timeout_at IS NOT NULL
      AND timeout_at < NOW()
      AND escalation_level < 3
      AND tenant_id = $1
    `, [tenantId]);
    return masterDispatcher(tenantId);
  }, { formatMessage: (n) => `${n} tasks` });
}

/**
 * Build the interval schedule array for registerMasterIntervals.
 * @param {Record<string, Function>} ticks
 */
export function buildMasterIntervalSchedule(ticks) {
  return [
    { name: 'master_audit_tick', fn: ticks.auditTick, intervalMs: 15 * 1000, startupDelayMs: 10 * 1000 },
    { name: 'master_dispatch_tick', fn: ticks.dispatchTick, intervalMs: 15 * 1000, startupDelayMs: 15 * 1000 },
    { name: 'master_ops_tick', fn: ticks.opsTick, intervalMs: 20 * 1000, startupDelayMs: 20 * 1000 },
    { name: 'master_post_res_tick', fn: ticks.postResTick, intervalMs: 20 * 1000, startupDelayMs: 25 * 1000 },
    { name: 'master_eval_tick', fn: ticks.evalTick, intervalMs: 30 * 1000, startupDelayMs: 30 * 1000 },
    { name: 'master_final_tick', fn: ticks.finalTick, intervalMs: 30 * 1000, startupDelayMs: 35 * 1000 },
    { name: 'master_train_tick', fn: ticks.trainTick, intervalMs: 60 * 1000, startupDelayMs: 40 * 1000 },
    { name: 'master_issues_tick', fn: ticks.issuesTick, intervalMs: 30 * 1000, startupDelayMs: 45 * 1000 },
    { name: 'master_train_dispatch_tick', fn: ticks.trainDispatchTick, intervalMs: 10 * 60 * 1000, startupDelayMs: 50 * 1000 },
    { name: 'master_optimization_tick', fn: ticks.optimizationTick, intervalMs: 60 * 1000, startupDelayMs: 55 * 1000 },
    { name: 'master_task_response_tick', fn: ticks.taskResponseTick, intervalMs: 60 * 1000, startupDelayMs: 60 * 1000 },
    { name: 'master_kg_health_tick', fn: ticks.kgHealthTick, intervalMs: 6 * 60 * 60 * 1000, startupDelayMs: 90 * 1000 },
    { name: 'master_inspection_loop_tick', fn: ticks.inspectionLoopTick, intervalMs: 15 * 60 * 1000, startupDelayMs: 120 * 1000 },
    { name: 'master_bi_push_tick', fn: ticks.biPushTick, intervalMs: 15 * 60 * 1000, startupDelayMs: 150 * 1000 },
    { name: 'master_labor_tick', fn: ticks.laborTick, intervalMs: 15 * 60 * 1000, startupDelayMs: 180 * 1000 },
    { name: 'master_training_loop_tick', fn: ticks.trainingLoopTick, intervalMs: 15 * 60 * 1000, startupDelayMs: 210 * 1000 },
  ];
}
