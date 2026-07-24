/**
 * HRMS → agents-service-v2 base URL + admin JWT (short TTL cache).
 * Avoids concurrent summary+tasks each hitting /api/login.
 */

export function createAgentsServiceAuthHelpers({ axios, nowFn = Date.now }) {
  function getAgentsServiceBaseUrl() {
    return String(process.env.AGENTS_SERVICE_BASE_URL || 'http://127.0.0.1:3101').trim().replace(/\/$/, '');
  }

  /** 避免同一页面并发 summary+tasks 各打一次 agents /api/login 触发竞态或短时过载 */
  let __agentsAdminJwCache = { token: '', expiresAt: 0 };

  async function getAgentsServiceAdminToken() {
    const now = nowFn();
    if (__agentsAdminJwCache.token && __agentsAdminJwCache.expiresAt > now) {
      return __agentsAdminJwCache.token;
    }
    const url = getAgentsServiceBaseUrl() + '/api/login';
    const username = String(process.env.AGENTS_ADMIN_USERNAME || 'admin').trim() || 'admin';
    const password = String(process.env.AGENTS_ADMIN_PASSWORD || '').trim();
    if (!password) {
      throw new Error('AGENTS_ADMIN_PASSWORD environment variable is required for hrms-server to authenticate with agents-service-v2');
    }
    const r = await axios.post(url, { username, password }, {
      timeout: 8000,
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' }
    });
    if (r.status < 200 || r.status >= 300 || !r.data?.token) {
      const detail = typeof r.data === 'object' ? JSON.stringify(r.data) : String(r.data || '');
      throw new Error(`agents_service_login_failed:${r.status}:${detail}`);
    }
    const token = String(r.data.token);
    __agentsAdminJwCache = { token, expiresAt: now + 45000 };
    return token;
  }

  return { getAgentsServiceBaseUrl, getAgentsServiceAdminToken };
}
