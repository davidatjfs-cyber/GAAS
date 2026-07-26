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
import { createSyncDataAuditorIssues } from './domains/master-agent/sync-issues.js';
import { createHandleTaskResponse } from './domains/master-agent/task-response.js';

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
export const syncDataAuditorIssuesToMasterTasks = createSyncDataAuditorIssues({
  pool,
  log,
  createTask,
});

// ─────────────────────────────────────────────
// 6. Feishu Response Handler
// ─────────────────────────────────────────────

export const handleTaskResponse = createHandleTaskResponse({
  pool,
  log,
  transitionTask,
});

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
