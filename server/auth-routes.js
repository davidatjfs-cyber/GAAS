/**
 * 登录/鉴权相关路由，从 index.js 拆出（架构拆分阶段A，第一批：已有P0集成测试覆盖）。
 *
 * 这部分和 index.js 里其余业务逻辑耦合较深（门店权限、租户运行状态、共享state等
 * 都是全局共用的工具函数），没有跟着一起搬——按 registerAgentRoutes/registerMasterRoutes
 * 等既有模式，通过 deps 参数注入，而不是从这里 import index.js（避免引入本仓库
 * 从未用过的"子模块反向依赖入口文件"写法）。
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { tenantContext, runWithSystemTenantContext } from './utils/database.js';
import { resolveExplicitTenantId } from './tenant-login.js';
import { resolveUserPermissionContext } from './services/hrms-permission-engine.js';
import { pickEffectiveStore } from './store-duty-bindings.js';

// 本地开发/DB不可用时的兜底账号
const LOCAL_TEST_ACCOUNTS = [
  { id: 1, username: 'admin', password: 'admin123', name: '系统管理员', role: 'admin' }
];

export function registerAuthRoutes(app, authRequired, loginRateLimit, deps) {
  const {
    pool,
    JWT_SECRET,
    DATABASE_URL,
    getSharedState,
    normalizeRoleForJwt,
    normalizeUsersTableRole,
    employeeAccountShouldDisable,
    getUserStoreAccessContext,
    pickMyStoreFromState,
    recordLogin,
    recordLogout,
    storeSessionNonce,
    loadTenantRuntimeStatus,
  } = deps;

  async function buildLoginUserPayload({ id, username, name, role, stateStore, permissionGroupId, tenantId, reqLike }) {
    const ctx = await getUserStoreAccessContext(username, role, {
      requestedStore: stateStore,
      stateStore
    });
    let permCtx = { enforcement_mode: 'legacy', permissions: [] };
    try {
      permCtx = await resolveUserPermissionContext(
        reqLike || {
          tenantId: tenantId || 'default',
          user: {
            username,
            role,
            tenant_id: tenantId || 'default',
            store: stateStore,
            allowed_stores: ctx.allowedStores,
            current_store: ctx.currentStore,
          },
        },
        { getSharedState, permissionGroupId }
      );
    } catch (_) {}
    return {
      id,
      username,
      name,
      role,
      store: stateStore,
      primary_store: ctx.primaryStore,
      current_store: ctx.currentStore,
      allowed_stores: ctx.allowedStores,
      permission_group_id: permissionGroupId || null,
      enforcement_mode: permCtx.enforcement_mode || 'legacy',
      permissions: Array.isArray(permCtx.permissions) ? permCtx.permissions : [],
    };
  }

  // Shared login domain has no subdomain/path to carry the tenant, so when the
  // client didn't send one explicitly, resolve it from the (globally-unique)
  // username instead. Unknown/not-found usernames fall back to 'default' so the
  // existing single-tenant behavior is unchanged for callers that never pass one.
  async function lookupTenantIdByUsername(username) {
    try {
      const r = await runWithSystemTenantContext(() =>
        pool.query('select tenant_id from users where lower(username) = lower($1) limit 1', [username])
      );
      return String(r.rows?.[0]?.tenant_id || '').trim() || 'default';
    } catch (e) {
      return 'default';
    }
  }

  async function handleLogin(req, res) {
    let tenantId;
    try {
      tenantId = resolveExplicitTenantId(req);
    } catch (e) {
      return res.status(400).json({ error: 'invalid_tenant_id' });
    }
    if (!tenantId) {
      const username = String(req.body?.username || '').trim();
      tenantId = username ? await lookupTenantIdByUsername(username) : 'default';
    }
    return tenantContext.run(tenantId, () => handleLoginInTenant(req, res, tenantId));
  }

  async function handleLoginInTenant(req, res, tenantId) {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '').trim();
    if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });

    const sn = randomUUID().replace(/-/g, '').slice(0, 16);

    try {
      const tenantStatus = await loadTenantRuntimeStatus(tenantId);
      if (!tenantStatus.loginAllowed) {
        return res.status(403).json({ error: tenantStatus.reason || 'tenant_unavailable' });
      }
    } catch (e) {
      return res.status(500).json({ error: 'tenant_status_check_failed' });
    }

    // 数据库账号校验：仅依赖 DATABASE_URL；JWT_SECRET 仅在签发 token 时必需（勿与 requireEnv 绑死，否则缺 JWT 时整段 DB 校验被跳过 → 全员 401）
    if (DATABASE_URL) {
      try {
        const r = await pool.query(
          `select id, username, password_hash, real_name, role, is_active, tenant_id
             from users
            where lower(username) = lower($1) and tenant_id = $2
            limit 1`,
          [username, tenantId]
        );
        const u = r.rows?.[0];
        if (u) {
          if (u.is_active === false) return res.status(403).json({ error: 'user_inactive' });
          const ok = await bcrypt.compare(password, String(u.password_hash || ''));
          if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
          if (!JWT_SECRET) {
            return res.status(500).json({
              error: 'server_config_error',
              message: 'JWT_SECRET 未配置，无法签发登录令牌'
            });
          }

          // Sync role from shared-state (authoritative source for role edits made in frontend)
          let finalRole = normalizeRoleForJwt(u.role);
          let finalName = u.real_name;
          let stateStore = '';
          let permissionGroupId = null;
          try {
            const sr = await pool.query('select data from hrms_state where key = $1 limit 1', [String(u.tenant_id || 'default').trim() || 'default']);
            const sd = sr.rows?.[0]?.data;
            if (sd && typeof sd === 'object') {
              // employees first – real users live there
              const allState = (Array.isArray(sd.employees) ? sd.employees : []).concat(Array.isArray(sd.users) ? sd.users : []);
              const stateUser = allState.find(x => String(x?.username || '').trim().toLowerCase() === u.username.toLowerCase());
              if (stateUser) {
                if (employeeAccountShouldDisable(stateUser)) {
                  return res.status(403).json({ error: 'user_inactive', message: '账号已停用或已离职' });
                }
                const stateRole = normalizeRoleForJwt(stateUser.role);
                if (stateRole && stateRole !== 'store_employee') finalRole = stateRole;
                else if (stateRole) finalRole = stateRole;
                if (stateUser.name) finalName = String(stateUser.name).trim() || finalName;
                stateStore = String(stateUser.store || '').trim();
                permissionGroupId = String(stateUser.permissionGroupId || '').trim() || null;
              }
            }
          } catch (syncErr) {}

          const persisted = await storeSessionNonce(u.username, sn, tenantId);
          if (!persisted) {
            return res.status(503).json({
              error: 'session_persist_failed',
              message:
                '无法写入登录会话（请确认数据库可写、已建表 user_sessions，且生产环境 ENABLE_DB_WRITE=true）。请勿重复尝试同一密码以免锁定误判。'
            });
          }
          const token = jwt.sign(
            { id: u.id, username: u.username, name: finalName, role: finalRole, sn, tenant_id: String(u.tenant_id || 'default').trim() || 'default' },
            JWT_SECRET,
            { expiresIn: '7d' }
          );
          recordLogin(u.username, sn, req, u.tenant_id);
          const loginUser = await buildLoginUserPayload({
            id: u.id,
            username: u.username,
            name: finalName,
            role: finalRole,
            stateStore,
            permissionGroupId,
            tenantId: String(u.tenant_id || tenantId || 'default').trim() || 'default',
          });
          return res.json({
            token,
            user: loginUser
          });
        }
      } catch (dbErr) {
        console.log('DB login failed, falling back to local accounts:', dbErr.message);
      }
    }

    // Fallback to server-side saved state (hrms_state), so newly created employees can login.
    // Legacy path: tenant is unknown until a username match is found, so this only ever
    // searches the 'default' tenant's blob (non-default tenants have no legacy users here).
    try {
      const r = await pool.query('select data from hrms_state where key = $1 limit 1', [tenantId]);
      const data = r.rows?.[0]?.data;
      if (data && typeof data === 'object') {
        const users = Array.isArray(data.users) ? data.users : [];
        const employees = Array.isArray(data.employees) ? data.employees : [];
        // employees first – real users live there
        const all = employees.concat(users);
        const found = all.find(u => String(u?.username || '').trim().toLowerCase() === username.toLowerCase());
        if (found) {
          if (employeeAccountShouldDisable(found)) return res.status(403).json({ error: 'user_inactive' });
          const pwd = String(found.password || '');
          if (pwd !== password) return res.status(401).json({ error: 'invalid_credentials' });

          // C4-FIX: 明文登录成功的这一刻，顺手把该用户迁移到 users 表（bcrypt），
          // 之后这个用户会走上面的 DATABASE_URL 分支，不再经过明文比对。失败不影响本次登录。
          try {
            const migrateHash = await bcrypt.hash(password, 10);
            const migrateRole = normalizeUsersTableRole(found.role);
            const migrateRealName = String(found.name || found.real_name || found.realName || username);
            await pool.query(
              `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
               values ($1, $2, $3, $4, true, $5)
               on conflict (username) do nothing`,
              [username, migrateHash, migrateRealName, migrateRole, tenantId]
            );
          } catch (migrateErr) {
            console.log('[password-migrate] login-time migration failed (non-fatal):', migrateErr?.message);
          }

          const role = normalizeRoleForJwt(found.role);
          const canonicalUsername = String(found.username || '').trim() || username;
          const id = String(found.id || canonicalUsername);
          const name = String(found.name || found.real_name || found.realName || canonicalUsername);
          const stateStore = String(found.store || '').trim();
          if (!JWT_SECRET) return res.status(500).json({ error: 'server_config_error' });
          const persistedState = await storeSessionNonce(canonicalUsername, sn, tenantId);
          if (!persistedState) {
            return res.status(503).json({
              error: 'session_persist_failed',
              message:
                '无法写入登录会话（请确认数据库可写且已建表 user_sessions；生产需 ENABLE_DB_WRITE=true）。'
            });
          }
          const token = jwt.sign({ id, username: canonicalUsername, name, role, sn, tenant_id: tenantId }, JWT_SECRET, { expiresIn: '7d' });
          recordLogin(canonicalUsername, sn, req, tenantId);
          const loginUser = await buildLoginUserPayload({
            id,
            username: canonicalUsername,
            name,
            role,
            stateStore,
            permissionGroupId: String(found.permissionGroupId || '').trim() || null,
            tenantId,
          });
          return res.json({ token, user: loginUser });
        }
      }
    } catch (e) {
      console.log('State login failed:', e?.message || e);
    }

    // H4-FIX: 本地测试账号仅在开发环境可用
    if (process.env.NODE_ENV !== 'production') {
      const localUser = LOCAL_TEST_ACCOUNTS.find(u => u.username === username && u.password === password);
      if (localUser) {
        if (!JWT_SECRET) return res.status(500).json({ error: 'server_config_error' });
        const persistedLocal = await storeSessionNonce(localUser.username, sn, tenantId);
        if (!persistedLocal) {
          return res.status(503).json({ error: 'session_persist_failed', message: '无法写入登录会话' });
        }
        const token = jwt.sign(
          { id: localUser.id, username: localUser.username, name: localUser.name, role: localUser.role, sn, tenant_id: tenantId },
          JWT_SECRET,
          { expiresIn: '7d' }
        );
        const loginUser = await buildLoginUserPayload({
          id: localUser.id,
          username: localUser.username,
          name: localUser.name,
          role: localUser.role,
          stateStore: '',
          tenantId,
        });
        return res.json({
          token,
          user: loginUser
        });
      }
    }

    return res.status(401).json({ error: 'invalid_credentials' });
  }

  app.get('/api/auth/me', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = normalizeRoleForJwt(req.user?.role);
    const stateStore = String(req.user?.current_store || req.user?.store || '').trim();
    const ctx = await getUserStoreAccessContext(username, role, {
      requestedStore: stateStore,
      stateStore,
    }).catch(() => null);
    // 权限组不在JWT里(避免长期token里存陈旧分组)，每次/me都从最新state读取，
    // 管理员改了分配不用等7天token过期/重新登录就能生效
    let permissionGroupId = null;
    try {
      const state = (await getSharedState(req.tenantId)) || {};
      const allEmp = (Array.isArray(state.employees) ? state.employees : []).concat(Array.isArray(state.users) ? state.users : []);
      const stateUser = allEmp.find(x => String(x?.username || '').trim().toLowerCase() === username.toLowerCase());
      permissionGroupId = String(stateUser?.permissionGroupId || '').trim() || null;
    } catch (e) {}
    const user = {
      ...req.user,
      primary_store: ctx?.primaryStore || req.user?.primary_store,
      current_store: ctx?.currentStore || req.user?.current_store,
      allowed_stores: ctx?.allowedStores?.length ? ctx.allowedStores : (req.user?.allowed_stores || []),
      permission_group_id: permissionGroupId
    };
    return res.json({ user });
  });

  app.post('/api/auth/switch-store', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = normalizeRoleForJwt(req.user?.role);
    const requestedStore = String(req.body?.store || '').trim();
    if (!requestedStore) return res.status(400).json({ error: 'missing_store' });
    if (!JWT_SECRET) return res.status(500).json({ error: 'server_config_error' });
    try {
      const state0 = (await getSharedState().catch(() => null)) || {};
      const stateStore = String(pickMyStoreFromState(state0, username) || req.user?.store || '').trim();
      const ctx = await getUserStoreAccessContext(username, role, {
        requestedStore,
        stateStore
      });
      const nextStore = pickEffectiveStore(ctx, requestedStore);
      if (!nextStore || nextStore !== requestedStore) {
        return res.status(403).json({ error: 'store_forbidden' });
      }
      // Strip JWT reserved claims before re-signing to avoid "There is an existing exp value" error
      const { iat: _iat, exp: _exp, ...restUser } = req.user;
      const nextPayload = {
        ...restUser,
        role,
        store: stateStore,
        primary_store: ctx.primaryStore,
        current_store: nextStore,
        allowed_stores: ctx.allowedStores
      };
      const token = jwt.sign(nextPayload, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: nextPayload });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/auth/change-password', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const tenantId = String(req.tenantId || req.user?.tenant_id || 'default').trim() || 'default';
    const oldPassword = String(req.body?.oldPassword || '').trim();
    const newPassword = String(req.body?.newPassword || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'missing_params' });
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return res.status(400).json({ error: 'weak_password', message: '新密码至少8位，且需同时包含字母和数字' });
    }

    try {
      const dbUser = await pool.query(
        'select id, username, password_hash from users where lower(username) = lower($1) and tenant_id = $2 limit 1',
        [username, tenantId]
      );
      const row = dbUser.rows?.[0] || null;

      if (row) {
        const ok = await bcrypt.compare(oldPassword, String(row.password_hash || ''));
        if (!ok) return res.status(400).json({ error: 'old_password_invalid', message: '原密码不正确' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('update users set password_hash = $2 where id = $1 and tenant_id = $3', [row.id, hash, tenantId]);
        // C4-FIX: 不再把新密码明文写回 hrms_state（此前会导致每次改密码都产生一份新的明文密码）
        return res.json({ ok: true, mode: 'db' });
      }

      // Fallback mode: 用户还没进 users 表，仍用 hrms_state 校验旧密码，
      // 但改密码这一刻起就把该用户迁移到 users 表（bcrypt），不再写明文。
      const state = (await getSharedState(tenantId)) || {};
      const users = Array.isArray(state.users) ? state.users : [];
      const employees = Array.isArray(state.employees) ? state.employees : [];
      const all = employees.concat(users);
      const found = all.find(u => String(u?.username || '').trim().toLowerCase() === String(username).toLowerCase());
      if (!found) return res.status(404).json({ error: 'not_found' });
      if (String(found?.password || '') !== oldPassword) {
        return res.status(400).json({ error: 'old_password_invalid', message: '原密码不正确' });
      }

      const hash = await bcrypt.hash(newPassword, 10);
      const role = normalizeUsersTableRole(found.role);
      const realName = String(found.name || found.real_name || found.realName || username);
      await pool.query(
        `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
         values ($1, $2, $3, $4, true, $5)
         on conflict (username) do update set password_hash = excluded.password_hash`,
        [username, hash, realName, role, tenantId]
      );
      return res.json({ ok: true, mode: 'state_migrated' });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  app.post('/api/auth/login', loginRateLimit, handleLogin);
  // compatibility alias
  app.post('/api/login', loginRateLimit, handleLogin);

  app.post('/api/auth/login-as', authRequired, async (req, res) => {
    if (normalizeRoleForJwt(String(req.user?.role || '')) !== 'admin') {
      return res.status(403).json({ error: 'forbidden', message: '仅管理员可代登录' });
    }
    const targetUsername = String(req.body?.username || '').trim();
    if (!targetUsername) return res.status(400).json({ error: 'missing_username' });
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'missing_reason', message: '请填写代登录原因' });

    const adminUsername = String(req.user?.username || '').trim();
    const sn = randomUUID().replace(/-/g, '').slice(0, 16);

    try {
      let targetId, targetUsernameNorm, finalRole, finalName, needCreateUser = false;

      // 1) Try users table first
      const r = await pool.query(
        'SELECT id, username, real_name, role, is_active, tenant_id FROM users WHERE lower(username) = lower($1) AND tenant_id = $2 LIMIT 1',
        [targetUsername, req.tenantId || req.user?.tenant_id || 'default']
      );
      const u = r.rows?.[0];
      let targetTenantId = req.tenantId || req.user?.tenant_id || 'default';

      if (u) {
        const uTenantId = String(u.tenant_id || 'default').trim() || 'default';
        if (uTenantId !== targetTenantId) {
          return res.status(404).json({ error: 'user_not_found', message: '目标用户不存在' });
        }
        targetId = String(u.id || u.username);
        targetUsernameNorm = String(u.username).trim();
        finalRole = normalizeRoleForJwt(u.role);
        finalName = u.real_name || u.username;
      } else {
        // 2) Fallback: find in hrms_state.employees / users
        const sr = await pool.query('SELECT data FROM hrms_state WHERE key = $1 LIMIT 1', [targetTenantId]);
        const sd = sr.rows?.[0]?.data;
        if (!sd || typeof sd !== 'object') return res.status(404).json({ error: 'user_not_found', message: '目标用户不存在' });

        const allState = (Array.isArray(sd.employees) ? sd.employees : []).concat(Array.isArray(sd.users) ? sd.users : []);
        const stateUser = allState.find(x => String(x?.username || '').trim().toLowerCase() === targetUsername.toLowerCase());
        if (!stateUser) return res.status(404).json({ error: 'user_not_found', message: '目标用户不存在' });

        targetId = String(stateUser.id || stateUser.username).trim();
        targetUsernameNorm = String(stateUser.username).trim();
        finalRole = normalizeRoleForJwt(stateUser.role);
        finalName = String(stateUser.name || stateUser.username).trim();

        // Create user in users table so session nonce and JWT have a row
        try {
          const empPassword = String(stateUser.password || '123456');
          const hash = await bcrypt.hash(empPassword, 10);
          await pool.query(
            `INSERT INTO users (id, username, password_hash, real_name, role, is_active, tenant_id)
             VALUES ($1, $2, $3, $4, $5, TRUE, $6)
             ON CONFLICT (username) DO UPDATE SET is_active = TRUE, password_hash = EXCLUDED.password_hash, updated_at = NOW()`,
            [targetId, targetUsernameNorm, hash, finalName, finalRole, targetTenantId]
          );
        } catch (createErr) {
          console.error('[login-as] create user failed:', createErr?.message || createErr);
          // If create fails, try to just reactivate
          try {
            await pool.query(
              `UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE lower(username) = lower($1) AND tenant_id = $2`,
              [targetUsernameNorm, targetTenantId]
            );
          } catch (e2) {}
        }
        needCreateUser = true;
      }

      // 3) Merge role/name from state (authoritative) regardless of source
      if (!needCreateUser) {
        try {
          const sr = await pool.query('SELECT data FROM hrms_state WHERE key = $1 LIMIT 1', [targetTenantId]);
          const sd = sr.rows?.[0]?.data;
          if (sd && typeof sd === 'object') {
            const allState = (Array.isArray(sd.employees) ? sd.employees : []).concat(Array.isArray(sd.users) ? sd.users : []);
            const stateUser = allState.find(x => String(x?.username || '').trim().toLowerCase() === targetUsername.toLowerCase());
            if (stateUser) {
              const stateRole = normalizeRoleForJwt(stateUser.role);
              if (stateRole) finalRole = stateRole;
              if (stateUser.name) finalName = String(stateUser.name).trim() || finalName;
            }
          }
        } catch (e) {}
      }

      // 4) Ensure user is active for login
      await pool.query(
        'UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE lower(username) = lower($1) AND tenant_id = $2',
        [targetUsernameNorm, targetTenantId]
      );

      const persisted = await storeSessionNonce(targetUsernameNorm, sn, targetTenantId);
      if (!persisted) return res.status(503).json({ error: 'session_persist_failed' });

      const token = jwt.sign(
        { id: targetId, username: targetUsernameNorm, name: finalName, role: finalRole, sn, loginAs: true, loginAsBy: adminUsername, tenant_id: targetTenantId },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      recordLogin(targetUsernameNorm, sn, req, targetTenantId);
      console.log(`[login-as] admin=${adminUsername} logged in as ${targetUsernameNorm} (reason: ${reason})`);
      return res.json({ token, user: { id: targetId, username: targetUsernameNorm, name: finalName, role: finalRole }, loginAs: true, loginAsBy: adminUsername });
    } catch (e) {
      console.error('[login-as] error:', e?.message || e);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/auth/logout', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (username) await recordLogout(username);
    res.json({ ok: true });
  });

  // ─── 心跳接口：每隔5分钟前端上报一次，用于精确统计在线时长 ───
  app.post('/api/auth/heartbeat', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    if (!username) return res.json({ ok: true });
    const key = username.toLowerCase();
    let client;
    try {
      client = await pool.connect();
      await client.query('SET default_transaction_read_only = OFF');
      // 与 agents-service 一致：只刷新「最近一条登录」的 logout_at，避免多开会话时误更新多行
      await client.query(
        `update user_login_log set logout_at = now()
         where id = (select id from user_login_log where lower(username) = $1 order by login_at desc limit 1)`,
        [key]
      );
    } catch (_e) { /* ignore heartbeat errors */ }
    finally { try { if (client) client.release(); } catch (_e2) { /* ignore */ } }
    res.json({ ok: true });
  });
}
