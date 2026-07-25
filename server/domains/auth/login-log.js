/**
 * user_login_log write helpers (no DDL — table via ensureLoginLogTable / migrations).
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'auth', handler: 'login-log' });

export function createLoginLogHelpers({ pool, tenantContext }) {
  async function recordLogin(username, sessionNonce, req, tenantId = 'default') {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return;
    const ip = String(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || req.ip || '')
      .split(',')[0]
      .trim()
      .slice(0, 45);
    const ua = String(req.headers?.['user-agent'] || '').slice(0, 500);
    const tid = String(tenantId || 'default').trim() || 'default';
    // 登录这一刻还没有 JWT/ALS 上下文(还没发 token)，靠调用方传入刚查到的用户租户身份，
    // 自己用 tenantContext.run() 包裹，不依赖外部上下文。
    await tenantContext.run(tid, async () => {
      let client;
      try {
        client = await pool.connect();
        await client.query('SET default_transaction_read_only = OFF');
        await client.query(
          `update user_login_log set logout_at = now() where lower(username) = $1 and logout_at is null`,
          [key]
        );
        await client.query(
          `insert into user_login_log (username, login_at, session_nonce, ip_address, user_agent, tenant_id) values ($1, now(), $2, $3, $4, $5)`,
          [key, sessionNonce, ip, ua, tid]
        );
      } catch (e) {
        log.error({ msg: 'record_login_failed', err: e?.message || String(e) });
      } finally {
        try {
          if (client) client.release();
        } catch (_e) {
          /* ignore */
        }
      }
    });
  }

  async function recordLogout(username) {
    const key = String(username || '').trim().toLowerCase();
    if (!key) return;
    let client;
    try {
      client = await pool.connect();
      await client.query('SET default_transaction_read_only = OFF');
      await client.query(
        `update user_login_log set logout_at = now() where username = $1 and logout_at is null`,
        [key]
      );
    } catch (e) {
      log.error({ msg: 'record_logout_failed', err: e?.message || String(e) });
    } finally {
      try {
        if (client) client.release();
      } catch (_e) {
        /* ignore */
      }
    }
  }

  return { recordLogin, recordLogout };
}
