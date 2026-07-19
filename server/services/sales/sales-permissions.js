/**
 * 记录级权限：路由级角色gate(platformAdminRequired/managerGate)只回答"这个人能不能进后台"，
 * 这里回答"这个人能不能看这一条具体记录"——审计发现的核心缺口就是只有前者没有后者。
 *
 * 数据可见范围(own=只看自己/all=全量)现在由 sales-permission-config.js 里的可配置设置决定，
 * 后台没配置过的角色回退到下面这份默认矩阵(和改造前的硬编码行为完全一致)：
 *   super_admin / sales_manager  → 全量可见
 *   sales                        → 只看 owner_username=自己 或 assigned_to=自己 的线索
 *   customer_service / implementation → 只看 cs_owner_username=自己 的线索/租户(需显式分配，不给默认可见)
 */
import { getSalesPermissionConfigSync } from './sales-permission-config.js';

const MANAGER_ROLES = new Set(['super_admin', 'general_manager', 'sales_manager']);
const FULL_VIEW_ROLES = new Set([...MANAGER_ROLES, 'auditor']);

/** 'all'|'own'|null；null表示这个角色没有配置也没有默认值，调用方应按"无归属信息一律拒绝"处理 */
function effectiveDataScope(admin) {
  const role = admin?.role || '';
  if (role === 'super_admin') return 'all'; // 不接受被配置，永远全量
  const cfg = getSalesPermissionConfigSync();
  if (cfg[role]) return cfg[role].data_scope;
  if (FULL_VIEW_ROLES.has(role)) return 'all';
  if (role === 'sales' || role === 'customer_service' || role === 'implementation') return 'own';
  return null;
}

function isManager(admin) {
  return effectiveDataScope(admin) === 'all';
}

/** listLeads 之类的列表查询用：返回可拼进 WHERE 的SQL片段和对应参数(从 paramIndex 开始编号) */
function leadScopeSql(admin, paramIndex) {
  const scope = effectiveDataScope(admin);
  if (scope === 'all') return { clause: 'TRUE', params: [] };
  const role = admin?.role || '';
  const username = admin?.username || '';
  if (scope === 'own' && role === 'sales') {
    return { clause: `(owner_username = $${paramIndex} OR assigned_to = $${paramIndex})`, params: [username] };
  }
  if (scope === 'own' && (role === 'customer_service' || role === 'implementation')) {
    return { clause: `cs_owner_username = $${paramIndex}`, params: [username] };
  }
  // 未知角色/未配置归属字段的角色一律视为无可见范围，不是"全部可见"
  return { clause: 'FALSE', params: [] };
}

/** 已经查到单条 lead 后的归属校验（leads/:id、timeline、value-report 等） */
function canAccessLead(admin, lead) {
  if (!lead) return false;
  const scope = effectiveDataScope(admin);
  if (scope === 'all') return true;
  const role = admin?.role || '';
  const username = admin?.username || '';
  if (scope === 'own' && role === 'sales') return lead.owner_username === username || lead.assigned_to === username;
  if (scope === 'own' && (role === 'customer_service' || role === 'implementation')) return lead.cs_owner_username === username;
  return false;
}

/** 任务归属：sales_tasks 目前用 assignee 字段代表"谁负责这条任务" */
function canAccessTask(admin, task) {
  if (!task) return false;
  if (effectiveDataScope(admin) === 'all') return true;
  return task.assignee === admin?.username;
}

/** 提成/花名册这类"个人业绩"数据：本人或manager可见，不能查别人 */
function canAccessRepMetrics(admin, targetUsername) {
  if (effectiveDataScope(admin) === 'all') return true;
  return !!targetUsername && targetUsername === admin?.username;
}

/**
 * 租户级数据(续费健康度/上线进度/月度价值报告等)没有直接的归属字段，通过"这个租户当初
 * 是哪条线索开通的"反查 sales_leads 的 owner_username/cs_owner_username 做归属判断。
 * 查不到关联线索时，manager 之外一律拒绝——不能因为"数据模型里没有归属信息"就默认放行。
 */
async function canAccessTenant(pool, admin, tenantId) {
  if (effectiveDataScope(admin) === 'all') return true;
  const r = await pool.query(`SELECT owner_username, assigned_to, cs_owner_username FROM sales_leads WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [tenantId]);
  const lead = r.rows?.[0];
  if (!lead) return false;
  return canAccessLead(admin, lead);
}

export { isManager, leadScopeSql, canAccessLead, canAccessTask, canAccessRepMetrics, canAccessTenant };
