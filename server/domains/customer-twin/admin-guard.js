/**
 * 培训卡审核鉴权（双通道）：
 * 1) 平台管理员 token（platform_admin JWT，独立密钥）
 * 2) 系统管理员 token（HRMS JWT，role === 'admin'）
 * 其余一律 401。
 */

import jwt from 'jsonwebtoken';
import { SYSTEM_TENANT_ID, tenantContext } from '../../utils/database.js';

export function createCustomerTwinAdminRequired({
  platformAdminJwtSecret = process.env.PLATFORM_ADMIN_JWT_SECRET || process.env.JWT_SECRET || '',
  hrmsJwtSecret = process.env.JWT_SECRET || '',
} = {}) {
  return async function customerTwinAdminRequired(req, res, next) {
    const token = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    // 通道一：平台管理员
    if (platformAdminJwtSecret) {
      try {
        const payload = jwt.verify(token, platformAdminJwtSecret);
        if (payload?.role === 'platform_admin' && payload?.username) {
          req.platformAdmin = { username: payload.username, role: payload.account_role || 'super_admin' };
          return tenantContext.run(SYSTEM_TENANT_ID, () => next());
        }
      } catch (_e) { /* 继续尝试通道二 */ }
    }

    // 通道二：系统管理员（HRMS 用户，role=admin）
    if (hrmsJwtSecret) {
      try {
        const payload = jwt.verify(token, hrmsJwtSecret);
        if (String(payload?.role || '').trim() === 'admin' && payload?.username) {
          req.twinAdmin = { username: payload.username };
          const tenantId = String(payload.tenant_id || 'default').trim() || 'default';
          return tenantContext.run(tenantId, () => next());
        }
      } catch (_e) { /* 不通过 */ }
    }

    return res.status(401).json({ error: 'unauthorized' });
  };
}
