import { pool } from './agents.js';
import {
  DEFAULT_BI_AGENT_CONFIG,
  DEFAULT_EMPLOYEE_RATING_CONFIG,
  DEFAULT_OPS_AGENT_CONFIG,
  DEFAULT_RULES,
} from './domains/agent-config/defaults.js';
import {
  normalizeBiAgentConfig,
  normalizeEmployeeRatingConfig,
  normalizeOpsAgentConfig,
  validateEmployeeRatingConfig,
} from './domains/agent-config/normalize.js';
import { toJson } from './domains/agent-config/config-loaders.js';
import { createAgentConfigLoaders } from './domains/agent-config/loaders-service.js';
import { FALLBACK_MODEL, normalizeModelName } from './domains/agent-config/normalize-helpers.js';
import { registerAgentConfigRoutes as registerAgentConfigRoutesImpl } from './domains/agent-config/routes.js';
import { isHrmsAgentV1Enabled } from './safety.js';
import { resolveTenantIdDefault } from './utils/database.js';
import { childLogger } from './utils/logger.js';

export { DEFAULT_BI_AGENT_CONFIG, DEFAULT_OPS_AGENT_CONFIG };

const log = childLogger({ domain: 'agent-config-manager', handler: 'manager' });

// Function exports (not const re-exports): keep live bindings hoisted so
// agents.js ↔ master-agent ↔ agent-config-manager cycles do not hit TDZ.
const loaders = createAgentConfigLoaders({ pool, log });

export function clearAgentRuleCache() {
  return loaders.clearAgentRuleCache();
}
export function getAgentRules() {
  return loaders.getAgentRules();
}
export function getCategoryAssigneeRoleMap() {
  return loaders.getCategoryAssigneeRoleMap();
}
export function getIssueScoreRulesMap() {
  return loaders.getIssueScoreRulesMap();
}
export function clearAgentConfigCache() {
  return loaders.clearAgentConfigCache();
}
export function getAgentConfigs() {
  return loaders.getAgentConfigs();
}
export function getAgentConfig(agentId) {
  return loaders.getAgentConfig(agentId);
}
export function getOpsAgentConfig() {
  return loaders.getOpsAgentConfig();
}
export function clearOpsAgentConfigCache() {
  return loaders.clearOpsAgentConfigCache();
}
export function getBiAgentConfig() {
  return loaders.getBiAgentConfig();
}
export function clearBiAgentConfigCache() {
  return loaders.clearBiAgentConfigCache();
}
export function getEmployeeRatingConfig() {
  return loaders.getEmployeeRatingConfig();
}
export function clearEmployeeRatingConfigCache() {
  return loaders.clearEmployeeRatingConfigCache();
}


// ─── Feature Flags（降级开关）────────────────────────────────
// 通过环境变量覆盖，例如 FEATURE_DISABLE_METRIC_DICTIONARY=true
export const AGENT_FEATURE_FLAGS = {
  // 阶段1：指标字典 & 分析规则是否启用
  enable_metric_dictionary: process.env.FEATURE_DISABLE_METRIC_DICTIONARY !== 'true',
  // 阶段1：session state 跨轮记忆
  enable_session_state: process.env.FEATURE_DISABLE_SESSION_STATE !== 'true',
  // 阶段2：Data Executor 确定性查询层
  enable_data_executor: process.env.FEATURE_DISABLE_DATA_EXECUTOR !== 'true',
  // 阶段2：Business Diagnosis Agent（LLM 约束分析层）
  enable_business_diagnosis: process.env.FEATURE_ENABLE_DIAGNOSIS === 'true',
  // 阶段3：规则引擎强路由（替代 LLM 路由）
  enable_rule_engine: process.env.FEATURE_DISABLE_RULE_ENGINE !== 'true',
};

const DEFAULT_AGENTS = [
  {
    agent_id: 'master',
    name: 'Master Agent (调度中枢)',
    description: '作为唯一的飞书 API 入口，负责消息路由、任务状态流转和全局上下文管理',
    system_prompt: '你是 HRMS 系统的 Master Agent，负责调度和任务流转。',
    model_name: 'qwen-max',
    temperature: 0.1,
    enabled: true,
    schedule_interval: 1
  },
  {
    agent_id: 'data_auditor',
    name: 'Data Auditor Agent (数据审计)',
    description: '核对来源数据，对异常情况触发预警',
    system_prompt: '你是数据审计 Agent，负责从业务报表和客诉数据中发现异常。',
    model_name: 'qwen-max',
    temperature: 0.1,
    enabled: true,
    schedule_interval: 30
  },
  {
    agent_id: 'ops_supervisor',
    name: 'Ops Agent (营运督导)',
    description: '负责飞书端的任务分派、到点提醒、以及利用 Vision 能力审核员工上传的照片',
    system_prompt: '你是营运督导 Agent，负责跟进异常任务的整改并审核照片。',
    model_name: 'qwen-max',
    temperature: 0.2,
    enabled: true,
    schedule_interval: 1
  },
  {
    agent_id: 'sop_advisor',
    name: 'SOP Agent (标准库)',
    description: '管理所有运营标准，提供 RAG 知识检索，支撑其他 Agent 的判罚依据',
    system_prompt: '你是 SOP 顾问 Agent，负责解答运营标准相关问题。',
    model_name: 'qwen-max',
    temperature: 0.1,
    enabled: true,
    schedule_interval: 0
  },
  {
    agent_id: 'chief_evaluator',
    name: 'Chief Evaluator (绩效考核)',
    description: '根据行为和数据结果，自动计算奖金，评分，评级的功能',
    system_prompt: '你是绩效考核 Agent，负责根据任务解决情况进行扣分和结算。',
    model_name: 'qwen-max',
    temperature: 0.1,
    enabled: true,
    schedule_interval: 60
  },
  {
    agent_id: 'appeal_handler',
    name: 'Appeal Agent (申诉处理)',
    description: '处理员工反馈，核实证据，并具备人工介入仲裁的逻辑',
    system_prompt: '你是申诉处理 Agent，负责处理员工对扣分或处罚的异议。',
    model_name: 'qwen-max',
    temperature: 0.2,
    enabled: true,
    schedule_interval: 0
  }
];

// 部署时需要从DB删除已移除的规则类别
const REMOVED_RULE_CATEGORIES = ['图片审核不合格', '原料收货异常', '原料不满意', '桌访异常', '桌访连续投诉'];

const DEFAULT_PROMPT_TEMPLATES = [
  { template_key: 'master_default_v1', agent_id: 'master', name: 'Master 默认模板', content: '你是 HRMS 系统的 Master Agent，负责调度和任务流转。', enabled: true, is_builtin: true },
  { template_key: 'data_auditor_default_v1', agent_id: 'data_auditor', name: 'BI 默认模板', content: '你是数据审计 Agent，负责从业务报表和客诉数据中发现异常。', enabled: true, is_builtin: true },
  { template_key: 'ops_supervisor_default_v1', agent_id: 'ops_supervisor', name: 'OP 默认模板', content: '你是营运督导 Agent，负责跟进异常任务的整改并审核照片。', enabled: true, is_builtin: true },
  { template_key: 'sop_advisor_default_v1', agent_id: 'sop_advisor', name: 'SOP 默认模板', content: '你是 SOP 顾问 Agent，负责解答运营标准相关问题。', enabled: true, is_builtin: true },
  { template_key: 'appeal_handler_default_v1', agent_id: 'appeal_handler', name: '申诉 默认模板', content: '你是申诉处理 Agent，负责处理员工对扣分或处罚的异议。', enabled: true, is_builtin: true }
];

const DEFAULT_REPLY_TEMPLATES = [
  { template_key: 'reply_master_default_v1', agent_id: 'master', name: 'Master 标准回复', content: '收到，我会立即按优先级分派并跟进处理进度。', enabled: true, is_builtin: true },
  { template_key: 'reply_data_auditor_default_v1', agent_id: 'data_auditor', name: 'BI 异常回复', content: '检测到异常，已生成问题卡片并推送责任人，请在规定时限内整改。', enabled: true, is_builtin: true },
  { template_key: 'reply_ops_supervisor_default_v1', agent_id: 'ops_supervisor', name: 'OP 巡检回复', content: '巡检任务已下发，请按清单逐项完成并回传证明材料。', enabled: true, is_builtin: true },
  { template_key: 'reply_chief_evaluator_default_v1', agent_id: 'chief_evaluator', name: '考核结果回复', content: '本期考核已完成，分数与扣分项已同步，可在绩效页面查看详情。', enabled: true, is_builtin: true }
];

export async function ensureAgentConfigTables() {
  try {
    await pool().query('create extension if not exists pgcrypto');
    
    // 1. Agent 基础配置表
    await pool().query(`
      create table if not exists agent_configs (
        id uuid primary key default gen_random_uuid(),
        agent_id varchar(50) unique not null,
        name varchar(100) not null,
        description text,
        system_prompt text,
        model_name varchar(50) default 'qwen-plus',
        temperature decimal(3,2) default 0.1,
        enabled boolean default true,
        schedule_interval int default 30,
        updated_at timestamp default current_timestamp
      )
    `);

    await pool().query(`
      create table if not exists agent_reply_templates (
        id uuid primary key default gen_random_uuid(),
        template_key varchar(120) unique not null,
        agent_id varchar(50) not null,
        name varchar(120) not null,
        content text not null,
        enabled boolean default true,
        is_builtin boolean default false,
        created_at timestamp default current_timestamp,
        updated_at timestamp default current_timestamp
      )
    `);

    await pool().query(`
      alter table agent_configs
      add column if not exists prompt_template_id uuid
    `);

    await pool().query(`
      alter table agent_configs
      add column if not exists reply_template_id uuid
    `);

    // 2. 异常扣分与责任人路由规则表
    await pool().query(`
      create table if not exists agent_rules (
        id uuid primary key default gen_random_uuid(),
        category varchar(100) unique not null,
        assignee_role varchar(100) not null,
        normal_deduction int default 10,
        major_deduction int default 20,
        enabled boolean default true,
        updated_at timestamp default current_timestamp
      )
    `);

    await pool().query(`
      create table if not exists agent_prompt_templates (
        id uuid primary key default gen_random_uuid(),
        template_key varchar(120) unique not null,
        agent_id varchar(50) not null,
        name varchar(120) not null,
        content text not null,
        enabled boolean default true,
        is_builtin boolean default false,
        created_at timestamp default current_timestamp,
        updated_at timestamp default current_timestamp
      )
    `);

    await pool().query(`
      create table if not exists hr_rating_configs (
        id uuid primary key default gen_random_uuid(),
        config_key varchar(80) unique not null,
        config jsonb not null,
        enabled boolean default true,
        updated_at timestamp default current_timestamp
      )
    `);

    await pool().query(`
      alter table agent_configs
      add constraint fk_agent_prompt_template
      foreign key (prompt_template_id) references agent_prompt_templates(id)
      on delete set null
    `).catch(() => null);

    await pool().query(`
      alter table agent_configs
      add constraint fk_agent_reply_template
      foreign key (reply_template_id) references agent_reply_templates(id)
      on delete set null
    `).catch(() => null);

    const templateIdMap = {};
    for (const tpl of DEFAULT_PROMPT_TEMPLATES) {
      const tr = await pool().query(
        `insert into agent_prompt_templates (template_key, agent_id, name, content, enabled, is_builtin, tenant_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (template_key, tenant_id)
         do update set name = excluded.name, content = excluded.content, enabled = excluded.enabled, updated_at = now()
         returning id, template_key`,
        [tpl.template_key, tpl.agent_id, tpl.name, tpl.content, tpl.enabled !== false, tpl.is_builtin === true, resolveTenantIdDefault()]
      );
      const row = tr.rows?.[0];
      if (row?.template_key && row?.id) templateIdMap[row.template_key] = row.id;
    }

    const replyTemplateIdMap = {};
    for (const tpl of DEFAULT_REPLY_TEMPLATES) {
      const tr = await pool().query(
        `insert into agent_reply_templates (template_key, agent_id, name, content, enabled, is_builtin, tenant_id)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (template_key, tenant_id)
         do update set name = excluded.name, content = excluded.content, enabled = excluded.enabled, updated_at = now()
         returning id, template_key`,
        [tpl.template_key, tpl.agent_id, tpl.name, tpl.content, tpl.enabled !== false, tpl.is_builtin === true, resolveTenantIdDefault()]
      );
      const row = tr.rows?.[0];
      if (row?.template_key && row?.id) replyTemplateIdMap[row.template_key] = row.id;
    }

    // 初始化默认 Agent 数据
    for (const agent of DEFAULT_AGENTS) {
      const defaultTpl = DEFAULT_PROMPT_TEMPLATES.find((x) => x.agent_id === agent.agent_id);
      const promptTemplateId = defaultTpl ? (templateIdMap[defaultTpl.template_key] || null) : null;
      const defaultReplyTpl = DEFAULT_REPLY_TEMPLATES.find((x) => x.agent_id === agent.agent_id);
      const replyTemplateId = defaultReplyTpl ? (replyTemplateIdMap[defaultReplyTpl.template_key] || null) : null;
      await pool().query(`
        insert into agent_configs (agent_id, name, description, system_prompt, model_name, temperature, enabled, schedule_interval, prompt_template_id, reply_template_id, tenant_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (agent_id, tenant_id) do nothing
      `, [agent.agent_id, agent.name, agent.description, agent.system_prompt, agent.model_name, agent.temperature, agent.enabled, agent.schedule_interval, promptTemplateId, replyTemplateId, resolveTenantIdDefault()]);

      if (promptTemplateId) {
        await pool().query(
          `update agent_configs set prompt_template_id = coalesce(prompt_template_id, $1) where agent_id = $2 and tenant_id = $3`,
          [promptTemplateId, agent.agent_id, resolveTenantIdDefault()]
        );
      }
      if (replyTemplateId) {
        await pool().query(
          `update agent_configs set reply_template_id = coalesce(reply_template_id, $1) where agent_id = $2 and tenant_id = $3`,
          [replyTemplateId, agent.agent_id, resolveTenantIdDefault()]
        );
      }
    }

    // 删除已移除的规则类别
    if (REMOVED_RULE_CATEGORIES.length) {
      await pool().query(`DELETE FROM agent_rules WHERE category = ANY($1)`, [REMOVED_RULE_CATEGORIES]);
      log.info({ msg: 'agentconfig_removed_deprecated_rule_categories', detail: [REMOVED_RULE_CATEGORIES.join(', ')] });
    }

    // 初始化默认 Rule 数据
    for (const rule of DEFAULT_RULES) {
      await pool().query(`
        insert into agent_rules (category, assignee_role, normal_deduction, major_deduction, tenant_id)
        values ($1, $2, $3, $4, $5)
        on conflict (category, tenant_id) do nothing
      `, [rule.category, rule.assignee_role, rule.normal_deduction, rule.major_deduction, resolveTenantIdDefault()]);
    }

    await pool().query(
      `insert into hr_rating_configs (config_key, config, enabled, tenant_id)
       values ('employee_rating', $1::jsonb, true, $2)
       on conflict (config_key, tenant_id) do nothing`,
      [JSON.stringify(DEFAULT_EMPLOYEE_RATING_CONFIG), resolveTenantIdDefault()]
    );

    await pool().query(
      `insert into hr_rating_configs (config_key, config, enabled, tenant_id)
       values ('ops_agent', $1::jsonb, true, $2)
       on conflict (config_key, tenant_id) do nothing`,
      [JSON.stringify(DEFAULT_OPS_AGENT_CONFIG), resolveTenantIdDefault()]
    );

    await pool().query(
      `insert into hr_rating_configs (config_key, config, enabled, tenant_id)
       values ('bi_agent', $1::jsonb, true, $2)
       on conflict (config_key, tenant_id) do nothing`,
      [JSON.stringify(DEFAULT_BI_AGENT_CONFIG), resolveTenantIdDefault()]
    );
    
    log.info({ msg: 'agentconfig_tables_ensured_and_default_data_seeded' });
  } catch (e) {
    log.error({ msg: 'agentconfig_init_error', err: e?.message || String(e) });
  }
}

export function registerAgentConfigRoutes(app, authRequired) {
  registerAgentConfigRoutesImpl(app, authRequired, {
    pool,
    log,
    toJson,
    FALLBACK_MODEL,
    normalizeModelName,
    DEFAULT_EMPLOYEE_RATING_CONFIG,
    DEFAULT_BI_AGENT_CONFIG,
    DEFAULT_OPS_AGENT_CONFIG,
    normalizeEmployeeRatingConfig,
    validateEmployeeRatingConfig,
    normalizeBiAgentConfig,
    normalizeOpsAgentConfig,
    clearAgentConfigCache,
    clearAgentRuleCache,
    clearOpsAgentConfigCache,
    clearBiAgentConfigCache,
    clearEmployeeRatingConfigCache,
    resolveTenantIdDefault,
    isHrmsAgentV1Enabled,
    reloadScheduledTasks: async () => {
      const agentsRuntime = await import('./agents.js');
      if (typeof agentsRuntime?.startScheduledTasks === 'function') {
        await agentsRuntime.startScheduledTasks();
      }
    },
  });
}
