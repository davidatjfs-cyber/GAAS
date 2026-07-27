/**
 * Data Auditor / Ops Agent 质量检查 helpers (P17 peel from agents.js).
 */

async function getLastSyncTime(_configKey) {
  // 这里可以实现实际的同步时间检查逻辑
  // 暂时返回当前时间减去随机延迟
  return Date.now() - Math.random() * 5 * 60 * 1000;
}

// Data Auditor 数据源质量检查
async function checkDataSourceQuality(deps) {
  const {
    refreshBiAgentRuntimeConfig,
    safeExecute,
    safeErrorLog,
    isBiSourceEnabled,
    getSharedState,
    AgentCommunicationHelper,
    bitableConfigs,
  } = deps;
  await refreshBiAgentRuntimeConfig();
  return safeExecute('data_auditor_quality_check', async () => {
    const issues = [];

    // 检查 Bitable 数据同步状态
    try {
      const sourceKeyByConfig = {
        ops_checklist: 'ops_checklist_bitable',
        table_visit: 'table_visit_bitable',
        opening_reports: 'opening_reports_bitable',
        closing_reports: 'closing_reports_bitable',
        meeting_reports: 'meeting_reports_bitable',
        material_majixian: 'material_majixian_bitable',
        material_hongchao: 'material_hongchao_bitable'
      };
      for (const [configKey, config] of Object.entries(bitableConfigs)) {
        const sourceKey = sourceKeyByConfig[configKey];
        if (sourceKey && !isBiSourceEnabled(sourceKey)) continue;
        const lastSync = await getLastSyncTime(configKey);
        const syncAge = Date.now() - lastSync;

        // 如果超过10分钟没有同步，报告问题
        if (syncAge > 10 * 60 * 1000) {
          await safeExecute('data_source_issue_report', async () => {
            await AgentCommunicationHelper.reportDataSourceIssue(
              configKey,
              `Bitable ${config.name} 数据同步超时`,
              `最后同步时间: ${new Date(lastSync).toLocaleString()}`,
              '建议检查网络连接和API配置'
            );
          });
          issues.push(configKey);
        }
      }
    } catch (error) {
      safeErrorLog('data_auditor_bitable_sync', error);
    }

    // 检查数据完整性
    try {
      const state = await getSharedState();
      const reportCount = Array.isArray(state?.dailyReports) ? state.dailyReports.length : 0;

      if (isBiSourceEnabled('daily_reports') && reportCount < 100) {
        await safeExecute('data_completeness_report', async () => {
          await AgentCommunicationHelper.reportDataSourceIssue(
            'daily_reports',
            `营业数据量不足: ${reportCount} 条记录`,
            '可能影响异常检测准确性',
            '建议检查数据采集机制'
          );
        });
        issues.push('daily_reports');
      }
    } catch (error) {
      safeErrorLog('data_auditor_completeness', error);
    }

    return issues;
  }, []);
}

async function getRecentAuditCount(deps, storeName, days) {
  const { pool, log } = deps;
  try {
    const result = await pool().query(`
      SELECT COUNT(*) as count 
      FROM agent_visual_audits 
      WHERE store = $1 
        AND created_at >= NOW() - make_interval(days => $2)
    `, [storeName, Math.max(1, Math.floor(Number(days) || 7))]);

    return Number(result.rows[0]?.count || 0);
  } catch (error) {
    log.error('[ops_agent] Failed to get audit count:', error);
    return 0;
  }
}

// Ops Agent 任务执行质量检查
async function checkTaskExecutionQuality(deps, storeName, brand, failedCount, duplicateCount) {
  const { safeExecute, AgentCommunicationHelper } = deps;
  return safeExecute('ops_agent_quality_check', async () => {
    // 如果失败率过高，报告问题
    const totalAudits = await getRecentAuditCount(deps, storeName, 7); // 最近7天
    const failureRate = totalAudits > 0 ? failedCount / totalAudits : 0;

    if (failureRate > 0.15) { // 失败率超过15%
      await safeExecute('task_execution_issue_report', async () => {
        await AgentCommunicationHelper.reportTaskExecutionIssue(
          '图片审核',
          `图片审核失败率过高: ${(failureRate * 100).toFixed(1)}%`,
          failureRate,
          '建议优化审核算法或增加人工复核'
        );
      });
    }

    // 如果重复图片过多，报告问题
    const duplicateRate = totalAudits > 0 ? duplicateCount / totalAudits : 0;
    if (duplicateRate > 0.10) { // 重复率超过10%
      await safeExecute('duplicate_image_issue_report', async () => {
        await AgentCommunicationHelper.reportTaskExecutionIssue(
          '图片审核',
          `重复图片率过高: ${(duplicateRate * 100).toFixed(1)}%`,
          duplicateRate,
          '建议加强反作弊机制和用户教育'
        );
      });
    }
  });
}

/**
 * @param {object} deps
 */
export function createQualityChecksApi(deps) {
  return {
    checkDataSourceQuality: () => checkDataSourceQuality(deps),
    checkTaskExecutionQuality: (storeName, brand, failedCount, duplicateCount) =>
      checkTaskExecutionQuality(deps, storeName, brand, failedCount, duplicateCount),
    getLastSyncTime,
    getRecentAuditCount: (storeName, days) => getRecentAuditCount(deps, storeName, days),
  };
}
