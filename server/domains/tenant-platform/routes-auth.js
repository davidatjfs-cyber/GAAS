import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { PLATFORM_ADMIN_ROLES, requireSuperAdmin } from './auth-guards.js';
import { platformAdminHtmlPath } from './helpers.js';

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformAuthRoutes(app, deps) {
  const {
    pool,
    platformAdminRequired,
    platformAdminSessionRequired = platformAdminRequired,
    loginRateLimit,
    PLATFORM_ADMIN_SECRET,
    PLATFORM_ADMIN_JWT_SECRET,
  } = deps;

  app.get(['/sales-crm', '/sales-crm/'], (_req, res) => {
    res.sendFile(platformAdminHtmlPath());
  });

  // ── 平台管理员账号：登录 / 一次性bootstrap创建首个账号 / 已登录后创建更多账号 ──
  app.post('/api/admin/auth/bootstrap', async (req, res) => {
    try {
      if (!PLATFORM_ADMIN_SECRET) {
        return res.status(500).json({ error: 'server_config_error', message: 'PLATFORM_ADMIN_SECRET 未配置，无法bootstrap' });
      }
      const provided = String(req.headers['x-platform-admin-secret'] || '').trim();
      if (!provided || provided !== PLATFORM_ADMIN_SECRET) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const existing = await pool.query(`SELECT 1 FROM platform_admins LIMIT 1`);
      if (existing.rows.length > 0) {
        return res.status(403).json({ error: 'already_bootstrapped', message: '已存在平台管理员账号，bootstrap接口已永久失效，请用账号密码登录' });
      }
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '').trim();
      const realName = String(req.body?.real_name || '').trim() || username;
      if (!username || password.length < 8) {
        return res.status(400).json({ error: 'invalid_input', message: 'username必填，password至少8位' });
      }
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO platform_admins (username, password_hash, real_name) VALUES ($1,$2,$3)`,
        [username, hash, realName]
      );
      return res.json({ ok: true, message: '首个平台管理员账号已创建，请用账号密码登录' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  app.post('/api/admin/auth/login', loginRateLimit, async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '').trim();
      if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });
      const r = await pool.query(
        `SELECT id, username, password_hash, real_name, status, role FROM platform_admins WHERE lower(username) = lower($1) LIMIT 1`,
        [username]
      );
      const acc = r.rows?.[0];
      if (!acc || acc.status !== 'active') return res.status(401).json({ error: 'invalid_credentials' });
      const ok = await bcrypt.compare(password, String(acc.password_hash || ''));
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
      const accountRole = acc.role || 'super_admin';
      const token = jwt.sign({ username: acc.username, role: 'platform_admin', account_role: accountRole }, PLATFORM_ADMIN_JWT_SECRET, { expiresIn: '12h' });
      await pool.query(`UPDATE platform_admins SET last_login_at = NOW() WHERE id = $1`, [acc.id]).catch(() => {});
      return res.json({ ok: true, token, admin: { username: acc.username, real_name: acc.real_name, role: accountRole } });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  // 创建新账号本身是敏感操作(尤其能创建super_admin)，只有super_admin能做。
  app.post('/api/admin/auth/accounts', platformAdminRequired, requireSuperAdmin, async (req, res) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '').trim();
      const realName = String(req.body?.real_name || '').trim() || username;
      const role = String(req.body?.role || '').trim();
      if (!username || password.length < 8) {
        return res.status(400).json({ error: 'invalid_input', message: 'username必填，password至少8位' });
      }
      if (!PLATFORM_ADMIN_ROLES.includes(role)) {
        return res.status(400).json({ error: 'invalid_role', message: `role必须是以下之一：${PLATFORM_ADMIN_ROLES.join('、')}` });
      }
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO platform_admins (username, password_hash, real_name, role) VALUES ($1,$2,$3,$4)`,
        [username, hash, realName, role]
      );
      return res.json({ ok: true });
    } catch (e) {
      if (String(e?.message || '').includes('duplicate')) {
        return res.status(409).json({ error: 'username_taken' });
      }
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/auth/accounts', platformAdminRequired, requireSuperAdmin, async (req, res) => {
    try {
      const r = await pool.query(`SELECT username, real_name, status, role, created_at, last_login_at FROM platform_admins ORDER BY created_at`);
      return res.json({ ok: true, accounts: r.rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });

  app.get('/api/admin/auth/audit-log', platformAdminSessionRequired, async (req, res) => {
    try {
      if (!['super_admin', 'auditor'].includes(req.platformAdmin?.role)) {
        return res.status(403).json({ error: 'forbidden', message: '仅超级管理员或只读审计人员可查看审计日志' });
      }
      const limit = Math.min(Number(req.query?.limit) || 200, 1000);
      const r = await pool.query(
        `SELECT admin_username, method, path, target_tenant_id, detail, ip, created_at
         FROM platform_admin_audit_log ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      return res.json({ ok: true, items: r.rows });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: e?.message });
    }
  });
}
