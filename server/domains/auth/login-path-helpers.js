/**
 * P4 peel: loginInTenant path helpers (DB / state fallback / local test).
 */
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from '../../utils/logger.js';
import { LOCAL_TEST_ACCOUNTS, buildLoginUserPayload } from './login-helpers.js';

const log = childLogger({ domain: 'auth', handler: 'login-path-helpers' });

function fail(status, body) {
  return { status, body };
}

function ok(body, status = 200) {
  return { status, body };
}

export async function tryDbUserLogin(deps, { username, password, tenantId, sn, reqLike }) {
  const {
    pool,
    JWT_SECRET,
    normalizeRoleForJwt,
    employeeAccountShouldDisable,
    recordLogin,
    storeSessionNonce,
  } = deps;

  const r = await pool.query(
    `select id, username, password_hash, real_name, role, is_active, tenant_id
       from users
      where lower(username) = lower($1) and tenant_id = $2
      limit 1`,
    [username, tenantId]
  );
  const u = r.rows?.[0];
  if (!u) return null;

  if (u.is_active === false) return fail(403, { error: 'user_inactive' });
  const pwdOk = await bcrypt.compare(password, String(u.password_hash || ''));
  if (!pwdOk) return fail(401, { error: 'invalid_credentials' });
  if (!JWT_SECRET) {
    return fail(500, {
      error: 'server_config_error',
      message: 'JWT_SECRET 未配置，无法签发登录令牌',
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
  } catch (_syncErr) { /* ignore */ }

  const persisted = await storeSessionNonce(u.username, sn, tenantId);
  if (!persisted) {
    return fail(503, {
      error: 'session_persist_failed',
      message:
        '无法写入登录会话（请确认数据库可写、已建表 user_sessions，且生产环境 ENABLE_DB_WRITE=true）。请勿重复尝试同一密码以免锁定误判。',
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

export async function tryStateFallbackLogin(deps, { username, password, tenantId, sn, reqLike }) {
  const {
    pool,
    JWT_SECRET,
    normalizeRoleForJwt,
    normalizeUsersTableRole,
    employeeAccountShouldDisable,
    recordLogin,
    storeSessionNonce,
  } = deps;

  const r = await pool.query(
    `select data from ${SHARED_TABLES.HRMS_STATE} where key = $1 limit 1`,
    [tenantId]
  );
  const data = r.rows?.[0]?.data;
  if (!data || typeof data !== 'object') return null;

  const users = Array.isArray(data.users) ? data.users : [];
  const employees = Array.isArray(data.employees) ? data.employees : [];
  const all = employees.concat(users);
  const found = all.find(
    (u) => String(u?.username || '').trim().toLowerCase() === username.toLowerCase()
  );
  if (!found) return null;

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
    log.warn({ msg: 'password_migrate_failed', err: migrateErr?.message });
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
        '无法写入登录会话（请确认数据库可写且已建表 user_sessions；生产需 ENABLE_DB_WRITE=true）。',
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

export async function tryLocalTestLogin(deps, { username, password, tenantId, sn }) {
  if (process.env.NODE_ENV === 'production') return null;

  const localUser = LOCAL_TEST_ACCOUNTS.find((u) => u.username === username && u.password === password);
  if (!localUser) return null;

  const { JWT_SECRET, storeSessionNonce } = deps;
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
