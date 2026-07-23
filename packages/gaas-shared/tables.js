/**
 * 共享表名常量（与 CLAUDE.md「共享表唯一写入方」矩阵对齐）。
 * 禁止在业务代码里魔法字符串散落；改表名时只改这里。
 */

export const SHARED_TABLES = Object.freeze({
  MASTER_TASKS: 'master_tasks',
  FEISHU_USERS: 'feishu_users',
  FEISHU_GENERIC_RECORDS: 'feishu_generic_records',
  AGENT_MESSAGES: 'agent_messages',
  AGENT_SCORES: 'agent_scores',
  KNOWLEDGE_BASE: 'knowledge_base',
  DAILY_REPORTS: 'daily_reports',
  HRMS_STATE: 'hrms_state',
  POS_ORDER_ITEMS: 'pos_order_items',
  POS_SALES_DETAIL: 'pos_sales_detail',
  TENANTS: 'tenants',
  TENANT_INTEGRATIONS: 'tenant_integrations',
  POINT_RECORDS: 'point_records',
  HRMS_PAYROLL_DOMAIN: 'hrms_payroll_domain',
  STORE_NAME_ALIASES: 'store_name_aliases',
  EMPLOYEES: 'employees',
  HR_RATING_CONFIGS: 'hr_rating_configs',
  HRMS_USER_NOTIFICATIONS: 'hrms_user_notifications',
  EXAM_RESULTS: 'exam_results',
});

/** hr_rating_configs.config_key（A2 流程/角色模块配置） */
export const HR_RATING_CONFIG_KEYS = Object.freeze({
  ROLE_MODULES: 'role_module_config',
  APPROVAL_FLOWS: 'approval_flows',
  PAYMENT_FLOW_BY_STORE: 'payment_flow_by_store',
  EMPLOYEE_RATING: 'employee_rating',
  OPS_AGENT: 'ops_agent',
  BI_AGENT: 'bi_agent',
});

/** 唯一写入方：'gaas' | 'agents' */
export const SHARED_TABLE_WRITERS = Object.freeze({
  [SHARED_TABLES.MASTER_TASKS]: 'agents',
  [SHARED_TABLES.FEISHU_USERS]: 'agents',
  [SHARED_TABLES.FEISHU_GENERIC_RECORDS]: 'agents',
  [SHARED_TABLES.AGENT_MESSAGES]: 'agents',
  [SHARED_TABLES.AGENT_SCORES]: 'agents',
  [SHARED_TABLES.KNOWLEDGE_BASE]: 'agents',
  [SHARED_TABLES.DAILY_REPORTS]: 'gaas',
  [SHARED_TABLES.HRMS_STATE]: 'gaas',
  [SHARED_TABLES.POS_ORDER_ITEMS]: 'gaas',
  [SHARED_TABLES.POS_SALES_DETAIL]: 'gaas',
  [SHARED_TABLES.TENANTS]: 'gaas',
  [SHARED_TABLES.TENANT_INTEGRATIONS]: 'gaas',
  [SHARED_TABLES.POINT_RECORDS]: 'gaas',
  [SHARED_TABLES.HRMS_PAYROLL_DOMAIN]: 'gaas',
  [SHARED_TABLES.STORE_NAME_ALIASES]: 'gaas',
  [SHARED_TABLES.EMPLOYEES]: 'gaas',
  [SHARED_TABLES.HR_RATING_CONFIGS]: 'gaas',
  [SHARED_TABLES.HRMS_USER_NOTIFICATIONS]: 'gaas',
  [SHARED_TABLES.EXAM_RESULTS]: 'gaas',
});
