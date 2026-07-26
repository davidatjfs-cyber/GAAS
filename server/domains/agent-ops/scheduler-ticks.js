/**
 * Agent scheduler ticks — P5.4 extract from agents.js startAgentScheduler.
 */
export async function runAuditTick(deps) {
  const {
    pool, tenantContext, getActiveTenantIds, runDataAuditor, pushIssuesToFeishu,
    pushIssueToAssignee, pushScoresToFeishu, log,
  } = deps;
  for (const tenantId of await getActiveTenantIds(pool())) {
    await tenantContext.run(tenantId, async () => {
    try {
      const result = await runDataAuditor('daily', tenantId);
      if (result.issuesCreated > 0) {
        log.info(`[scheduler] Data Auditor(daily,${tenantId}): ${result.issuesCreated} new issues`);
      }
      try {
        const { syncDataAuditorIssuesToMasterTasks } = await import('./master-agent.js');
        const n = await syncDataAuditorIssuesToMasterTasks(result.newIssueIds || [], tenantId);
        if (n > 0) log.info(`[scheduler] Data Auditor(daily,${tenantId}): synced ${n} to master_tasks`);
      } catch (e) {
        log.error('[scheduler] daily master sync:', e?.message);
      }
      const pushed = await pushIssuesToFeishu(tenantId);
      if (pushed > 0) log.info(`[scheduler] Pushed(${tenantId}) ${pushed} issues to Feishu`);
    } catch (e) {
      log.error(`[scheduler] audit tick error (tenant=${tenantId}):`, e?.message);
    }
  });
  }
};

// Weekly audit: Mon 00:00 CST
export async function runWeeklyAuditTick(deps) {
  const {
    pool, tenantContext, getActiveTenantIds, runDataAuditor, pushIssuesToFeishu,
    pushIssueToAssignee, pushScoresToFeishu, log,
  } = deps;
  for (const tenantId of await getActiveTenantIds(pool())) {
    await tenantContext.run(tenantId, async () => {
    try {
      const c = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Shanghai'}));
      if (c.getDay()===1 && c.getHours()===0) {
        log.info(`[scheduler] Weekly audit(${tenantId}) running...`);
        const r = await runDataAuditor('weekly', tenantId);
        log.info(`[scheduler] Weekly audit(${tenantId}): ${r.issuesCreated} issues`);
        await pushIssuesToFeishu(tenantId);
        try {
          const { syncDataAuditorIssuesToMasterTasks } = await import('./master-agent.js');
          const n = await syncDataAuditorIssuesToMasterTasks(r.newIssueIds || [], tenantId);
          if (n > 0) log.info(`[scheduler] Weekly audit(${tenantId}): synced ${n} issues to master_tasks`);
        } catch (e) {
          log.error('[scheduler] weekly master sync:', e?.message);
        }
      }
    } catch(e){ log.error(`[scheduler] weekly audit err (tenant=${tenantId}):`, e?.message); }
  });
  }
};

// Legacy weekly evaluation (Monday 9am) — 已停用。
// 真实周评仅允许 agents-service-v2 的 anomaly_rollups_v2 写入和推送；
// 此处若继续跑 runChiefEvaluator(2026-Wxx) 会重新制造错误的 new_model 周评行。
export async function runEvalTick(deps) {
  const {
    pool, tenantContext, getActiveTenantIds, runDataAuditor, pushIssuesToFeishu,
    pushIssueToAssignee, pushScoresToFeishu, log,
  } = deps;
  try {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 9) {
      log.info('[scheduler] Chief Evaluator weekly legacy disabled; anomaly_rollups_v2 owns weekly performance');
    }
  } catch (e) {
    log.error('[scheduler] eval tick error:', e?.message);
  }
};

// OP Agent: 每周一早上10点督办周异常（实收营收、人效值、桌访产品、桌访占比、产品/服务差评）
export async function runWeeklyOpsTick(deps) {
  const {
    pool, tenantContext, getActiveTenantIds, runDataAuditor, pushIssuesToFeishu,
    pushIssueToAssignee, pushScoresToFeishu, log,
  } = deps;
  for (const tenantId of await getActiveTenantIds(pool())) {
    await tenantContext.run(tenantId, async () => {
    try {
      const now = new Date();
      // 周一且10点执行
      if (now.getDay() === 1 && now.getHours() === 10 && now.getMinutes() < 5) {
        log.info(`[scheduler] OP Agent(${tenantId}): 开始督办周异常...`);

        // 查询过去7天的周异常（未解决的）
        const weeklyCategories = [
          '实收营收异常',
          '人效值异常',
          '桌访产品异常',
          '桌访占比异常',
          '产品差评异常',
          '服务差评异常'
        ];

        const result = await pool().query(
          `SELECT * FROM agent_issues
           WHERE category = ANY($1)
             AND status != 'resolved'
             AND created_at >= NOW() - INTERVAL '7 days'
             AND tenant_id = $2
           ORDER BY store, category`,
          [weeklyCategories, tenantId]
        );

        if (result.rows?.length > 0) {
          log.info(`[scheduler] OP Agent(${tenantId}): 发现 ${result.rows.length} 条周异常待督办`);

          // 按门店分组并发送督办通知
          const byStore = {};
          for (const issue of result.rows) {
            if (!byStore[issue.store]) byStore[issue.store] = [];
            byStore[issue.store].push(issue);
          }

          for (const [store, issues] of Object.entries(byStore)) {
            const issueList = issues.map(i => `• ${i.category}(${i.severity}): ${i.title}`).join('\n');
            const message = `【OP周督办 - ${store}】\n\n门店本周有以下异常需整改：\n\n${issueList}\n\n请在今日内提交整改方案。`;

            // 发送给店长/出品经理
            for (const issue of issues) {
              try {
                await pushIssueToAssignee(issue, message, tenantId);
              } catch (e) {
                log.error(`[scheduler] OP周督办推送失败: ${issue.assignee_username}`, e?.message);
              }
            }
          }
        } else {
          log.info(`[scheduler] OP Agent(${tenantId}): 本周无周异常需督办`);
        }
      }
    } catch (e) {
      log.error(`[scheduler] OP周督办 tick error (tenant=${tenantId}):`, e?.message);
    }
  });
  }
};

// OP Agent: 每天早上10点督办充值异常
export async function runDailyRechargeTick(deps) {
  const {
    pool, tenantContext, getActiveTenantIds, runDataAuditor, pushIssuesToFeishu,
    pushIssueToAssignee, pushScoresToFeishu, log,
  } = deps;
  for (const tenantId of await getActiveTenantIds(pool())) {
    await tenantContext.run(tenantId, async () => {
    try {
      const now = new Date();
      // 每天10点执行（分钟数<5避免重复执行）
      if (now.getHours() === 10 && now.getMinutes() < 5) {
        log.info(`[scheduler] OP Agent(${tenantId}): 开始督办充值异常...`);

        // 查询过去24小时的充值异常（未解决的）
        const result = await pool().query(
          `SELECT * FROM agent_issues
           WHERE category = '充值异常'
             AND status != 'resolved'
             AND created_at >= NOW() - INTERVAL '24 hours'
             AND tenant_id = $1
           ORDER BY store`,
          [tenantId]
        );

        if (result.rows?.length > 0) {
          log.info(`[scheduler] OP Agent(${tenantId}): 发现 ${result.rows.length} 条充值异常待督办`);

          // 按门店分组
          const byStore = {};
          for (const issue of result.rows) {
            if (!byStore[issue.store]) byStore[issue.store] = [];
            byStore[issue.store].push(issue);
          }

          for (const [store, issues] of Object.entries(byStore)) {
            const highCount = issues.filter(i => i.severity === 'high').length;
            const mediumCount = issues.filter(i => i.severity === 'medium').length;
            const message = `【OP日督办 - ${store}】\n\n门店今日充值异常：\n• 高风险: ${highCount} 条\n• 中风险: ${mediumCount} 条\n\n请立即检查充值系统并提交整改方案。`;

            // 发送给店长
            for (const issue of issues) {
              try {
                await pushIssueToAssignee(issue, message, tenantId);
              } catch (e) {
                log.error(`[scheduler] OP日督办推送失败: ${issue.assignee_username}`, e?.message);
              }
            }
          }
        } else {
          log.info(`[scheduler] OP Agent(${tenantId}): 今日无充值异常需督办`);
        }
      }
    } catch (e) {
      log.error(`[scheduler] OP日督办 tick error (tenant=${tenantId}):`, e?.message);
    }
  });
  }
};

// Retry pushing un-notified items every 5 minutes
export async function runPushTick(deps) {
  const {
    pool, tenantContext, getActiveTenantIds, runDataAuditor, pushIssuesToFeishu,
    pushIssueToAssignee, pushScoresToFeishu, log,
  } = deps;
  for (const tenantId of await getActiveTenantIds(pool())) {
    await tenantContext.run(tenantId, async () => {
    try {
      const pushedIssues = await pushIssuesToFeishu(tenantId);
      const pushedScores = await pushScoresToFeishu();
      if (pushedIssues || pushedScores) {
        log.info(`[scheduler] Push retry(${tenantId}): ${pushedIssues} issues, ${pushedScores} scores`);
      }
    } catch (e) { /* ignore */ }
  });
  }
};

