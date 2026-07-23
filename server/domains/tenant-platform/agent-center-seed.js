import { tenantContext } from '../../utils/database.js';

export function normalizeAgentModelName(v, fallback = 'qwen-plus') {
  const model = String(v || '').trim();
  if (!model) return fallback;
  return model;
}

export function normalizeAgentTemperature(v, fallback = 0.1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(2, Math.round(n * 100) / 100));
}

export function normalizeAgentScheduleInterval(v, fallback = 30) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export const PLATFORM_AGENT_DEFAULTS = [
  {
    agent_id: 'master',
    name: 'Master Agent (调度中枢)',
    description: '负责消息路由、任务状态流转和全局上下文管理',
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
    description: '负责任务分派、到点提醒、以及图片审核',
    system_prompt: '你是营运督导 Agent，负责跟进异常任务的整改并审核照片。',
    model_name: 'qwen-max',
    temperature: 0.2,
    enabled: true,
    schedule_interval: 1
  },
  {
    agent_id: 'sop_advisor',
    name: 'SOP Agent (标准库)',
    description: '管理所有运营标准，提供知识检索',
    system_prompt: '你是 SOP 顾问 Agent，负责解答运营标准相关问题。',
    model_name: 'qwen-max',
    temperature: 0.1,
    enabled: true,
    schedule_interval: 0
  },
  {
    agent_id: 'chief_evaluator',
    name: 'Chief Evaluator (绩效考核)',
    description: '自动计算奖金、评分、评级',
    system_prompt: '你是绩效考核 Agent，负责根据任务解决情况进行扣分和结算。',
    model_name: 'qwen-max',
    temperature: 0.1,
    enabled: true,
    schedule_interval: 60
  },
  {
    agent_id: 'appeal_handler',
    name: 'Appeal Agent (申诉处理)',
    description: '处理员工反馈，核实证据，并支持人工仲裁',
    system_prompt: '你是申诉处理 Agent，负责处理员工对扣分或处罚的异议。',
    model_name: 'qwen-max',
    temperature: 0.2,
    enabled: true,
    schedule_interval: 0
  }
];

export const PLATFORM_AGENT_PROMPT_TEMPLATES = [
  { template_key: 'master_default_v1', agent_id: 'master', name: 'Master 默认模板', content: '你是 HRMS 系统的 Master Agent，负责调度和任务流转。', enabled: true, is_builtin: true },
  { template_key: 'data_auditor_default_v1', agent_id: 'data_auditor', name: 'BI 默认模板', content: '你是数据审计 Agent，负责从业务报表和客诉数据中发现异常。', enabled: true, is_builtin: true },
  { template_key: 'ops_supervisor_default_v1', agent_id: 'ops_supervisor', name: 'OP 默认模板', content: '你是营运督导 Agent，负责跟进异常任务的整改并审核照片。', enabled: true, is_builtin: true },
  { template_key: 'sop_advisor_default_v1', agent_id: 'sop_advisor', name: 'SOP 默认模板', content: '你是 SOP 顾问 Agent，负责解答运营标准相关问题。', enabled: true, is_builtin: true },
  { template_key: 'appeal_handler_default_v1', agent_id: 'appeal_handler', name: '申诉 默认模板', content: '你是申诉处理 Agent，负责处理员工对扣分或处罚的异议。', enabled: true, is_builtin: true }
];

export const PLATFORM_AGENT_REPLY_TEMPLATES = [
  { template_key: 'reply_master_default_v1', agent_id: 'master', name: 'Master 标准回复', content: '收到，我会立即按优先级分派并跟进处理进度。', enabled: true, is_builtin: true },
  { template_key: 'reply_data_auditor_default_v1', agent_id: 'data_auditor', name: 'BI 异常回复', content: '检测到异常，已生成问题卡片并推送责任人，请在规定时限内整改。', enabled: true, is_builtin: true },
  { template_key: 'reply_ops_supervisor_default_v1', agent_id: 'ops_supervisor', name: 'OP 巡检回复', content: '巡检任务已下发，请按清单逐项完成并回传证明材料。', enabled: true, is_builtin: true },
  { template_key: 'reply_chief_evaluator_default_v1', agent_id: 'chief_evaluator', name: '考核结果回复', content: '本期考核已完成，分数与扣分项已同步，可在绩效页面查看详情。', enabled: true, is_builtin: true }
];

const PLATFORM_AGENT_DEFAULT_COUNTS = {
  configs: PLATFORM_AGENT_DEFAULTS.length,
  prompt_templates: PLATFORM_AGENT_PROMPT_TEMPLATES.length,
  reply_templates: PLATFORM_AGENT_REPLY_TEMPLATES.length
};

export async function ensureTenantAgentCenterSeed(pool, tenantId, tenantName = '') {
  return tenantContext.run(tenantId, async () => ensureTenantAgentCenterSeedInContext(pool, tenantId, tenantName));
}

async function ensureTenantAgentCenterSeedInContext(pool, tenantId, tenantName = '') {
  const seededAt = new Date().toISOString();
  const promptTemplateIds = new Map();
  for (const tpl of PLATFORM_AGENT_PROMPT_TEMPLATES) {
    const r = await pool.query(
      `INSERT INTO agent_prompt_templates (template_key, agent_id, name, content, enabled, is_builtin, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (template_key, tenant_id)
         DO UPDATE SET name = EXCLUDED.name, content = EXCLUDED.content, enabled = EXCLUDED.enabled, updated_at = NOW()
         RETURNING id, template_key`,
      [tpl.template_key, tpl.agent_id, tpl.name, tpl.content, tpl.enabled !== false, tpl.is_builtin === true, tenantId]
    );
    if (r.rows?.[0]?.template_key && r.rows?.[0]?.id) promptTemplateIds.set(r.rows[0].template_key, r.rows[0].id);
  }

  const replyTemplateIds = new Map();
  for (const tpl of PLATFORM_AGENT_REPLY_TEMPLATES) {
    const r = await pool.query(
      `INSERT INTO agent_reply_templates (template_key, agent_id, name, content, enabled, is_builtin, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (template_key, tenant_id)
         DO UPDATE SET name = EXCLUDED.name, content = EXCLUDED.content, enabled = EXCLUDED.enabled, updated_at = NOW()
         RETURNING id, template_key`,
      [tpl.template_key, tpl.agent_id, tpl.name, tpl.content, tpl.enabled !== false, tpl.is_builtin === true, tenantId]
    );
    if (r.rows?.[0]?.template_key && r.rows?.[0]?.id) replyTemplateIds.set(r.rows[0].template_key, r.rows[0].id);
  }

  for (const agent of PLATFORM_AGENT_DEFAULTS) {
    const defaultPrompt = PLATFORM_AGENT_PROMPT_TEMPLATES.find((x) => x.agent_id === agent.agent_id);
    const defaultReply = PLATFORM_AGENT_REPLY_TEMPLATES.find((x) => x.agent_id === agent.agent_id);
    const promptTemplateId = defaultPrompt ? (promptTemplateIds.get(defaultPrompt.template_key) || null) : null;
    const replyTemplateId = defaultReply ? (replyTemplateIds.get(defaultReply.template_key) || null) : null;
    await pool.query(
      `INSERT INTO agent_configs (agent_id, name, description, system_prompt, model_name, temperature, enabled, schedule_interval, prompt_template_id, reply_template_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (agent_id, tenant_id)
         DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           system_prompt = COALESCE(agent_configs.system_prompt, EXCLUDED.system_prompt),
           model_name = COALESCE(agent_configs.model_name, EXCLUDED.model_name),
           temperature = COALESCE(agent_configs.temperature, EXCLUDED.temperature),
           enabled = COALESCE(agent_configs.enabled, EXCLUDED.enabled),
           schedule_interval = COALESCE(agent_configs.schedule_interval, EXCLUDED.schedule_interval),
           prompt_template_id = COALESCE(agent_configs.prompt_template_id, EXCLUDED.prompt_template_id),
           reply_template_id = COALESCE(agent_configs.reply_template_id, EXCLUDED.reply_template_id),
           updated_at = NOW()`,
      [agent.agent_id, agent.name, agent.description, agent.system_prompt, agent.model_name, agent.temperature, agent.enabled, agent.schedule_interval, promptTemplateId, replyTemplateId, tenantId]
    );
  }

  await pool.query(
    `INSERT INTO tenant_config (tenant_key, config_key, config_value)
       VALUES ($1, 'platform_agent_center_seed', $2::jsonb)
       ON CONFLICT (tenant_key, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
    [tenantId, JSON.stringify({ tenant_id: tenantId, tenant_name: tenantName || tenantId, seeded_at: seededAt })]
  );
}

export async function loadTenantAgentCenterData(pool, tenantId) {
  return tenantContext.run(tenantId, async () => loadTenantAgentCenterDataInContext(pool, tenantId));
}

async function loadTenantAgentCenterDataInContext(pool, tenantId) {
  const configs = await pool.query(
    `SELECT c.*, t.name AS prompt_template_name, rt.name AS reply_template_name
         FROM agent_configs c
    LEFT JOIN agent_prompt_templates t ON c.prompt_template_id = t.id
    LEFT JOIN agent_reply_templates rt ON c.reply_template_id = rt.id
        WHERE c.tenant_id = $1
        ORDER BY c.agent_id`,
    [tenantId]
  );
  const promptTemplates = await pool.query(
    `SELECT *
         FROM agent_prompt_templates
        WHERE tenant_id = $1
        ORDER BY agent_id, is_builtin DESC, updated_at DESC`,
    [tenantId]
  );
  const replyTemplates = await pool.query(
    `SELECT *
         FROM agent_reply_templates
        WHERE tenant_id = $1
        ORDER BY agent_id, is_builtin DESC, updated_at DESC`,
    [tenantId]
  );
  const roleModules = await pool.query(
    `SELECT config
         FROM hr_rating_configs
        WHERE config_key = 'role_module_config'
          AND tenant_id = $1
          AND enabled = true
        LIMIT 1`,
    [tenantId]
  ).catch(() => ({ rows: [] }));
  return {
    configs: configs.rows || [],
    prompt_templates: promptTemplates.rows || [],
    reply_templates: replyTemplates.rows || [],
    role_modules: roleModules.rows?.[0]?.config || null
  };
}

export async function ensureTenantAgentCenterReady(pool, tenantId, tenantName = '') {
  const current = await loadTenantAgentCenterData(pool, tenantId);
  const shouldSeed =
    current.configs.length < PLATFORM_AGENT_DEFAULT_COUNTS.configs
    || current.prompt_templates.length < PLATFORM_AGENT_DEFAULT_COUNTS.prompt_templates
    || current.reply_templates.length < PLATFORM_AGENT_DEFAULT_COUNTS.reply_templates;
  if (!shouldSeed) {
    return { ...current, seeded: false };
  }
  await ensureTenantAgentCenterSeed(pool, tenantId, tenantName);
  const reloaded = await loadTenantAgentCenterData(pool, tenantId);
  return { ...reloaded, seeded: true };
}
