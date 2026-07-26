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
import { registerMasterRoutes as registerMasterRoutesImpl } from './domains/master-agent/routes.js';
import { STATUS_FLOW } from './domains/master-agent/status-flow.js';
import { createMasterTaskLifecycle } from './domains/master-agent/lifecycle-service.js';
import { createMasterTablesEnsuring } from './domains/master-agent/master-tables-service.js';
import { createStartMasterAgent } from './domains/master-agent/start-service.js';

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

export const ensureMasterTables = createMasterTablesEnsuring({
  getPool: pool,
  log,
  ensureKnowledgeGraphTables,
});


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

// ─────────────────────────────────────────────
// 7. Master Orchestration Loop
// ─────────────────────────────────────────────

// Lazy: AgentCommunicationSystem ↔ master-agent cycle can TDZ a top-level factory call.
let _startMasterAgentImpl = null;
export function startMasterAgent() {
  if (!_startMasterAgentImpl) {
    _startMasterAgentImpl = createStartMasterAgent({
      pool,
      log,
      getActiveTenantIds,
      tenantContext,
      transitionTask,
      sendLarkCard,
      sendLarkMessage,
      lookupFeishuUserByUsername,
      writeTaskToBitable,
      getTaskResponseFormUrl,
      buildTaskDispatchCard,
      callLLM,
      callVisionLLM,
      queryKnowledgeBase,
      prefixWithAgentName,
      resolveAssignee,
      getSharedState,
      runDataAuditor,
      syncDataAuditorIssuesToMasterTasks,
      AgentCommunicationSystem,
      pollTaskResponseBitable,
      refreshEntityHealthSnapshots,
      inspectionClosedLoopTick,
      biProactivePushTick,
      laborEfficiencyTick,
      trainingClosedLoopTick,
    });
  }
  return _startMasterAgentImpl();
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
