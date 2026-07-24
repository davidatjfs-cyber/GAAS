/**
 * Auth domain service — login / me / switch-store / change-password / login-as.
 * Returns { status, body }; does not touch Express req/res (ctx carries fields).
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { tenantContext, runWithSystemTenantContext } from '../../utils/database.js';
import { resolveExplicitTenantId } from '../../tenant-login.js';
import { resolveUserPermissionContext } from '../../services/hrms-permission-engine.js';
import { pickEffectiveStore } from '../../store-duty-bindings.js';
import { SHARED_TABLES } from '@gaas/shared';
import { LOCAL_TEST_ACCOUNTS, buildLoginUserPayload } from './login-helpers.js';

function ok(body, status = 200) {
  return { status, body };
}

function fail(status, body) {
  return { status, body };
}

/** Shared login: resolve tenant from username when client didn't send one. */
export async function lookupTenantIdByUsername(username, { pool }) {
  try {
    const r = await runWithSystemTenantContext(() =>
      pool.query('select tenant_id from users where lower(username) = lower($1) limit 1', [username])
    );
    return String(r.rows?.[0]?.tenant_id || '').trim() || 'default';
  } catch (e) {
    return 'default';
  }
}

/**
 * @param {{ body?: object, headers?: object, reqLike?: object }} ctx
 *   reqLike is passed to recordLogin / buildLoginUserPayload (original Express req).
 */
export async function login(ctx, deps) {
  let tenantId;
  try {
    tenantId = resolveExplicitTenantId({ body: ctx.body, headers: ctx.headers });
  } catch (e) {
    return fail(400, { error: 'invalid_tenant_id' });
  }
  if (!tenantId) {
    const username = String(ctx.body?.username || '').trim();
    tenantId = username ? await lookupTenantIdByUsername(username, deps) : 'default';
  }
  return tenantContext.run(tenantId, () => loginInTenant(ctx, deps, tenantId));
}

export async function loginInTenant(ctx, deps, tenantId) {
  const {
    pool,
    JWT_SECRET,
    DATABASE_URL,
    normalizeRoleForJwt,
    normalizeUsersTableRole,
    employeeAccountShouldDisable,
    recordLogin,
    storeSessionNonce,
    loadTenantRuntimeStatus,
  } = deps;

  const username = String(ctx.body?.username || '').trim();
  const password = String(ctx.body?.password || '').trim();
  if (!username || !password) return fail(400, { error: 'missing_credentials' });

  const sn = randomUUID().replace(/-/g, '').slice(0, 16);
  const reqLike = ctx.reqLike;

  try {
    const tenantStatus = await loadTenantRuntimeStatus(tenantId);
    if (!tenantStatus.loginAllowed) {
      return fail(403, { error: tenantStatus.reason || 'tenant_unavailable' });
    }
  } catch (e) {
    return fail(500, { error: 'tenant_status_check_failed' });
  }

  // 数据库账号校验：仅依赖 DATABASE_URL；JWT_SECRET 仅在签发 token 时必需
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
        if (u.is_active === false) return fail(403, { error: 'user_inactive' });
        const pwdOk = await bcrypt.compare(password, String(u.password_hash || ''));
        if (!pwdOk) return fail(401, { error: 'invalid_credentials' });
        if (!JWT_SECRET) {
          return fail(500, {
            error: 'server_config_error',
            message: 'JWT_SECRET 未配置，无法签发登录令牌'
          });
        }

        let finalRole = normalizeRoleForJwt(u.role);
        let finalName = u.real_name;
        let stateStore = '';
        let permissionGroupId = null;
        try {
          const sr = await pool.query(
            `select data from ${SHARED_TABLES.HRMS_STATE} where key = $1 limit 1`,
            [String(u.tenant_id || 'default').trim() || 'default']
          );
          const sd = sr.rows?.[0]?.data;
          if (sd && typeof sd === 'object') {
            const allState = (Array.isArray(sd.employees) ? sd.employees : []).concat(
              Array.isArray(sd.users) ? sd.users : []
            );
            const stateUser = allState.find(
              (x) => String(x?.username || '').trim().toLowerCase() === u.username.toLowerCase()
            );
            if (stateUser) {
              if (employeeAccountShouldDisable(stateUser)) {
                return fail(403, { error: 'user_inactive', message: '账号已停用或已离职' });
              }
              const stateRole = normalizeRoleForJwt(stateUser.role);
              if (stateRole && stateRole !== 'store_employee') finalRole = stateRole;
              else if (stateRole) finalRole = stateRole;
              if (stateUser.name) finalName = String(stateUser.name).trim() || finalName;
              stateStore = String(stateUser.store || '').trim();
              permissionGroupId = String(stateUser.permissionGroupId || '').trim() || null;
            }
          }
        } catch (syncErr) { /* ignore */ }

        const persisted = await storeSessionNonce(u.username, sn, tenantId);
        if (!persisted) {
          return fail(503, {
            error: 'session_persist_failed',
            message:
              '无法写入登录会话（请确认数据库可写、已建表 user_sessions，且生产环境 ENABLE_DB_WRITE=true）。请勿重复尝试同一密码以免锁定误判。'
          });
        }
        const token = jwt.sign(
          {
            id: u.id,
            username: u.username,
            name: finalName,
            role: finalRole,
            sn,
            tenant_id: String(u.tenant_id || 'default').trim() || 'default',
          },
          JWT_SECRET,
          { expiresIn: '7d' }
        );
        recordLogin(u.username, sn, reqLike, u.tenant_id);
        const loginUser = await buildLoginUserPayload(deps, {
          id: u.id,
          username: u.username,
          name: finalName,
          role: finalRole,
          stateStore,
          permissionGroupId,
          tenantId: String(u.tenant_id || tenantId || 'default').trim() || 'default',
        });
        return ok({ token, user: loginUser });
      }
    } catch (dbErr) {
      console.log('DB login failed, falling back to local accounts:', dbErr.message);
    }
  }

  // Fallback: hrms_state plaintext users/employees
  try {
    const r = await pool.query(
      `select data from ${SHARED_TABLES.HRMS_STATE} where key = $1 limit 1`,
      [tenantId]
    );
    const data = r.rows?.[0]?.data;
    if (data && typeof data === 'object') {
      const users = Array.isArray(data.users) ? data.users : [];
      const employees = Array.isArray(data.employees) ? data.employees : [];
      const all = employees.concat(users);
      const found = all.find(
        (u) => String(u?.username || '').trim().toLowerCase() === username.toLowerCase()
      );
      if (found) {
        if (employeeAccountShouldDisable(found)) return fail(403, { error: 'user_inactive' });
        const pwd = String(found.password || '');
        if (pwd !== password) return fail(401, { error: 'invalid_credentials' });

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
        if (!JWT_SECRET) return fail(500, { error: 'server_config_error' });
        const persistedState = await storeSessionNonce(canonicalUsername, sn, tenantId);
        if (!persistedState) {
          return fail(503, {
            error: 'session_persist_failed',
            message:
              '无法写入登录会话（请确认数据库可写且已建表 user_sessions；生产需 ENABLE_DB_WRITE=true）。'
          });
        }
        const token = jwt.sign(
          { id, username: canonicalUsername, name, role, sn, tenant_id: tenantId },
          JWT_SECRET,
          { expiresIn: '7d' }
        );
        recordLogin(canonicalUsername, sn, reqLike, tenantId);
        const loginUser = await buildLoginUserPayload(deps, {
          id,
          username: canonicalUsername,
          name,
          role,
          stateStore,
          permissionGroupId: String(found.permissionGroupId || '').trim() || null,
          tenantId,
        });
        return ok({ token, user: loginUser });
      }
    }
  } catch (e) {
    console.log('State login failed:', e?.message || e);
  }

  // H4-FIX: 本地测试账号仅在开发环境可用
  if (process.env.NODE_ENV !== 'production') {
    const localUser = LOCAL_TEST_ACCOUNTS.find((u) => u.username === username && u.password === password);
    if (localUser) {
      if (!JWT_SECRET) return fail(500, { error: 'server_config_error' });
      const persistedLocal = await storeSessionNonce(localUser.username, sn, tenantId);
      if (!persistedLocal) {
        return fail(503, { error: 'session_persist_failed', message: '无法写入登录会话' });
      }
      const token = jwt.sign(
        {
          id: localUser.id,
          username: localUser.username,
          name: localUser.name,
          role: localUser.role,
          sn,
          tenant_id: tenantId,
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      const loginUser = await buildLoginUserPayload(deps, {
        id: localUser.id,
        username: localUser.username,
        name: localUser.name,
        role: localUser.role,
        stateStore: '',
        tenantId,
      });
      return ok({ token, user: loginUser });
    }
  }

  return fail(401, { error: 'invalid_credentials' });
}

export async function getAuthMe(ctx, deps) {
  const { getUserStoreAccessContext, normalizeRoleForJwt, getSharedState } = deps;
  const username = String(ctx.user?.username || '').trim();
  const role = normalizeRoleForJwt(ctx.user?.role);
  const stateStore = String(ctx.user?.current_store || ctx.user?.store || '').trim();
  const storeCtx = await getUserStoreAccessContext(username, role, {
    requestedStore: stateStore,
    stateStore,
  }).catch(() => null);
  let permissionGroupId = null;
  try {
    const state = (await getSharedState(ctx.tenantId)) || {};
    const allEmp = (Array.isArray(state.employees) ? state.employees : []).concat(
      Array.isArray(state.users) ? state.users : []
    );
    const stateUser = allEmp.find(
      (x) => String(x?.username || '').trim().toLowerCase() === username.toLowerCase()
    );
    permissionGroupId = String(stateUser?.permissionGroupId || '').trim() || null;
  } catch (e) { /* ignore */ }
  const user = {
    ...ctx.user,
    primary_store: storeCtx?.primaryStore || ctx.user?.primary_store,
    current_store: storeCtx?.currentStore || ctx.user?.current_store,
    allowed_stores: storeCtx?.allowedStores?.length
      ? storeCtx.allowedStores
      : (ctx.user?.allowed_stores || []),
    permission_group_id: permissionGroupId
  };
  return ok({ user });
}

export async function getMe(ctx, deps) {
  const { getSharedState } = deps;
  const username = String(ctx.user?.username || '').trim();
  const role = String(ctx.user?.role || '').trim();
  if (!username) return fail(400, { error: 'missing_user' });
  try {
    const state = (await getSharedState()) || {};
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const users = Array.isArray(state.users) ? state.users : [];
    const emp = employees.find((e) => String(e?.username || '').trim() === username) || {};
    const usr = users.find((u) => String(u?.username || '').trim() === username) || {};
    const permCtx = await resolveUserPermissionContext(
      ctx.reqLike || { tenantId: ctx.tenantId, user: ctx.user },
      { getSharedState }
    );
    return ok({
      user: {
        username,
        name: emp.name || usr.name || username,
        role: role || emp.role || usr.role || 'employee',
        store: emp.store || usr.store || ctx.user?.store || '',
        position: emp.position || usr.position || '',
        department: emp.department || usr.department || '',
        permission_group_id: permCtx.permission_group_id || null,
        enforcement_mode: permCtx.enforcement_mode || 'legacy',
        permissions: permCtx.permissions || [],
        allowed_stores: ctx.user?.allowed_stores || [],
        current_store: ctx.user?.current_store || '',
      }
    });
  } catch (e) {
    return fail(500, { error: 'server_error', message: 'internal_error' });
  }
}

export async function switchStore(ctx, deps) {
  const {
    JWT_SECRET,
    getSharedState,
    normalizeRoleForJwt,
    getUserStoreAccessContext,
    pickMyStoreFromState,
  } = deps;
  const username = String(ctx.user?.username || '').trim();
  const role = normalizeRoleForJwt(ctx.user?.role);
  const requestedStore = String(ctx.body?.store || '').trim();
  if (!requestedStore) return fail(400, { error: 'missing_store' });
  if (!JWT_SECRET) return fail(500, { error: 'server_config_error' });
  try {
    const state0 = (await getSharedState().catch(() => null)) || {};
    const stateStore = String(pickMyStoreFromState(state0, username) || ctx.user?.store || '').trim();
    const storeCtx = await getUserStoreAccessContext(username, role, {
      requestedStore,
      stateStore
    });
    const nextStore = pickEffectiveStore(storeCtx, requestedStore);
    if (!nextStore || nextStore !== requestedStore) {
      return fail(403, { error: 'store_forbidden' });
    }
    const { iat: _iat, exp: _exp, ...restUser } = ctx.user || {};
    const nextPayload = {
      ...restUser,
      role,
      store: stateStore,
      primary_store: storeCtx.primaryStore,
      current_store: nextStore,
      allowed_stores: storeCtx.allowedStores
    };
    const token = jwt.sign(nextPayload, JWT_SECRET, { expiresIn: '7d' });
    return ok({ token, user: nextPayload });
  } catch (e) {
    return fail(500, { error: 'server_error', message: 'internal_error' });
  }
}

export async function changePassword(ctx, deps) {
  const { pool, getSharedState, normalizeUsersTableRole } = deps;
  const username = String(ctx.user?.username || '').trim();
  const tenantId = String(ctx.tenantId || ctx.user?.tenant_id || 'default').trim() || 'default';
  const oldPassword = String(ctx.body?.oldPassword || '').trim();
  const newPassword = String(ctx.body?.newPassword || '').trim();
  if (!username) return fail(400, { error: 'missing_user' });
  if (!oldPassword || !newPassword) return fail(400, { error: 'missing_params' });
  if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    return fail(400, { error: 'weak_password', message: '新密码至少8位，且需同时包含字母和数字' });
  }

  try {
    const dbUser = await pool.query(
      'select id, username, password_hash from users where lower(username) = lower($1) and tenant_id = $2 limit 1',
      [username, tenantId]
    );
    const row = dbUser.rows?.[0] || null;

    if (row) {
      const pwdOk = await bcrypt.compare(oldPassword, String(row.password_hash || ''));
      if (!pwdOk) return fail(400, { error: 'old_password_invalid', message: '原密码不正确' });
      const hash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        'update users set password_hash = $2 where id = $1 and tenant_id = $3',
        [row.id, hash, tenantId]
      );
      return ok({ ok: true, mode: 'db' });
    }

    const state = (await getSharedState(tenantId)) || {};
    const users = Array.isArray(state.users) ? state.users : [];
    const employees = Array.isArray(state.employees) ? state.employees : [];
    const all = employees.concat(users);
    const found = all.find(
      (u) => String(u?.username || '').trim().toLowerCase() === String(username).toLowerCase()
    );
    if (!found) return fail(404, { error: 'not_found' });
    if (String(found?.password || '') !== oldPassword) {
      return fail(400, { error: 'old_password_invalid', message: '原密码不正确' });
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
    return ok({ ok: true, mode: 'state_migrated' });
  } catch (e) {
    return fail(500, { error: 'server_error', message: 'internal_error' });
  }
}

export async function loginAs(ctx, deps) {
  const {
    pool,
    JWT_SECRET,
    normalizeRoleForJwt,
    recordLogin,
    storeSessionNonce,
  } = deps;

  if (normalizeRoleForJwt(String(ctx.user?.role || '')) !== 'admin') {
    return fail(403, { error: 'forbidden', message: '仅管理员可代登录' });
  }
  const targetUsername = String(ctx.body?.username || '').trim();
  if (!targetUsername) return fail(400, { error: 'missing_username' });
  const reason = String(ctx.body?.reason || '').trim();
  if (!reason) return fail(400, { error: 'missing_reason', message: '请填写代登录原因' });

  const adminUsername = String(ctx.user?.username || '').trim();
  const sn = randomUUID().replace(/-/g, '').slice(0, 16);
  const reqLike = ctx.reqLike;

  try {
    let targetId, targetUsernameNorm, finalRole, finalName, needCreateUser = false;

    const r = await pool.query(
      'SELECT id, username, real_name, role, is_active, tenant_id FROM users WHERE lower(username) = lower($1) AND tenant_id = $2 LIMIT 1',
      [targetUsername, ctx.tenantId || ctx.user?.tenant_id || 'default']
    );
    const u = r.rows?.[0];
    let targetTenantId = ctx.tenantId || ctx.user?.tenant_id || 'default';

    if (u) {
      const uTenantId = String(u.tenant_id || 'default').trim() || 'default';
      if (uTenantId !== targetTenantId) {
        return fail(404, { error: 'user_not_found', message: '目标用户不存在' });
      }
      targetId = String(u.id || u.username);
      targetUsernameNorm = String(u.username).trim();
      finalRole = normalizeRoleForJwt(u.role);
      finalName = u.real_name || u.username;
    } else {
      const sr = await pool.query(
        `SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 LIMIT 1`,
        [targetTenantId]
      );
      const sd = sr.rows?.[0]?.data;
      if (!sd || typeof sd !== 'object') {
        return fail(404, { error: 'user_not_found', message: '目标用户不存在' });
      }

      const allState = (Array.isArray(sd.employees) ? sd.employees : []).concat(
        Array.isArray(sd.users) ? sd.users : []
      );
      const stateUser = allState.find(
        (x) => String(x?.username || '').trim().toLowerCase() === targetUsername.toLowerCase()
      );
      if (!stateUser) return fail(404, { error: 'user_not_found', message: '目标用户不存在' });

      targetId = String(stateUser.id || stateUser.username).trim();
      targetUsernameNorm = String(stateUser.username).trim();
      finalRole = normalizeRoleForJwt(stateUser.role);
      finalName = String(stateUser.name || stateUser.username).trim();

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
        try {
          await pool.query(
            `UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE lower(username) = lower($1) AND tenant_id = $2`,
            [targetUsernameNorm, targetTenantId]
          );
        } catch (e2) { /* ignore */ }
      }
      needCreateUser = true;
    }

    if (!needCreateUser) {
      try {
        const sr = await pool.query(
          `SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 LIMIT 1`,
          [targetTenantId]
        );
        const sd = sr.rows?.[0]?.data;
        if (sd && typeof sd === 'object') {
          const allState = (Array.isArray(sd.employees) ? sd.employees : []).concat(
            Array.isArray(sd.users) ? sd.users : []
          );
          const stateUser = allState.find(
            (x) => String(x?.username || '').trim().toLowerCase() === targetUsername.toLowerCase()
          );
          if (stateUser) {
            const stateRole = normalizeRoleForJwt(stateUser.role);
            if (stateRole) finalRole = stateRole;
            if (stateUser.name) finalName = String(stateUser.name).trim() || finalName;
          }
        }
      } catch (e) { /* ignore */ }
    }

    await pool.query(
      'UPDATE users SET is_active = TRUE, updated_at = NOW() WHERE lower(username) = lower($1) AND tenant_id = $2',
      [targetUsernameNorm, targetTenantId]
    );

    const persisted = await storeSessionNonce(targetUsernameNorm, sn, targetTenantId);
    if (!persisted) return fail(503, { error: 'session_persist_failed' });

    const token = jwt.sign(
      {
        id: targetId,
        username: targetUsernameNorm,
        name: finalName,
        role: finalRole,
        sn,
        loginAs: true,
        loginAsBy: adminUsername,
        tenant_id: targetTenantId,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    recordLogin(targetUsernameNorm, sn, reqLike, targetTenantId);
    console.log(`[login-as] admin=${adminUsername} logged in as ${targetUsernameNorm} (reason: ${reason})`);
    return ok({
      token,
      user: { id: targetId, username: targetUsernameNorm, name: finalName, role: finalRole },
      loginAs: true,
      loginAsBy: adminUsername,
    });
  } catch (e) {
    console.error('[login-as] error:', e?.message || e);
    return fail(500, { error: 'server_error' });
  }
}

export async function logout(ctx, deps) {
  const { recordLogout } = deps;
  const username = String(ctx.user?.username || '').trim();
  if (username) await recordLogout(username);
  return ok({ ok: true });
}

export async function heartbeat(ctx, deps) {
  const { pool } = deps;
  const username = String(ctx.user?.username || '').trim();
  if (!username) return ok({ ok: true });
  const key = username.toLowerCase();
  let client;
  try {
    client = await pool.connect();
    await client.query('SET default_transaction_read_only = OFF');
    await client.query(
      `update user_login_log set logout_at = now()
       where id = (select id from user_login_log where lower(username) = $1 order by login_at desc limit 1)`,
      [key]
    );
  } catch (_e) { /* ignore heartbeat errors */ }
  finally { try { if (client) client.release(); } catch (_e2) { /* ignore */ } }
  return ok({ ok: true });
}
