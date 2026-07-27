// ─────────────────────────────────────────────────────────────────
// HQ Planner Agent — 总部决策大脑: 策略生成 + 合规审查 + 行动计划
// ─────────────────────────────────────────────────────────────────
//
// 架构设计:
//   1. Planner (策略生成者): 基于图谱数据生成行动方案
//   2. Compliance Guard (合规审查者): 校验方案数据引用真实性 + 操作边界合法性
//   3. Plan Manager: 管理计划生命周期 (draft → pending_review → approved → executing → completed)
//
// 算力控制:
//   - 仅 admin/hq_manager/hr_manager 角色可触发
//   - 使用 HQ Brain tier 模型（高深度推理）
//   - 日调用频次受限 (≤60次/小时)
//
// 安全机制:
//   - 生成的计划不直接写库执行，必须经审批流
//   - 所有数据引用必须追溯到真实 DB 查询结果
//   - Compliance Guard 温度为0，零容忍审查
//
// 本文件为薄编排层：实际逻辑已拆分至 server/domains/hq-planner/*，
// 拆分模块通过 ctx = { pool, callLLMTiered, log } 接收本文件持有的单例状态
// （避免拆分模块反向 import 本文件造成循环依赖）。
// ─────────────────────────────────────────────────────────────────

import { pool as getUnifiedPool } from './utils/database.js';
import { childLogger } from './utils/logger.js';
import {
  getModelForRole,
  getTemperatureForRole,
  getMaxTokensForRole,
  trackLLMCall,
  isHqRole
} from './hq-brain-config.js';
import { generateActionPlan as generateActionPlanImpl } from './domains/hq-planner/generate-plan.js';
import {
  approvePlan as approvePlanImpl,
  rejectPlan as rejectPlanImpl,
  listPlans as listPlansImpl
} from './domains/hq-planner/plan-lifecycle.js';
import { handleHqBrainMessage as handleHqBrainMessageImpl } from './domains/hq-planner/hq-brain-chat.js';
import { registerHqPlannerRoutes as registerHqPlannerRoutesImpl } from './domains/hq-planner/routes.js';

const log = childLogger({ domain: 'hq-planner' });

let _pool = null;
let _callLLM = null;

export function setHqPlannerPool(p) { _pool = p; }
export function setHqPlannerLLM(fn) { _callLLM = fn; }

function pool() {
  if (_pool) return _pool;
  return getUnifiedPool();
}

async function callLLMTiered(messages, role, options = {}) {
  if (!_callLLM) throw new Error('HQ Planner: callLLM not set');
  const model = getModelForRole(role, options.purpose || 'reasoning');
  const temperature = options.temperature ?? getTemperatureForRole(role);
  const maxTokens = options.maxTokens ?? getMaxTokensForRole(role);
  const result = await _callLLM(messages, {
    model,
    temperature,
    max_tokens: maxTokens,
    skipCache: true,
    ...options
  });
  // 算力追踪
  const tier = isHqRole(role) ? 'hq_brain' : 'store_limb';
  trackLLMCall(tier, result?.raw?.usage?.total_tokens || 0);
  return result;
}

function buildCtx() {
  return { pool, callLLMTiered, log };
}

export async function generateActionPlan(params) {
  return generateActionPlanImpl(buildCtx(), params);
}

export async function approvePlan(planId, approvedBy, opts = {}) {
  return approvePlanImpl(buildCtx(), planId, approvedBy, opts);
}

export async function rejectPlan(planId, rejectedBy, reason) {
  return rejectPlanImpl(buildCtx(), planId, rejectedBy, reason);
}

export async function listPlans(options = {}) {
  return listPlansImpl(buildCtx(), options);
}

export async function handleHqBrainMessage(params) {
  return handleHqBrainMessageImpl(buildCtx(), params);
}

export function registerHqPlannerRoutes(app, authRequired) {
  return registerHqPlannerRoutesImpl(app, authRequired, buildCtx());
}
