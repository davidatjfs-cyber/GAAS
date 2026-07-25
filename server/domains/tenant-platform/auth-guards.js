import jwt from 'jsonwebtoken';
import { SYSTEM_TENANT_ID, tenantContext } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'tenant-platform', handler: 'auth-guards' });


export const PLATFORM_ADMIN_ROLES = ['super_admin', 'general_manager', 'sales_manager', 'sales', 'customer_service', 'finance', 'implementation', 'auditor'];

export function createPlatformAdminRequired(pool, platformAdminJwtSecret) {
  return async function platformAdminRequired(req, res, next) {
    const nextInSystemContext = () => tenantContext.run(SYSTEM_TENANT_ID, () => next());
    if (req.platformAdmin?.username) return nextInSystemContext();
    const token = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    let payload;
    try {
      payload = jwt.verify(token, platformAdminJwtSecret);
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (payload?.role !== 'platform_admin' || !payload?.username) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    // account_role 是这个账号的业务角色(super_admin/general_manager/sales_manager/sales/customer_service/finance/implementation)，
    // 跟上面校验的 role==='platform_admin' 不是一回事——那个只是"这是个平台登录token"的
    // 固定标记，account_role 才是真正决定这个人能看到哪些模块的字段。
    req.platformAdmin = { username: payload.username, role: payload.account_role || 'super_admin' };
    const controlPlaneOnly = ['/api/admin/tenants', '/api/admin/health-center', '/api/admin/auth/accounts'];
    if (req.platformAdmin.role !== 'super_admin' && controlPlaneOnly.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))) {
      return res.status(403).json({ error: 'forbidden', message: '该账号无权查看平台租户总控信息' });
    }
    if (req.platformAdmin.role === 'auditor' && req.method !== 'GET') {
      return res.status(403).json({ error: 'forbidden', message: '只读审计账号不能执行修改操作' });
    }
    if (req.method !== 'GET') {
      const targetTenantId = req.params?.tenantId || req.body?.tenant_id || req.body?.tenantId || null;
      let detail = {};
      try { detail = JSON.parse(JSON.stringify(req.body || { /* ignore */ })); } catch (_) { /* ignore */ }
      if (detail && typeof detail === 'object') {
        for (const k of Object.keys(detail)) {
          if (/secret|password|key|token/i.test(k)) detail[k] = '***';
        }
      }
      tenantContext.run(SYSTEM_TENANT_ID, () => pool.query(
        `INSERT INTO platform_admin_audit_log (admin_username, method, path, target_tenant_id, detail, ip)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [payload.username, req.method, req.originalUrl, targetTenantId, JSON.stringify(detail).slice(0, 4000), req.ip || '']
      )).catch((e) => log.warn({ msg: 'platform_admin_audit_log_write_failed', err: e?.message }));
    }
    return nextInSystemContext();
  };
}

// 只有 super_admin 能碰租户开通/许可证/系统配置这类"总控"操作。
// 必须放在 platformAdminRequired 之后使用(依赖 req.platformAdmin.role 已经被解出来)。
export function requireSuperAdmin(req, res, next) {
  if (req.platformAdmin?.role !== 'super_admin') {
    return res.status(403).json({ error: 'forbidden', message: '仅超级管理员可执行此操作' });
  }
  next();
}

// 提成规则设置、KPI目标/主管打分、销售花名册维护这类"销售管理"操作，
// 普通销售/客服不该碰，但销售经理和超级管理员都可以。
export function requireSalesManagerOrAbove(req, res, next) {
  const role = req.platformAdmin?.role;
  if (!['super_admin', 'general_manager', 'sales_manager'].includes(role)) {
    return res.status(403).json({ error: 'forbidden', message: '仅总经理、销售经理或超级管理员可执行此操作' });
  }
  next();
}
