/**
 * Agent 间沟通和优化系统
 * 支持Agent向Master报告问题，Master协调优化
 */

// 使用现有的数据库连接
import { pool } from './master-agent.js';
import { resolveTenantIdDefault, tenantContext } from './utils/database.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'agent-communication' });

// ─────────────────────────────────────────────
// 1. 问题类型定义
// ─────────────────────────────────────────────
export const AGENT_ISSUE_TYPES = {
  // 数据源问题
  DATA_SOURCE_INSUFFICIENT: {
    category: 'data_source',
    severity: 'medium',
    description: '数据源不足',
    responsibleAgent: 'data_auditor',
    escalationRequired: false
  },
  DATA_SOURCE_QUALITY: {
    category: 'data_source',
    severity: 'high',
    description: '数据源质量问题',
    responsibleAgent: 'data_auditor',
    escalationRequired: true
  },
  DATA_SOURCE_MISSING: {
    category: 'data_source',
    severity: 'high',
    description: '缺少关键数据源',
    responsibleAgent: 'data_auditor',
    escalationRequired: true
  },
  
  // 评分规则问题
  SCORING_RULE_INCOMPLETE: {
    category: 'scoring_rule',
    severity: 'medium',
    description: '评分规则不完整',
    responsibleAgent: 'chief_evaluator',
    escalationRequired: false
  },
  SCORING_RULE_CONFLICT: {
    category: 'scoring_rule',
    severity: 'high',
    description: '评分规则冲突',
    responsibleAgent: 'chief_evaluator',
    escalationRequired: true
  },
  
  // 知识库问题
  KNOWLEDGE_BASE_OUTDATED: {
    category: 'knowledge_base',
    severity: 'medium',
    description: '知识库内容过时',
    responsibleAgent: 'train_advisor',
    escalationRequired: false
  },
  KNOWLEDGE_BASE_MISSING: {
    category: 'knowledge_base',
    severity: 'high',
    description: '缺少关键知识',
    responsibleAgent: 'train_advisor',
    escalationRequired: true
  },
  
  // 任务执行问题
  TASK_EXECUTION_BOTTLENECK: {
    category: 'task_execution',
    severity: 'medium',
    description: '任务执行瓶颈',
    responsibleAgent: 'ops_supervisor',
    escalationRequired: false
  },
  TASK_EXECUTION_FAILURE: {
    category: 'task_execution',
    severity: 'high',
    description: '任务执行失败',
    responsibleAgent: 'ops_supervisor',
    escalationRequired: true
  },
  
  // 系统性能问题
  SYSTEM_PERFORMANCE: {
    category: 'system_performance',
    severity: 'medium',
    description: '系统性能问题',
    responsibleAgent: 'master',
    escalationRequired: false
  },
  SYSTEM_ERROR: {
    category: 'system_performance',
    severity: 'high',
    description: '系统错误',
    responsibleAgent: 'master',
    escalationRequired: true
  }
};

// ─────────────────────────────────────────────
// 2. Agent 沟通接口
// ─────────────────────────────────────────────
export class AgentCommunicationSystem {
  static resolveIssueTenantId(details = {}, context = {}) {
    return resolveTenantIdDefault(
      context?.tenant_id ||
      context?.tenantId ||
      details?.tenant_id ||
      details?.tenantId
    );
  }
  
  /**
   * Agent 向 Master 报告问题
   */
  static async reportIssue(agentType, issueType, details, context = {}) {
    // 校验 issueType 合法性，避免 undefined.severity 抛 TypeError
    if (!AGENT_ISSUE_TYPES[issueType]) {
      log.error({ msg: 'unknown_issue_type', issue_type: issueType });
      return { success: false, error: `unknown_issue_type: ${issueType}` };
    }

    const issueId = this.generateIssueId();
    const timestamp = new Date().toISOString();
    const tenantId = this.resolveIssueTenantId(details, context);

    try {
      await tenantContext.run(tenantId, async () => {
        // 记录问题到数据库
        await pool().query(`
          INSERT INTO agent_issues_reports (
            issue_id, agent_type, issue_type, details, context,
            status, severity, created_at, updated_at, tenant_id
          ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6, $7, $7, $8)
        `, [
          issueId,
          agentType,
          issueType,
          JSON.stringify(details),
          JSON.stringify(context),
          AGENT_ISSUE_TYPES[issueType].severity,
          timestamp,
          tenantId
        ]);
        
        // 发送事件通知 Master
        try {
          // 直接记录到 master_events 表
          await pool().query(
            `INSERT INTO master_events (task_id, event_type, from_agent, to_agent, status_before, status_after, payload, tenant_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
            [issueId, 'agent_issue_reported', agentType, 'master', null, 'pending', JSON.stringify({
              issueType,
              details,
              context,
              severity: AGENT_ISSUE_TYPES[issueType].severity
            }), tenantId]
          );
        } catch (e) {
          log.error({ msg: 'emit_event_failed', err: e?.message });
        }
      });
      
      log.info({ msg: 'issue_reported', agent_type: agentType, issue_type: issueType, issue_id: issueId });
      
      return {
        success: true,
        issueId,
        message: '问题已报告，Master 将协调处理'
      };
      
    } catch (error) {
      log.error({ msg: 'report_issue_failed', err: error?.message || String(error) });
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Master 分配问题给责任 Agent
   */
  static async assignIssue(issueId, assignedAgent, priority = 'normal', deadline = null) {
    try {
      await pool().query(`
        UPDATE agent_issues_reports 
        SET assigned_agent = $1, status = 'assigned', priority = $2, deadline = $3, updated_at = NOW()
        WHERE issue_id = $4
      `, [assignedAgent, priority, deadline, issueId]);
      
      // 通知责任 Agent
      await this.notifyAgent(assignedAgent, {
        type: 'issue_assigned',
        issueId,
        priority,
        deadline,
        message: `Master 分配了新问题需要处理: ${issueId}`
      });
      
      log.info({ msg: 'issue_assigned', issue_id: issueId, assigned_agent: assignedAgent });
      
      return { success: true };
      
    } catch (error) {
      log.error({ msg: 'assign_issue_failed', err: error?.message || String(error) });
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Agent 更新问题处理状态
   */
  static async updateIssueStatus(issueId, agentType, status, updateDetails = {}) {
    try {
      await pool().query(`
        UPDATE agent_issues_reports 
        SET status = $1, updated_at = NOW(), update_details = $2::jsonb
        WHERE issue_id = $3 AND assigned_agent = $4
      `, [status, JSON.stringify(updateDetails), issueId, agentType]);
      
      // 发送状态更新事件
      try {
        // 直接记录到 master_events 表
        await pool().query(
          `INSERT INTO master_events (task_id, event_type, from_agent, to_agent, status_before, status_after, payload, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [issueId, 'issue_status_updated', agentType, 'master', status, status, JSON.stringify(updateDetails), resolveTenantIdDefault()]
        );
      } catch (e) {
        log.error({ msg: 'emit_event_failed', err: e?.message });
      }
      
      log.info({ msg: 'issue_status_updated', agent_type: agentType, issue_id: issueId, status });
      
      return { success: true };
      
    } catch (error) {
      log.error({ msg: 'update_issue_status_failed', err: error?.message || String(error) });
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Agent 提交优化方案
   */
  static async submitOptimizationPlan(issueId, agentType, plan, expectedImpact, implementationTime) {
    try {
      await pool().query(`
        UPDATE agent_issues_reports 
        SET optimization_plan = $1::jsonb, expected_impact = $2, implementation_time = $3, 
            status = 'optimization_proposed', updated_at = NOW()
        WHERE issue_id = $4 AND assigned_agent = $5
      `, [JSON.stringify(plan), expectedImpact, implementationTime, issueId, agentType]);
      
      // 通知 Master 审核方案
      await this.notifyAgent('master', {
        type: 'optimization_proposed',
        issueId,
        agentType,
        plan,
        expectedImpact,
        implementationTime,
        message: `${agentType} 提交了优化方案，请审核`
      });
      
      log.info({ msg: 'optimization_plan_submitted', agent_type: agentType, issue_id: issueId });
      
      return { success: true };
      
    } catch (error) {
      log.error({ msg: 'submit_optimization_plan_failed', err: error?.message || String(error) });
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Master 审核并批准优化方案
   */
  static async approveOptimization(issueId, approvedBy, notes = '') {
    try {
      await pool().query(`
        UPDATE agent_issues_reports 
        SET status = 'optimization_approved', approved_by = $1, approval_notes = $2, 
            approved_at = NOW(), updated_at = NOW()
        WHERE issue_id = $3
      `, [approvedBy, notes, issueId]);
      
      // 获取问题详情通知相关 Agent
      const issueResult = await pool().query(`
        SELECT agent_type, assigned_agent, optimization_plan 
        FROM agent_issues_reports WHERE issue_id = $1
      `, [issueId]);
      
      const issue = issueResult.rows[0];
      if (issue) {
        // 通知原始报告 Agent
        await this.notifyAgent(issue.agent_type, {
          type: 'optimization_approved',
          issueId,
          approvedBy,
          notes,
          message: `Master 批准了优化方案: ${issueId}`
        });
        
        // 通知执行 Agent
        if (issue.assigned_agent !== issue.agent_type) {
          await this.notifyAgent(issue.assigned_agent, {
            type: 'optimization_approved',
            issueId,
            plan: issue.optimization_plan,
            message: `请执行已批准的优化方案: ${issueId}`
          });
        }
      }
      
      log.info({ msg: 'optimization_approved', issue_id: issueId });
      
      return { success: true };
      
    } catch (error) {
      log.error({ msg: 'approve_optimization_failed', err: error?.message || String(error) });
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Agent 报告优化完成
   */
  static async reportOptimizationComplete(issueId, agentType, results, metrics = {}) {
    try {
      await pool().query(`
        UPDATE agent_issues_reports 
        SET status = 'completed', optimization_results = $1::jsonb, metrics = $2::jsonb,
            completed_at = NOW(), updated_at = NOW()
        WHERE issue_id = $3 AND assigned_agent = $4
      `, [JSON.stringify(results), JSON.stringify(metrics), issueId, agentType]);
      
      // 通知 Master 和相关 Agent
      await this.notifyAgent('master', {
        type: 'optimization_completed',
        issueId,
        agentType,
        results,
        metrics,
        message: `${agentType} 完成了优化: ${issueId}`
      });
      
      log.info({ msg: 'optimization_completed', agent_type: agentType, issue_id: issueId });
      
      return { success: true };
      
    } catch (error) {
      log.error({ msg: 'report_optimization_completion_failed', err: error?.message || String(error) });
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 通知特定 Agent
   */
  static async notifyAgent(agentType, notification) {
    try {
      // 记录通知到数据库
      await pool().query(`
        INSERT INTO agent_notifications (
          agent_type, notification_type, content, created_at, read_status, tenant_id
        ) VALUES ($1, $2, $3::jsonb, NOW(), false, $4)
      `, [agentType, notification.type, JSON.stringify(notification), resolveTenantIdDefault()]);
      
      // 如果是飞书用户，发送飞书通知
      if (agentType === 'ops_supervisor' || agentType === 'data_auditor') {
        // 这里可以集成飞书通知逻辑
        log.info({ msg: 'feishu_notification_stub', agent_type: agentType, message: notification.message });
      }
      
      return { success: true };
      
    } catch (error) {
      log.error({ msg: 'notify_agent_failed', err: error?.message || String(error) });
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 获取 Agent 待处理问题
   */
  static async getAgentIssues(agentType, status = 'assigned') {
    try {
      const result = await pool().query(`
        SELECT * FROM agent_issues_reports 
        WHERE assigned_agent = $1 AND status = $2
        ORDER BY created_at DESC
      `, [agentType, status]);
      
      return result.rows || [];
      
    } catch (error) {
      log.error({ msg: 'get_agent_issues_failed', err: error?.message || String(error) });
      return [];
    }
  }
  
  /**
   * 获取问题统计
   */
  static async getIssueStatistics(timeRange = '7d') {
    try {
      // C1-FIX: 白名单校验防止SQL注入
      const ALLOWED_RANGES = { '1d': '1 day', '7d': '7 days', '30d': '30 days', '90d': '90 days' };
      const interval = ALLOWED_RANGES[timeRange] || '7 days';
      const result = await pool().query(`
        SELECT 
          issue_type,
          agent_type,
          status,
          severity,
          COUNT(*) as count,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as avg_resolution_hours
        FROM agent_issues_reports 
        WHERE created_at >= NOW() - INTERVAL '${interval}'
        GROUP BY issue_type, agent_type, status, severity
        ORDER BY count DESC
      `);
      
      return result.rows || [];
      
    } catch (error) {
      log.error({ msg: 'get_issue_statistics_failed', err: error?.message || String(error) });
      return [];
    }
  }
  
  /**
   * 生成问题ID
   */
  static generateIssueId() {
    return `ISSUE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 兼容接口：部分调用方直接使用 AgentCommunicationSystem.reportTaskExecutionIssue
   * 支持两种调用风格：
   * 1) (taskType, bottleneck, failureRate:number, suggestedImprovement)
   * 2) (taskType, bottleneck, details:object)
   */
  static async reportTaskExecutionIssue(taskType, bottleneck, failureRateOrDetails, suggestedImprovement = '') {
    const isDetailsObject = failureRateOrDetails && typeof failureRateOrDetails === 'object';
    const normalizedDetails = isDetailsObject
      ? {
          taskType,
          bottleneck,
          ...failureRateOrDetails,
          suggestedImprovement: failureRateOrDetails.suggestedImprovement || suggestedImprovement
        }
      : {
          taskType,
          bottleneck,
          failureRate: Number(failureRateOrDetails || 0),
          suggestedImprovement
        };

    return await AgentCommunicationSystem.reportIssue(
      'ops_supervisor',
      'TASK_EXECUTION_BOTTLENECK',
      normalizedDetails,
      {
        timestamp: new Date().toISOString(),
        agent: 'ops_supervisor',
        source: 'compat_api'
      }
    );
  }

  /**
   * 兼容接口：允许调用方继续使用 AgentCommunicationSystem.reportDataSourceIssue
   */
  static async reportDataSourceIssue(dataSourceType, problem, impact, suggestedFix) {
    return await AgentCommunicationHelper.reportDataSourceIssue(
      dataSourceType,
      problem,
      impact,
      suggestedFix
    );
  }
}

// ─────────────────────────────────────────────
// 3. Agent 沟通助手函数
// ─────────────────────────────────────────────
export class AgentCommunicationHelper {
  
  /**
   * Data Auditor 报告数据源问题
   */
  static async reportDataSourceIssue(dataSourceType, problem, impact, suggestedFix) {
    const source = String(dataSourceType || '').trim();
    const store = String((impact && typeof impact === 'object' ? impact.store : '') || '').trim();
    const tenantId = AgentCommunicationSystem.resolveIssueTenantId(
      impact && typeof impact === 'object' ? impact : {},
      { tenant_id: impact && typeof impact === 'object' ? (impact.tenant_id || impact.tenantId) : '' }
    );

    // 限流：同一数据源 + 同一门店（门店未知则按全局）24小时内仅报告一次
    try {
      const existing = await tenantContext.run(tenantId, async () => {
        const dedup = await pool().query(
          `SELECT issue_id, created_at
             FROM agent_issues_reports
            WHERE agent_type = 'data_auditor'
              AND issue_type = 'DATA_SOURCE_INSUFFICIENT'
              AND COALESCE(details::jsonb->>'dataSourceType', '') = $1
              AND COALESCE(context->>'store', '') = $2
              AND created_at >= NOW() - INTERVAL '24 hours'
            ORDER BY created_at DESC
            LIMIT 1`,
          [source, store]
        );
        return dedup.rows?.[0];
      });
      if (existing) {
        return {
          success: true,
          suppressed: true,
          reason: 'dedup_24h',
          issueId: String(existing.issue_id || ''),
          firstReportedAt: existing.created_at
        };
      }
    } catch (e) {
      log.error({ msg: 'report_data_source_issue_dedup_failed', err: e?.message || String(e) });
      // 限流检查失败不阻断主流程
    }

    const currentStatus = await tenantContext.run(tenantId, () => this.getDataSourceStatus(source));  // await async method
    return await AgentCommunicationSystem.reportIssue(
      'data_auditor',
      'DATA_SOURCE_INSUFFICIENT',
      {
        dataSourceType: source,
        problem,
        impact,
        suggestedFix,
        currentStatus,
      },
      {
        timestamp: new Date().toISOString(),
        agent: 'data_auditor',
        store,
        dedupWindow: '24h'
      }
    );
  }
  
  /**
   * Ops Agent 报告任务执行问题
   */
  static async reportTaskExecutionIssue(taskType, bottleneck, failureRate, suggestedImprovement) {
    const tenantId = resolveTenantIdDefault();
    const currentMetrics = await tenantContext.run(tenantId, () => this.getTaskExecutionMetrics(taskType));
    return await AgentCommunicationSystem.reportIssue(
      'ops_supervisor',
      'TASK_EXECUTION_BOTTLENECK',
      { taskType, bottleneck, failureRate, suggestedImprovement, currentMetrics },
      { timestamp: new Date().toISOString(), agent: 'ops_supervisor' }
    );
  }

  /**
   * Train Agent 报告知识库问题
   */
  static async reportKnowledgeBaseIssue(knowledgeArea, missingTopics, outdatedContent, suggestedUpdates) {
    const tenantId = resolveTenantIdDefault();
    const currentCoverage = await tenantContext.run(tenantId, () => this.getKnowledgeCoverage(knowledgeArea));
    return await AgentCommunicationSystem.reportIssue(
      'train_advisor',
      'KNOWLEDGE_BASE_OUTDATED',
      { knowledgeArea, missingTopics, outdatedContent, suggestedUpdates, currentCoverage },
      { timestamp: new Date().toISOString(), agent: 'train_advisor' }
    );
  }

  /**
   * Chief Evaluator 报告评分规则问题
   */
  static async reportScoringRuleIssue(ruleType, conflict, incompleteness, suggestedRules) {
    const tenantId = resolveTenantIdDefault();
    const currentRules = await tenantContext.run(tenantId, () => this.getCurrentScoringRules(ruleType));
    return await AgentCommunicationSystem.reportIssue(
      'chief_evaluator',
      'SCORING_RULE_INCOMPLETE',
      { ruleType, conflict, incompleteness, suggestedRules, currentRules },
      { timestamp: new Date().toISOString(), agent: 'chief_evaluator' }
    );
  }
  
  /**
   * 获取数据源状态（查近24h记录数）
   */
  static async getDataSourceStatus(dataSourceType) {
    // 白名单防止注入。sales_raw已下线(2026-07-03)，POS数据改用pos_sales_detail视图
    // (pos_order_items的同构视图)，该视图无created_at列，用checkout_time代替。
    const ALLOWED_TABLES = {
      daily_reports: 'daily_reports',
      table_visit_records: 'table_visit_records',
      sales_raw: 'pos_sales_detail',
      master_tasks: 'master_tasks',
    };
    const TIME_COLUMNS = { pos_sales_detail: 'checkout_time' };
    const table = ALLOWED_TABLES[dataSourceType];
    if (!table) return { status: 'unknown', dataSourceType };
    const timeCol = TIME_COLUMNS[table] || 'created_at';
    try {
      const r = await pool().query(
        `SELECT COUNT(*) AS cnt, MAX(${timeCol}) AS last_record FROM ${table} WHERE ${timeCol} > NOW() - INTERVAL '24 hours'`
      );
      const row = r.rows?.[0];
      return {
        lastSync: row?.last_record || null,
        status: parseInt(row?.cnt || 0) > 0 ? 'active' : 'no_recent_data',
        recordCount: parseInt(row?.cnt || 0),
      };
    } catch (e) {
      return { status: 'query_error', error: e?.message };
    }
  }

  /**
   * 获取任务执行指标（近7天 master_tasks 统计）
   */
  static async getTaskExecutionMetrics(taskType) {
    try {
      const r = await pool().query(
        `SELECT
           COUNT(*) AS total,
           COUNT(CASE WHEN status IN ('closed','resolved','settled') THEN 1 END) AS done,
           AVG(EXTRACT(EPOCH FROM (COALESCE(closed_at, updated_at) - created_at))) AS avg_secs
         FROM master_tasks
         WHERE created_at > NOW() - INTERVAL '7 days'
           AND ($1::text IS NULL OR category = $1)`,
        [taskType || null]
      );
      const row = r.rows?.[0];
      const total = parseInt(row?.total || 0);
      const done  = parseInt(row?.done  || 0);
      return {
        dailyVolume: Math.round(total / 7),
        successRate: total > 0 ? +(done / total).toFixed(3) : null,
        avgExecutionTimeSecs: row?.avg_secs ? +parseFloat(row.avg_secs).toFixed(1) : null,
        errorRate: total > 0 ? +((total - done) / total).toFixed(3) : null,
      };
    } catch (e) {
      return { error: e?.message };
    }
  }

  /**
   * 获取知识库覆盖率（查 knowledge_base 表）
   */
  static async getKnowledgeCoverage(knowledgeArea) {
    try {
      const r = await pool().query(
        `SELECT
           COUNT(*) AS total,
           COUNT(CASE WHEN enabled = TRUE THEN 1 END) AS enabled_cnt,
           MAX(updated_at) AS last_update
         FROM knowledge_base
         WHERE ($1::text IS NULL OR category = $1)`,
        [knowledgeArea || null]
      );
      const row = r.rows?.[0];
      return {
        totalTopics: parseInt(row?.total || 0),
        coveredTopics: parseInt(row?.enabled_cnt || 0),
        lastUpdate: row?.last_update || null,
      };
    } catch (e) {
      return { error: e?.message };
    }
  }

  /**
   * 获取当前评分规则数量（查 hrms_state 中的 scoringRules）
   */
  static async getCurrentScoringRules(ruleType) {
    try {
      const r = await pool().query(
        `SELECT data->'scoringRules' AS rules FROM hrms_state WHERE key = $1 LIMIT 1`,
        [resolveTenantIdDefault()]
      );
      const rules = r.rows?.[0]?.rules;
      const ruleList = Array.isArray(rules) ? rules : [];
      const filtered = ruleType ? ruleList.filter(r => r?.type === ruleType) : ruleList;
      return {
        ruleCount: filtered.length,
        lastUpdate: null, // hrms_state 无单独时间戳
      };
    } catch (e) {
      return { ruleCount: 0, error: e?.message };
    }
  }
}

export default AgentCommunicationSystem;
