/**
 * JWT auth middleware (Bearer + query token fallback).
 * Instantiated after account-gate + store-access-context; index keeps thin
 * late-bind wrappers so early register*(app, authRequired) still works.
 */

export function createAuthMiddlewareHelpers({
  jwt,
  jwtSecret,
  pool,
  tenantContext,
  assertEmployeeLoginAllowedByState,
  getSharedState,
  pickMyStoreFromState,
  getUserStoreAccessContext,
}) {
  async function authRequired(req, res, next) {
    // 企业微信「接收消息」回调为无 token 公开端点（靠签名+AES 解密自证），放行
    if (String(req.originalUrl || '').split('?')[0] === '/api/wecom/callback') return next();
    if (String(req.originalUrl || '').split('?')[0] === '/api/wecom/kf/callback') return next();
    const hdr = String(req.headers.authorization || '');
    let token = hdr.startsWith('Bearer ') ? String(hdr.slice(7) || '').trim() : '';
    // 部分移动端 WebView 在 multipart/form-data 上传时可能丢失 Authorization；允许 query 兜底（与 FormData 同发）
    if (!token) {
      try {
        token = String(req.query?.access_token || req.query?.token || '').trim();
      } catch (e) {
        token = '';
      }
    }
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    if (!jwtSecret) return res.status(500).json({ error: 'server_config_error' });
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.user = payload;
      // 旧token(改造前签发)没有tenant_id字段，兜底归入default租户，保持现有行为不变。
      req.tenantId = String(payload.tenant_id || 'default').trim() || 'default';

      // 用 AsyncLocalStorage 把租户上下文挂到本次请求的整条异步调用链上，
      // 让 getSharedState()/saveSharedState() 等未显式传tenantId的历史调用点也能拿到正确租户。
      return await tenantContext.run(req.tenantId, async () => {
        // Single-device login: validate session nonce
        const nonce = String(payload.sn || '').trim();
        const uname = String(payload.username || '').trim();
        if (nonce && uname) {
          try {
            const r = await pool.query(
              'select session_nonce from user_sessions where lower(username) = lower($1) and tenant_id = $2 limit 1',
              [uname, req.tenantId]
            );
            const stored = String(r.rows?.[0]?.session_nonce || '').trim();
            if (stored && stored !== nonce) {
              return res.status(401).json({
                error: 'session_replaced',
                message: '您的账号已在其他设备登录，当前会话已失效',
              });
            }
          } catch (e) {
            // DB error: allow through to avoid blocking all requests
          }
        }

        try {
          await assertEmployeeLoginAllowedByState(uname);
        } catch (e) {
          if (e && e.statusCode === 403) {
            return res.status(403).json({ error: 'account_disabled', message: '账号已停用或已离职' });
          }
        }

        try {
          let effectiveRole = String(payload.role || '').trim();
          try {
            const dbRoleRow = await pool.query(
              'SELECT role FROM users WHERE lower(username) = lower($1) AND tenant_id = $2 LIMIT 1',
              [uname, req.tenantId]
            );
            const dbRole = String(dbRoleRow.rows?.[0]?.role || '').trim();
            if (dbRole) effectiveRole = dbRole;
          } catch (_e) {
            /* ignore */
          }

          const state0 = (await getSharedState().catch(() => null)) || {};
          const stateStore = String(pickMyStoreFromState(state0, uname) || payload.store || '').trim();
          const ctx = await getUserStoreAccessContext(uname, effectiveRole, {
            requestedStore: payload.current_store || stateStore,
            stateStore,
          });
          req.user = {
            ...payload,
            role: effectiveRole,
            store: stateStore,
            primary_store: ctx.primaryStore,
            current_store: ctx.currentStore,
            allowed_stores: ctx.allowedStores,
          };
        } catch (_e) {
          req.user = payload;
        }

        next();
      });
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  async function authRequiredOrQueryToken(req, res, next) {
    const hdr = String(req.headers.authorization || '');
    let token = hdr.startsWith('Bearer ') ? String(hdr.slice(7) || '').trim() : '';
    if (!token) {
      try {
        token = String(req.query?.token || req.query?.access_token || '').trim();
      } catch (e) {
        token = '';
      }
    }
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    if (!jwtSecret) return res.status(500).json({ error: 'server_config_error' });
    try {
      const payload = jwt.verify(token, jwtSecret);
      req.user = payload;
      req.tenantId = String(payload.tenant_id || 'default').trim() || 'default';
      return await tenantContext.run(req.tenantId, async () => {
        const nonce = String(payload.sn || '').trim();
        const uname = String(payload.username || '').trim();
        if (nonce && uname) {
          try {
            const r = await pool.query(
              'select session_nonce from user_sessions where lower(username) = lower($1) and tenant_id = $2 limit 1',
              [uname, req.tenantId]
            );
            const stored = String(r.rows?.[0]?.session_nonce || '').trim();
            if (stored && stored !== nonce) {
              return res.status(401).json({
                error: 'session_replaced',
                message: '您的账号已在其他设备登录，当前会话已失效',
              });
            }
          } catch (e) {
            // DB error: allow through
          }
        }
        try {
          await assertEmployeeLoginAllowedByState(uname);
        } catch (e) {
          if (e && e.statusCode === 403) {
            return res.status(403).json({ error: 'account_disabled', message: '账号已停用或已离职' });
          }
        }
        try {
          let effectiveRole = String(payload.role || '').trim();
          try {
            const dbRoleRow = await pool.query(
              'SELECT role FROM users WHERE lower(username) = lower($1) AND tenant_id = $2 LIMIT 1',
              [uname, req.tenantId]
            );
            const dbRole = String(dbRoleRow.rows?.[0]?.role || '').trim();
            if (dbRole) effectiveRole = dbRole;
          } catch (_e) {
            /* ignore */
          }

          const state0 = (await getSharedState().catch(() => null)) || {};
          const stateStore = String(pickMyStoreFromState(state0, uname) || payload.store || '').trim();
          const ctx = await getUserStoreAccessContext(uname, effectiveRole, {
            requestedStore: payload.current_store || stateStore,
            stateStore,
          });
          req.user = {
            ...payload,
            role: effectiveRole,
            store: stateStore,
            primary_store: ctx.primaryStore,
            current_store: ctx.currentStore,
            allowed_stores: ctx.allowedStores,
          };
        } catch (_e) {
          req.user = payload;
        }
        return next();
      });
    } catch (e) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  return { authRequired, authRequiredOrQueryToken };
}
