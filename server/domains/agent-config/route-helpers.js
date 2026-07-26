/**
 * Shared gates for agent-config admin routes.
 */

export function assertAdmin(req, res) {
  const role = String(req.user?.role || '').trim();
  if (!['admin', 'hq_manager', 'hr_manager'].includes(role) && !role.startsWith('custom_')) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

export function tenantIdFromReq(req) {
  return req.tenantId || req.user?.tenant_id || 'default';
}
