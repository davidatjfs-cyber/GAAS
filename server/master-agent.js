/**
 * Master Agent — Event-Driven Orchestration Hub
 *
 * Architecture: 事件驱动（Event-Driven）+ 异步编排（Asynchronous Orchestration）
 * Master = 中转站，发送和接收信号；维护"任务状态表"，Agent 监听状态变化。
 *
 * 6 Agents:
 *   Master       (调度中枢)   — 消息路由、任务状态流转、全局上下文管理
 *   Data Auditor (数据审计)   — BI  — 核对来源数据，对异常情况触发预警
 *   Ops Agent    (营运督导)   — OP  — 飞书任务分派、到点提醒、Vision审核照片
 *   Train Agent  (培训与标准) — Train — RAG知识检索、SOP咨询、培训体系管理
 *   Chief Evaluator (绩效考核) — OKR — 自动计算奖金、评分、评级
 *   Appeal Agent (申诉处理)   — REF — 处理员工反馈，核实证据，人工介入仲裁
 *
 * 协作流程:
 *   1. 报警: Data Auditor 发现异常 → master_tasks(pending_dispatch)
 *   2. 执行: Master 调度 → Ops Agent 在飞书找责任人
 *   3. 反馈: 责任人在飞书回复文字/照片
 *   4. 判定: Ops Agent 审核反馈
 *   5. 结算: Chief Evaluator 计算绩效影响
 *   6. 推送: Master 发送最终通知
 *
 * Status Flow:
 *   pending_audit → auditing → pending_dispatch → dispatched →
 *   pending_response → pending_review → resolved/rejected →
 *   pending_settlement → settled → closed
 */

import { AGENT_ISSUE_TYPES } from './agent-communication-system.js';
import {
  sendLarkMessage,
  sendLarkCard,
  lookupFeishuUserByUsername,
  getSharedState,

  inferBrandFromStoreName,
  findStoreManager,
  callLLM,
  callVisionLLM,
  queryKnowledgeBase,
  prefixWithAgentName,
  runDataAuditor,
  writeTaskToBitable,
  getTaskResponseFormUrl,
  buildTaskDispatchCard,
  pollTaskResponseBitable
} from './agents.js';
import { AgentCommunicationSystem } from './agent-communication-system.js';
import { setPool as setUnifiedMasterPool, getActiveTenantIds, tenantContext } from './utils/database.js';
import { extractAnomalyRelations, refreshEntityHealthSnapshots, ensureKnowledgeGraphTables, setKGPool } from './knowledge-graph.js';
import { setHqPlannerPool, setHqPlannerLLM } from './hq-planner-agent.js';
import {
  setAutoOpsPool, setAutoOpsDeps,
  inspectionClosedLoopTick, biProactivePushTick,
  laborEfficiencyTick, trainingClosedLoopTick
} from './auto-ops-engine.js';
import { childLogger } from './utils/logger.js';
import { getCategoryAssigneeRoleMap } from './agent-config-manager.js';
import {
  buildReviewNotificationMessage,
  buildReviewResultPayload,
  buildTextReviewSystemPrompt,
  buildVisionReviewPrompt,
  decideReviewOutcome,
  formatSopContext,
  parseLlmValidReview,
} from './domains/master-agent/ops-review-helpers.js';
import {
  createTenantScopedTick,
  registerMasterIntervals,
} from './domains/master-agent/scheduler.js';
import { registerMasterRoutes as registerMasterRoutesImpl } from './domains/master-agent/routes.js';
import { STATUS_FLOW } from './domains/master-agent/status-flow.js';
import { createMasterTaskLifecycle } from './domains/master-agent/lifecycle-service.js';

const log = childLogger({ domain: 'master-agent' });

// ─────────────────────────────────────────────
// 0. Pool & Config
// ─────────────────────────────────────────────

let _pool = null;
export function setMasterPool(p) { 
  _pool = p; 
  setUnifiedMasterPool(p); // 同时设置统一数据库连接
  setKGPool(p);            // 知识图谱
  setHqPlannerPool(p);     // HQ决策大脑
  setHqPlannerLLM(callLLM); // 注入LLM调用能力
  setAutoOpsPool(p);       // 自动化营运引擎
  setAutoOpsDeps({
    sendLarkMessage,
    sendLarkCard,
    lookupFeishuUserByUsername,
    findStoreManager,
    callLLM,
    prefixWithAgentName,
    inferBrandFromStoreName
  });
}
export function pool() { 
  if (!_pool) throw new Error('master-agent: pool not set'); 
  return _pool; 
}

// 责任人角色映射已移至 agent-config-manager.js 动态读取

const {
  transitionTask,
  createTask,
  resolveAssignee,
} = createMasterTaskLifecycle({
  getPool: pool,
  log,
  getSharedState,
  getCategoryAssigneeRoleMap,
  extractAnomalyRelations,
});

// ─────────────────────────────────────────────
// 1. Table Creation
// ─────────────────────────────────────────────

export async function ensureMasterTables() {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');

    // 核心任务表：每一条异常/工单的全生命周期
    await client.query(`
      CREATE TABLE IF NOT EXISTS master_tasks (
        id SERIAL PRIMARY KEY,
        task_id TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending_audit',
        source TEXT DEFAULT 'scheduled_audit',
        source_ref TEXT,
        current_agent TEXT,
        category TEXT,
        severity TEXT DEFAULT 'medium',
        store TEXT,
        brand TEXT,
        assignee_username TEXT,
        assignee_role TEXT,
        title TEXT,
        detail TEXT,
        source_data JSONB DEFAULT '{}'::jsonb,
        audit_result JSONB DEFAULT '{}'::jsonb,
        dispatch_data JSONB DEFAULT '{}'::jsonb,
        response_text TEXT,
        response_images JSONB DEFAULT '[]'::jsonb,
        review_result JSONB DEFAULT '{}'::jsonb,
        settlement_data JSONB DEFAULT '{}'::jsonb,
        score_impact NUMERIC(5,1) DEFAULT 0,
        feishu_msg_ids JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        dispatched_at TIMESTAMPTZ,
        responded_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        settled_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ
      )
    `);

    // 事件日志表：所有状态流转的审计轨迹
    await client.query(`
      CREATE TABLE IF NOT EXISTS master_events (
        id SERIAL PRIMARY KEY,
        task_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_agent TEXT,
        to_agent TEXT,
        status_before TEXT,
        status_after TEXT,
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_master_tasks_status ON master_tasks (status)`);
    await client.query(`ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default'`);
    await client.query(`ALTER TABLE master_events ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default'`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_master_tasks_store ON master_tasks (store, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_master_tasks_assignee ON master_tasks (assignee_username, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_master_tasks_task_id ON master_tasks (task_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_master_events_task ON master_events (task_id, created_at)`);

    // SOP案例分析表
    await client.query(`
      CREATE TABLE IF NOT EXISTS sop_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',  -- draft/pending_confirm/confirmed/published
        source_review_id UUID,                 -- 关联的差评记录
        store TEXT NOT NULL,
        brand TEXT,
        event_detail TEXT NOT NULL,            -- 事件详细过程
        analysis TEXT,                         -- SOP分析内容
        improvement_actions TEXT,              -- 改进措施
        created_by TEXT,                       -- 创建者（Train Agent）
        confirmed_by TEXT,                     -- 确认者（店长）
        confirmed_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sop_cases_store ON sop_cases (store)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sop_cases_status ON sop_cases (status)`);

    // 培训任务跟踪表
    await client.query(`
      CREATE TABLE IF NOT EXISTS training_tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,                    -- onboarding/skill_upgrade/management/culture
        title TEXT NOT NULL,                   -- 培训标题
        target_role TEXT NOT NULL,             -- 目标岗位 (e.g., store_manager, cashier)
        assignee_username TEXT NOT NULL,       -- 参训人员
        store TEXT NOT NULL,
        brand TEXT,
        status TEXT NOT NULL DEFAULT 'pending',-- pending/in_progress/completed/failed
        progress_data JSONB DEFAULT '{}',      -- 培训进度、考试成绩、反馈等
        due_date DATE,                         -- 截止日期
        completed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_training_tasks_assignee ON training_tasks (assignee_username, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_training_tasks_role ON training_tasks (target_role)`);

    // Agent自主任务日志表
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_autonomous_logs (
        id SERIAL PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        result JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_autonomous_logs_task ON agent_autonomous_logs (task_id, created_at)`);

    // Agent协作会话归档表
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_collaboration_archives (
        id SERIAL PRIMARY KEY,
        session_id TEXT UNIQUE NOT NULL,
        topic TEXT NOT NULL,
        initiator TEXT NOT NULL,
        participants JSONB NOT NULL,
        messages JSONB DEFAULT '[]',
        summary TEXT,
        created_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_collaboration_session ON agent_collaboration_archives (session_id, created_at)`);

    // 回归检查结果表
    await client.query(`
      CREATE TABLE IF NOT EXISTS regression_check_results (
        id SERIAL PRIMARY KEY,
        check_data JSONB NOT NULL,
        passed BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_regression_check_time ON regression_check_results (created_at)`);

    // 自动化测试结果表
    await client.query(`
      CREATE TABLE IF NOT EXISTS automated_test_results (
        id SERIAL PRIMARY KEY,
        test_data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_automated_test_time ON automated_test_results (created_at)`);

    // Agent任务日志表（用于性能监控）
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_task_logs (
        id SERIAL PRIMARY KEY,
        agent_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        execution_time_ms INTEGER,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_task_logs_agent ON agent_task_logs (agent_id, created_at)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_task_logs_type ON agent_task_logs (task_type, status)`);

    // 数据质量日志表
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_quality_logs (
        id SERIAL PRIMARY KEY,
        data_source TEXT NOT NULL,
        record_count INTEGER DEFAULT 0,
        data_quality_score NUMERIC(3,2) DEFAULT 1.0,
        issues JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_data_quality_source ON data_quality_logs (data_source, created_at)`);

    await client.query('COMMIT');
    log.info('[master] Tables ensured (including autonomous, regression, LLM monitoring)');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (String(e?.code || '') === '23505') return;
    log.error('[master] ensureMasterTables failed:', e?.message);
  } finally {
    client.release();
  }
  // 知识图谱 & 行动计划表
  try { await ensureKnowledgeGraphTables(); } catch (e) { log.error('[master] ensureKGTables failed:', e?.message); }
}

// ─────────────────────────────────────────────
// 5. Agent Listeners - 扩展支持Agent沟通
// ─────────────────────────────────────────────

/** 将 data_auditor 新写入的 agent_issues 同步为 master_tasks（供 Master 监听与周审计后调用） */
export async function syncDataAuditorIssuesToMasterTasks(newIssueIds, tenantId = 'default') {
  if (!newIssueIds?.length) return 0;
  const disabledLegacyBiCategories = [
    '实收营收异常',
    '人效值异常',
    '充值异常',
    '桌访产品异常',
    '桌访占比异常',
    '产品差评异常',
    '服务差评异常',
    '总实收毛利率异常'
  ];
  let created = 0;
  for (const issueId of newIssueIds) {
    try {
      const ir = await pool().query(
        `SELECT * FROM agent_issues WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [String(issueId), tenantId]
      );
      const issue = ir.rows?.[0];
      if (!issue) continue;

      const cat = String(issue.category || '');
      const ttl = String(issue.title || '');
      // 旧 data_auditor 的 BI 异常已整体迁移到 agents-service-v2（ANO-*）。
      // 若继续同步为 MT-*，会与新链路并行催办，最终造成重复任务与重复备案。
      if (disabledLegacyBiCategories.some((name) => cat.includes(name))) {
        log.info('[master:data_auditor] skip deprecated anomaly → master_tasks', issueId, cat, ttl.slice(0, 80));
        continue;
      }
      if (
        cat.includes('原料收货') ||
        /近\s*\d+\s*天.*原料|条原料.*异常|原料异常反馈/i.test(ttl)
      ) {
        log.info('[master:data_auditor] skip deprecated material issue → master_tasks', issueId, ttl.slice(0, 80));
        continue;
      }

      const dup = await pool().query(
        `SELECT id FROM master_tasks WHERE source_ref = $1 AND source = 'data_auditor' AND tenant_id = $2 LIMIT 1`,
        [String(issueId), tenantId]
      );
      if (dup.rows?.length) continue;

      const taskId = await createTask({
        source: 'data_auditor',
        sourceRef: String(issueId),
        category: issue.category,
        severity: issue.severity,
        store: issue.store,
        brand: issue.brand,
        title: issue.title,
        detail: issue.detail,
        sourceData: issue.data
      }, tenantId);
      if (taskId) created++;
    } catch (e) {
      log.error('[master:data_auditor] Failed to sync issue to master_tasks:', e?.message);
    }
  }
  if (created > 0) log.info(`[master:data_auditor] Created ${created} new tasks`);
  return created;
}

// ── 5a. Data Auditor Listener ──
// 仅跑「日频」审计（上海昨日），避免 all 模式滚动 7 天导致晨报待办标题日期混乱、并与周审计重复
async function dataAuditorListener(tenantId = 'default') {
  try {
    const result = await runDataAuditor('daily', tenantId);
    return await syncDataAuditorIssuesToMasterTasks(result.newIssueIds || [], tenantId);
  } catch (e) {
    log.error('[master:data_auditor] listener error:', e?.message);
    return 0;
  }
}

// ── 5b. Master Agent Issues Listener ──
// 处理Agent报告的问题
async function masterIssuesListener(tenantId = 'default') {
  try {
    // 扫描 agent_issues_reports 表中的新问题
    const r = await pool().query(
      `SELECT * FROM agent_issues_reports WHERE status = 'pending' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 10`,
      [tenantId]
    );
    
    for (const issue of r.rows) {
      // 分配给责任Agent
      const responsibleAgent = getResponsibleAgent(issue.issue_type);
      await AgentCommunicationSystem.assignIssue(
        issue.issue_id,
        responsibleAgent,
        'normal',
        null
      );
    }
    
    log.info(`[master:issues] Processed ${r.rows.length} agent issues`);
    return r.rows.length;
  } catch (e) {
    log.error('[master:issues] listener error:', e?.message);
    return 0;
  }
}

// ── 5c. Master Optimization Coordinator ──
// 协调Agent优化方案
async function masterOptimizationCoordinator(tenantId = 'default') {
  try {
    // 扫描待审核的优化方案
    const r = await pool().query(
      `SELECT * FROM agent_issues_reports WHERE status = 'optimization_proposed' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 5`,
      [tenantId]
    );
    
    for (const issue of r.rows) {
      // 自动审核低优先级方案
      if (issue.priority === 'low' && !issue.requires_manual_review) {
        await AgentCommunicationSystem.approveOptimization(
          issue.issue_id,
          'master',
          '自动批准低优先级方案'
        );
      }
    }
    
    log.info(`[master:optimization] Processed ${r.rows.length} optimization proposals`);
    return r.rows.length;
  } catch (e) {
    log.error('[master:optimization] coordinator error:', e?.message);
    return 0;
  }
}

// 获取责任Agent
function getResponsibleAgent(issueType) {
  const issueConfig = AGENT_ISSUE_TYPES[issueType];
  return issueConfig?.responsibleAgent || 'master';
}

// ── 5b. Master Dispatcher ──
// 扫描 pending_dispatch 任务 → 解析责任人 → 分派给 Ops
async function masterDispatcher(tenantId = 'default') {
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks
       WHERE status = 'pending_dispatch'
         AND COALESCE(source, '') <> 'hrms_task_board'
         AND tenant_id = $1
       ORDER BY created_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let dispatched = 0;
    for (const task of r.rows) {
      // 解析责任人 (优先使用已有的 assignee_username)
      const assignee = await resolveAssignee(task.category, task.store, task.assignee_username, task.source_data);
      if (!assignee) {
        log.warn(`[master] No assignee found for ${task.task_id} (${task.category}, ${task.store})`);
        continue;
      }

      // 转换到 dispatched，让 Ops 接管
      const updated = await transitionTask(task.task_id, 'dispatched', 'master', {
        assignee_username: assignee.username,
        assignee_role: assignee.role,
        dispatch_data: { assignee, dispatchedBy: 'master', reason: task.category }
      }, tenantId);
      if (updated) dispatched++;
    }
    return dispatched;
  } catch (e) {
    log.error('[master] dispatcher error:', e?.message);
    return 0;
  }
}

// ── 5c. Ops Agent Listener ──
// 1) 扫描 dispatched 任务 → 在飞书通知责任人
// 2) 扫描 pending_review 任务 → 审核反馈
const _bitableWrittenTaskIds = new Set();
const _dispatchRetryCount = new Map(); // task_id → retry count

async function opsAgentListener(tenantId = 'default') {
  let actions = 0;

  // ── Part 1: 发送飞书通知 ──
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks WHERE status = 'dispatched' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 10`,
      [tenantId]
    );
    for (const task of (r.rows || [])) {
      // Write task to Bitable only once (prevent duplicate writes every cycle)
      if (!_bitableWrittenTaskIds.has(task.task_id)) {
        const bitableRecord = await writeTaskToBitable(task);
        if (bitableRecord?.record_id) {
          try {
            await pool().query(
              `UPDATE master_tasks
               SET source_data = COALESCE(source_data, '{}'::jsonb) || $1::jsonb,
                   updated_at = NOW()
               WHERE task_id = $2 AND tenant_id = $3`,
              [JSON.stringify({ task_response_record_id: bitableRecord.record_id }), task.task_id, tenantId]
            );
          } catch (e) {
            log.error('[master:ops] persist task_response_record_id failed:', e?.message);
          }
        }
        _bitableWrittenTaskIds.add(task.task_id);
      }

      if (!task.assignee_username) continue;

      const fu = await lookupFeishuUserByUsername(task.assignee_username);
      if (!fu?.open_id) {
        const retries = (_dispatchRetryCount.get(task.task_id) || 0) + 1;
        _dispatchRetryCount.set(task.task_id, retries);
        if (retries <= 1) {
          log.warn(`[master:ops] No Feishu user for ${task.assignee_username} (task ${task.task_id}), will auto-transition after 3 retries`);
        }
        // After 3 retries, force transition to pending_response so the task doesn't loop forever
        if (retries >= 3) {
          log.warn(`[master:ops] Forcing ${task.task_id} to pending_response (no Feishu user after ${retries} retries)`);
          await transitionTask(task.task_id, 'pending_response', 'ops_supervisor', {
            note: `Auto-transitioned: no Feishu user found for ${task.assignee_username}`
          }, tenantId);
          _dispatchRetryCount.delete(task.task_id);
          actions++;
        }
        continue;
      }

      // Build form URL with pre-filled task details
      const formUrl = getTaskResponseFormUrl(task);

      // 判断是否首次派发 (vs 驳回后重新派发)
      let isFirstDispatch = true;
      try {
        const evR = await pool().query(
          `SELECT COUNT(*) as cnt FROM master_events WHERE task_id = $1 AND event_type = 'status_change' AND status_after = 'dispatched' AND tenant_id = $2`,
          [task.task_id, tenantId]
        );
        isFirstDispatch = (parseInt(evR.rows[0]?.cnt || '0') === 0);
      } catch (e) { /* ignore */ }

      let sendResult;
      // 直接发送交互卡片（不再使用表单链接）
      const card = buildTaskDispatchCard(task, formUrl, { isFirstDispatch });
      sendResult = await sendLarkCard(fu.open_id, card);

      if (sendResult?.ok) {
        // 调试日志：记录飞书返回的完整结构
        log.info('[master:ops] sendLarkCard result:', JSON.stringify(sendResult.data));
        const msgId = sendResult.data?.data?.message_id || sendResult.data?.message_id || '';
        log.info('[master:ops] extracted message_id:', msgId);
        await transitionTask(task.task_id, 'pending_response', 'ops_supervisor', {
          feishu_msg_id: msgId
        }, tenantId);

        // 记录 outbound 消息
        try {
          await pool().query(
            `INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, routed_to, content_type, content, tenant_id)
             VALUES ('out','feishu',$1,'system','Master Agent','ops_supervisor','card',$2,$3)`,
            [fu.open_id, `异常通知卡片 [${task.task_id}] - 回复表单已发送`, tenantId]
          );
        } catch (e) { /* ignore */ }
        actions++;
      }
    }
  } catch (e) {
    log.error('[master:ops] dispatch notify error:', e?.message);
  }

  // ── Part 2: 审核反馈 ──
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks WHERE status = 'pending_review' AND tenant_id = $1 ORDER BY responded_at ASC LIMIT 5`,
      [tenantId]
    );
    for (const task of (r.rows || [])) {
      const responseText = task.response_text || '';
      const responseImages = Array.isArray(task.response_images) ? task.response_images : [];

      if (!responseText && !responseImages.length) continue;

      // 构建审核 prompt
      let reviewNotes = '';

      // 图片审核（如有图片）
      let imageReviewOk = true;
      if (responseImages.length) {
        for (const imgUrl of responseImages) {
          const vr = await callVisionLLM(imgUrl, buildVisionReviewPrompt(task));
          const parsed = parseLlmValidReview(vr.content, ['不合格', '无效', 'false']);
          if (!parsed.valid) {
            imageReviewOk = false;
            reviewNotes += `图片不合格: ${parsed.reason}; `;
          }
        }
      }

      // 文字审核
      let textReviewOk = true;
      if (responseText) {
        let sopContext = '';
        try {
          const sopResults = await queryKnowledgeBase(['sop', '整改', '标准'], task.category || '', 2);
          sopContext = formatSopContext(sopResults);
        } catch (e) { /* ignore */ }

        const llm = await callLLM([
          { role: 'system', content: buildTextReviewSystemPrompt(task, sopContext) },
          { role: 'user', content: `员工回复：${responseText}` }
        ], { skipCache: true, temperature: 0.05 });

        const parsed = parseLlmValidReview(llm.content);
        if (!parsed.valid) {
          textReviewOk = false;
          reviewNotes += `回复不足: ${parsed.reason}; `;
        }
        if (parsed.suggestion) reviewNotes += `建议: ${parsed.suggestion}; `;
      }

      const reviewDecision = decideReviewOutcome(imageReviewOk, textReviewOk);

      const result = await transitionTask(task.task_id, reviewDecision, 'ops_supervisor', {
        review_result: buildReviewResultPayload({
          reviewDecision,
          imageReviewOk,
          textReviewOk,
          reviewNotes,
        }).review_result
      }, tenantId);

      if (result) {
        // 通知责任人审核结果（专业格式，含判断依据）
        if (task.assignee_username) {
          const fu = await lookupFeishuUserByUsername(task.assignee_username);
          if (fu?.open_id) {
            const message = buildReviewNotificationMessage({
              task,
              reviewDecision,
              imageReviewOk,
              textReviewOk,
              reviewNotes,
              responseImages,
              responseText,
            });
            await sendLarkMessage(fu.open_id, prefixWithAgentName('ops_supervisor', message));
          }
        }
        actions++;
      }
    }
  } catch (e) {
    log.error('[master:ops] review error:', e?.message);
  }

  return actions;
}

// ── 5d. Master Post-Resolution Handler ──
// 扫描 resolved 任务 → 推给 Chief Evaluator 结算
async function masterPostResolution(tenantId = 'default') {
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks WHERE status = 'resolved' AND tenant_id = $1 ORDER BY resolved_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let count = 0;
    for (const task of r.rows) {
      const updated = await transitionTask(task.task_id, 'pending_settlement', 'master', {}, tenantId);
      if (updated) count++;
    }
    return count;
  } catch (e) {
    log.error('[master] post-resolution error:', e?.message);
    return 0;
  }
}

// ── 5e. Master Handle Rejected ──
// 扫描 rejected 任务 → 重新分派
async function masterHandleRejected(tenantId = 'default') {
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks
       WHERE status = 'rejected'
         AND COALESCE(source, '') <> 'hrms_task_board'
         AND tenant_id = $1
       ORDER BY resolved_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let count = 0;
    for (const task of r.rows) {
      // 重新分派
      const updated = await transitionTask(task.task_id, 'pending_dispatch', 'master', {}, tenantId);
      if (updated) count++;
    }
    return count;
  } catch (e) {
    log.error('[master] handle-rejected error:', e?.message);
    return 0;
  }
}

// ── 5f. Chief Evaluator Listener ──
// 扫描 pending_settlement 任务 → 仅做结算归档（不再执行旧OP周积分扣分与培训触发）→ settled
async function chiefEvaluatorListener(tenantId = 'default') {
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks WHERE status = 'pending_settlement' AND tenant_id = $1 ORDER BY resolved_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let count = 0;
    for (const task of r.rows) {
      const responseHours = (task.dispatched_at && task.responded_at)
        ? ((new Date(task.responded_at) - new Date(task.dispatched_at)) / 3600000)
        : null;

      const updated = await transitionTask(task.task_id, 'settled', 'chief_evaluator', {
        settlement_data: {
          scoreImpact: 0,
          reason: '旧OP周绩效扣分体系已停用；该任务仅完成闭环归档，不做积分扣减。',
          category: task.category,
          severity: task.severity,
          responseTime: responseHours == null ? 'N/A' : `${responseHours.toFixed(1)}h`,
          settledAt: new Date().toISOString()
        },
        score_impact: 0
      }, tenantId);

      if (updated) {
        count++;
      }
    }
    return count;
  } catch (e) {
    log.error('[master:evaluator] settlement error:', e?.message);
    return 0;
  }
}

// ── 5g. Train Agent Listener ──
// 处理详细差评→SOP案例分析流程 & 自动备课流程
async function trainAgentListener(tenantId = 'default') {
  let actions = 0;

  try {
    // 1. 处理待备课的培训需求 (draft_need -> pending_approval)
    const draftNeeds = await pool().query(
      `SELECT * FROM training_tasks WHERE status = 'draft_need' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 5`,
      [tenantId]
    );

    for (const task of (draftNeeds.rows || [])) {
      // Train Agent 自动备课：搜索知识库
      let trainingOutline = `培训主题：${task.title}\n培训目标：改善近期绩效扣分项，提升标准执行力\n\n`;
      let kbResults = [];
      try {
        const queryTerm = task.title.replace('专项提升：', '').replace('改善', '');
        kbResults = await queryKnowledgeBase(['sop', '标准', queryTerm], queryTerm, 3, { brandTag: task.brand });
        if (kbResults.length > 0) {
          trainingOutline += `【推荐学习资料】\n` + kbResults.map((r, i) => `${i+1}. 《${r.title}》`).join('\n');
        } else {
          trainingOutline += `【需补充资料】未在知识库中找到关于"${queryTerm}"的详细资料，请管理员补充。`;
        }
      } catch (e) {
        log.error('[master:train] auto-preparation failed:', e?.message);
      }

      // 组装进度数据，包括备课大纲
      const progressData = {
        ...(task.progress_data || {}),
        outline: trainingOutline,
        prepared_at: new Date().toISOString()
      };

      // 更新任务状态为 pending_approval，等待管理员审批/补充
      await pool().query(
        `UPDATE training_tasks SET status = 'pending_approval', progress_data = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(progressData), task.id]
      );

      // 通知 HR 管理员审核培训大纲
      const hrAdminUsername = 'admin'; // 默认通知admin，可扩展为查找具体的HR管理员
      const fu = await lookupFeishuUserByUsername(hrAdminUsername);
      if (fu?.open_id) {
        const msg = prefixWithAgentName('train_advisor',
          `📝 自动培训备课需审核 [${task.task_id}]\n\n` +
          `由于 ${task.assignee_username} 近期绩效扣分触发阈值，我已为其生成专属培训计划：\n` +
          `课程：${task.title}\n\n` +
          `【备课大纲】\n${trainingOutline}\n\n` +
          `请确认该计划是否合理，是否需要补充外部资料。确认后请回复“审核通过，准许下发”，我将推送给员工。`
        );
        await sendLarkMessage(fu.open_id, msg);
      }
      actions++;
      log.info(`[master:train] Auto-prepared training ${task.task_id} for ${task.assignee_username}`);
    }

    // 2. 检测有详细事件过程的差评
    const detailedReviews = await pool().query(
      `SELECT * FROM bad_reviews
       WHERE has_detailed_event = TRUE AND sop_case_id IS NULL AND status = 'open' AND tenant_id = $1
       ORDER BY created_at ASC LIMIT 5`,
      [tenantId]
    );

    for (const review of (detailedReviews.rows || [])) {
      // 2. 创建SOP案例分析草稿
      const caseId = `SOP-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const r = await pool().query(
        `INSERT INTO sop_cases (case_id, source_review_id, store, brand, event_detail, status, created_by, tenant_id)
         VALUES ($1, $2, $3, $4, $5, 'draft', 'train_agent', $6)
         RETURNING id`,
        [caseId, review.id, review.store, review.brand, review.event_detail || review.content, tenantId]
      );
      const sopCaseId = r.rows?.[0]?.id;

      if (sopCaseId) {
        // 3. 标记差评为processing
        await pool().query(
          `UPDATE bad_reviews SET status = 'processing', sop_case_id = $1 WHERE id = $2`,
          [sopCaseId, review.id]
        );

        // 4. 通知店长了解详细过程（通过飞书）
        const assignee = await resolveAssignee(
          review.review_type === 'product' ? '产品差评异常' : '服务差评异常',
          review.store
        );
        if (assignee?.username) {
          const fu = await lookupFeishuUserByUsername(assignee.username);
          if (fu?.open_id) {
            const msg = prefixWithAgentName('train_advisor',
              `📚 SOP案例分析请求 [${caseId}]\n\n` +
              `门店：${review.store}\n` +
              `类型：${review.review_type === 'product' ? '产品差评' : '服务差评'}\n\n` +
              `事件详情：\n${review.event_detail || review.content}\n\n` +
              `请回复您了解到的具体事件详细过程，以及改进建议。`
            );
            await sendLarkMessage(fu.open_id, msg);
          }
        }
        actions++;
        log.info(`[master:sop] Created SOP case ${caseId} for review ${review.id}`);
      }
    }

    // 5. 处理待确认的案例分析
    const pendingCases = await pool().query(
      `SELECT * FROM sop_cases WHERE status = 'pending_confirm' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 5`,
      [tenantId]
    );

    for (const sopCase of (pendingCases.rows || [])) {
      // 通知店长确认
      const assignee = await resolveAssignee('产品差评异常', sopCase.store);
      if (assignee?.username) {
        const fu = await lookupFeishuUserByUsername(assignee.username);
        if (fu?.open_id) {
          const msg = prefixWithAgentName('train_advisor',
            `✅ SOP案例分析待确认 [${sopCase.case_id}]\n\n` +
            `门店：${sopCase.store}\n\n` +
            `分析内容：\n${sopCase.analysis || ''}\n\n` +
            `改进措施：\n${sopCase.improvement_actions || ''}\n\n` +
            `请确认是否可以执行。回复"确认"通过，或回复修改意见。`
          );
          await sendLarkMessage(fu.open_id, msg);
        }
      }
      actions++;
    }

    // 6. 处理已确认的案例分析 → 发布培训
    const confirmedCases = await pool().query(
      `SELECT * FROM sop_cases WHERE status = 'confirmed' AND tenant_id = $1 ORDER BY confirmed_at ASC LIMIT 5`,
      [tenantId]
    );

    for (const sopCase of (confirmedCases.rows || [])) {
      // 发布到事件门店的店长和总部营运
      // TODO: 需要获取总部营运的飞书账号
      await pool().query(
        `UPDATE sop_cases SET status = 'published', published_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [sopCase.id, tenantId]
      );

      // 更新知识库
      try {
        const state = await getSharedState();
        if (state?.knowledgeBase) {
          // 添加到SOP库
          const _entry = {
            id: sopCase.case_id,
            type: 'case_study',
            store: sopCase.store,
            brand: sopCase.brand,
            title: `案例分析：${sopCase.store}`,
            content: sopCase.analysis,
            actions: sopCase.improvement_actions,
            createdAt: new Date().toISOString()
          };
          // 这里可以调用queryKnowledgeBase的写入接口
          log.info(`[master:sop] Case ${sopCase.case_id} published to SOP library`);
        }
      } catch (e) { /* ignore */ }

      actions++;
    }

  } catch (e) {
    log.error('[master:sop] listener error:', e?.message);
  }

  return actions;
}

// ── 5g. Master Final Notification ──
// 扫描 settled 任务 → 发送最终通知 → closed
async function masterFinalNotification(tenantId = 'default') {
  try {
    const r = await pool().query(
      `SELECT * FROM master_tasks WHERE status = 'settled' AND tenant_id = $1 ORDER BY settled_at ASC LIMIT 10`,
      [tenantId]
    );
    if (!r.rows?.length) return 0;

    let count = 0;
    for (const task of r.rows) {
      if (task.assignee_username) {
        const fu = await lookupFeishuUserByUsername(task.assignee_username);
        if (fu?.open_id) {
          const msgText = `📋 任务完成通知 [${task.task_id}]\n\n✅ ${task.title}\n\n该任务已完成闭环并归档。\n（旧OP周绩效积分已停用，本任务不做周积分扣减）\n\n感谢配合处理！`;
          await sendLarkMessage(fu.open_id, prefixWithAgentName('master', msgText));
        }
      }

      await transitionTask(task.task_id, 'closed', 'master', {}, tenantId);
      count++;
    }
    return count;
  } catch (e) {
    log.error('[master] final notification error:', e?.message);
    return 0;
  }
}

// ─────────────────────────────────────────────
// 6. Feishu Response Handler
// ─────────────────────────────────────────────

// 当用户在飞书回复消息时，检查是否有待回复的任务
export async function handleTaskResponse(username, text, imageUrls, parentMessageId = null) {
  try {
    let task = null;
    
    // 优先通过 parentMessageId 精确匹配任务
    if (parentMessageId) {
      const r = await pool().query(
        `SELECT * FROM master_tasks
         WHERE assignee_username = $1 AND status = 'pending_response'
         AND feishu_msg_ids ? $2
         AND tenant_id = $3
         ORDER BY dispatched_at ASC LIMIT 1`,
        [username, parentMessageId, 'default']
      );
      task = r.rows?.[0];
      log.info(`[master] Task lookup by parent_message_id: ${parentMessageId}, found: ${task?.task_id || 'none'}`);
    }

    // 降级1：通过 parentMessageId 查找但忽略 feishu_msg_ids 检查（处理空数组情况）
    if (!task && parentMessageId) {
      const r = await pool().query(
        `SELECT * FROM master_tasks
         WHERE assignee_username = $1 AND status = 'pending_response'
         AND tenant_id = $2
         ORDER BY dispatched_at DESC LIMIT 1`,
        [username, 'default']
      );
      task = r.rows?.[0];
      log.info(`[master] Task lookup fallback (has parent_id): found: ${task?.task_id || 'none'}`);
    }

    // 降级2：无 parentMessageId 时，只处理明确的回复关键词
    if (!task && !parentMessageId) {
      const hasReplyKeyword = /(已处理|已完成|已整改|已解决|处理完|整改完毕|情况说明|原因如下|马上处理|正在处理|立即处理)/.test(String(text || '').trim());
      if (hasReplyKeyword || imageUrls.length > 0) {
        const r = await pool().query(
          `SELECT * FROM master_tasks
           WHERE assignee_username = $1 AND status = 'pending_response'
           AND tenant_id = $2
           ORDER BY dispatched_at DESC LIMIT 1`,
          [username, 'default']
        );
        task = r.rows?.[0];
        log.info(`[master] Task lookup by keyword/image: found: ${task?.task_id || 'none'}`);
      }
    }

    if (!task) return null; // 不是任务回复，走正常agent路由

    // 记录反馈并推进状态
    const updated = await transitionTask(task.task_id, 'pending_review', 'master', {
      response_text: text || '',
      response_images: Array.isArray(imageUrls) ? imageUrls : [],
      parent_message_id: parentMessageId // 记录关联关系
    }, 'default');

    if (updated) {
      log.info(`[master] Task ${task.task_id} response received from ${username} via reply`);
      return {
        handled: true,
        taskId: task.task_id,
        response: `✅ 已收到您对任务 [${task.task_id}] 的回复，正在审核中...\n\n📋 任务：${task.title}\n💬 您的回复：${String(text || '').slice(0, 100)}${text.length > 100 ? '...' : ''}\n📸 附件照片：${imageUrls.length}张\n\n请等待审核结果通知。`
      };
    }
    return null;
  } catch (e) {
    log.error('[master] handleTaskResponse error:', e?.message);
    return null;
  }
}

// ── 5h. Train Task Dispatcher ──
// 主动推送培训任务给相关岗位的员工
async function trainTaskDispatcher(tenantId = 'default') {
  let dispatched = 0;
  try {
    const pendingTasks = await pool().query(
      `SELECT * FROM training_tasks WHERE status = 'pending' AND tenant_id = $1 ORDER BY created_at ASC LIMIT 10`,
      [tenantId]
    );
    for (const task of (pendingTasks.rows || [])) {
      const fu = await lookupFeishuUserByUsername(task.assignee_username);
      if (fu?.open_id) {
        const typeLabel = {
          onboarding: '入职培训',
          skill_upgrade: '技能提升',
          management: '管理培训',
          culture: '企业文化'
        }[task.type] || task.type;
        
        const dueDateStr = task.due_date ? new Date(task.due_date).toLocaleDateString() : '无';
        const msg = prefixWithAgentName('train_advisor',
          `🎯 培训任务下发 [${task.task_id}]\n\n` +
          `课程标题：${task.title}\n` +
          `培训类型：${typeLabel}\n` +
          `要求岗位：${task.target_role}\n` +
          `截止日期：${dueDateStr}\n\n` +
          `请及时学习相关资料。学习完成后，可直接回复我“开始考核”或随时向我提问关于本课程的疑惑。`
        );
        await sendLarkMessage(fu.open_id, msg);
      }
      // 标记为进行中
      await pool().query(`UPDATE training_tasks SET status = 'in_progress', updated_at = NOW() WHERE id = $1`, [task.id]);
      dispatched++;
      log.info(`[master:train] Dispatched training task ${task.task_id} to ${task.assignee_username}`);
    }
  } catch (e) {
    log.error('[master:train] task dispatcher error:', e?.message);
  }
  return dispatched;
}

// ─────────────────────────────────────────────
// 7. Weekly Score Calculator
// ─────────────────────────────────────────────

async function calculateWeeklyScore(username) {
  try {
    // 基础分 100，减去本周所有任务的绩效影响
    const r = await pool().query(
      `SELECT COALESCE(SUM(score_impact), 0) as total_impact
       FROM master_tasks
       WHERE assignee_username = $1
         AND status IN ('settled', 'closed')
         AND created_at > NOW() - INTERVAL '7 days'
         AND tenant_id = $2`,
      [username, 'default']
    );
    const totalImpact = Number(r.rows?.[0]?.total_impact || 0);
    return Math.max(0, Math.min(100, 100 + totalImpact));
  } catch (e) {
    return 100;
  }
}

// ─────────────────────────────────────────────
// 8. Master Orchestration Loop
// ─────────────────────────────────────────────

let _masterStarted = false;

export function startMasterAgent() {
  if (_masterStarted) return;
  _masterStarted = true;
  log.info('[master] Starting event-driven orchestration...');

  // 初始化任务序号
  (async () => {
    try {
      // 全局自增序号，不按租户区分——避免多租户共享同一计数器时task_id撞号
      const r = await pool().query(`SELECT MAX(id) as maxid FROM master_tasks`);
      _taskSeq = Number(r.rows?.[0]?.maxid || 0);
    } catch (e) { /* ignore */ }
  })();

  const tenantTick = createTenantScopedTick({
    pool,
    getActiveTenantIds,
    tenantContext,
    log,
  });

  // ── Tick 1: Data Auditor — 含手动创建任务自动过审 ──
  const auditTick = tenantTick('Data Auditor created', async (tenantId) => {
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

  // ── Tick 2: Master Dispatcher — 含超时升级 ──
  const dispatchTick = tenantTick('Dispatched', async (tenantId) => {
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

  const opsTick = tenantTick('Ops processed', (tenantId) => opsAgentListener(tenantId), {
    formatMessage: (n) => `${n} tasks`,
  });

  const postResTick = tenantTick('Post-resolution', async (tenantId) => {
    const resolved = await masterPostResolution(tenantId);
    const rejected = await masterHandleRejected(tenantId);
    if (rejected > 0) {
      log.info(`[master:tick] Re-dispatched rejected(${tenantId}): ${rejected}`);
    }
    return resolved;
  });

  const evalTick = tenantTick('Evaluator settled', (tenantId) => chiefEvaluatorListener(tenantId), {
    formatMessage: (n) => `${n} tasks`,
  });

  const finalTick = tenantTick('Closed', (tenantId) => masterFinalNotification(tenantId), {
    formatMessage: (n) => `${n} tasks`,
  });

  const trainTick = tenantTick('Train processed', (tenantId) => trainAgentListener(tenantId), {
    formatMessage: (n) => `${n} cases`,
  });

  const issuesTick = tenantTick('Issues coordinator processed', (tenantId) => masterIssuesListener(tenantId), {
    formatMessage: (n) => `${n} issues`,
  });

  const optimizationTick = tenantTick('Optimization coordinator processed', (tenantId) => masterOptimizationCoordinator(tenantId), {
    formatMessage: (n) => `${n} proposals`,
  });

  const trainDispatchTick = tenantTick('Train task dispatcher sent', (tenantId) => trainTaskDispatcher(tenantId), {
    formatMessage: (n) => `${n} tasks`,
  });

  // 全局飞书 Bitable 凭证，不按租户区分
  const taskResponseTick = async () => {
    try {
      await pollTaskResponseBitable();
    } catch (e) {
      log.error('[master:tick] task response poll error:', e?.message);
    }
  };

  const kgHealthTick = tenantTick('KG health snapshots refreshed for', (tenantId) => refreshEntityHealthSnapshots(tenantId), {
    formatMessage: (n) => `${n} stores`,
  });

  const inspectionLoopTick = tenantTick('Inspection closed loop', (tenantId) => inspectionClosedLoopTick(tenantId), {
    formatMessage: (n) => `${n} actions`,
  });

  const biPushTick = tenantTick('BI proactive push', (tenantId) => biProactivePushTick(tenantId), {
    formatMessage: (n) => `${n} alerts`,
  });

  const laborTick = tenantTick('Labor efficiency', (tenantId) => laborEfficiencyTick(tenantId), {
    formatMessage: (n) => `${n} suggestions`,
  });

  const trainingLoopTick = tenantTick('Training closed loop', (tenantId) => trainingClosedLoopTick(tenantId), {
    formatMessage: (n) => `${n} tasks created`,
  });

  registerMasterIntervals([
    { fn: auditTick, intervalMs: 15 * 1000, startupDelayMs: 10 * 1000 },
    { fn: dispatchTick, intervalMs: 15 * 1000, startupDelayMs: 15 * 1000 },
    { fn: opsTick, intervalMs: 20 * 1000, startupDelayMs: 20 * 1000 },
    { fn: postResTick, intervalMs: 20 * 1000, startupDelayMs: 25 * 1000 },
    { fn: evalTick, intervalMs: 30 * 1000, startupDelayMs: 30 * 1000 },
    { fn: finalTick, intervalMs: 30 * 1000, startupDelayMs: 35 * 1000 },
    { fn: trainTick, intervalMs: 60 * 1000, startupDelayMs: 40 * 1000 },
    { fn: issuesTick, intervalMs: 30 * 1000, startupDelayMs: 45 * 1000 },
    { fn: trainDispatchTick, intervalMs: 10 * 60 * 1000, startupDelayMs: 50 * 1000 },
    { fn: optimizationTick, intervalMs: 60 * 1000, startupDelayMs: 55 * 1000 },
    { fn: taskResponseTick, intervalMs: 60 * 1000, startupDelayMs: 60 * 1000 },
    { fn: kgHealthTick, intervalMs: 6 * 60 * 60 * 1000, startupDelayMs: 90 * 1000 },
    { fn: inspectionLoopTick, intervalMs: 15 * 60 * 1000, startupDelayMs: 120 * 1000 },
    { fn: biPushTick, intervalMs: 15 * 60 * 1000, startupDelayMs: 150 * 1000 },
    { fn: laborTick, intervalMs: 15 * 60 * 1000, startupDelayMs: 180 * 1000 },
    { fn: trainingLoopTick, intervalMs: 15 * 60 * 1000, startupDelayMs: 210 * 1000 },
  ], log);
}

// ─────────────────────────────────────────────
// 9. API Routes
// ─────────────────────────────────────────────

export function registerMasterRoutes(app, authRequired) {
  return registerMasterRoutesImpl(app, {
    pool,
    authRequired,
    statusFlow: STATUS_FLOW,
    createTask,
    inferBrandFromStoreName,
  });
}
