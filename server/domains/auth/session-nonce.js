/**
 * Persist single-device session nonce to user_sessions.
 * Failure must block JWT issue (caller checks boolean return).
 */

export function createSessionNonceHelpers({ pool, resolveTenantIdDefault }) {
  /** @returns {Promise<boolean>} 是否已成功持久化 */
  async function storeSessionNonce(uname, nonce, tenantId) {
    const key = String(uname || '').trim().toLowerCase();
    const effectiveTenantId = resolveTenantIdDefault(tenantId);
    if (!key) return false;
    let client;
    try {
      client = await pool.connect();
      // configureDbSessionSafety 在 ENABLE_DB_WRITE!=true 时会把连接设为只读；
      // 会话 nonce 必须写入，否则新 token 与库中旧 sn 不一致 → 立刻 401。
      await client.query('SET default_transaction_read_only = OFF');
      await client.query(
        `insert into user_sessions (username, session_nonce, tenant_id, updated_at)
         values ($1, $2, $3, now())
         on conflict (username, tenant_id) do update set session_nonce = $2, updated_at = now()`,
        [key, nonce, effectiveTenantId]
      );
      return true;
    } catch (e) {
      console.error('storeSessionNonce failed:', e?.message || e);
      return false;
    } finally {
      try {
        if (client) client.release();
      } catch (_e) {
        /* ignore */
      }
    }
  }

  return { storeSessionNonce };
}
