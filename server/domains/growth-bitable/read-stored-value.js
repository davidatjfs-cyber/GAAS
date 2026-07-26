/**
 * Read 储值客户 bitable records (P4 peel from growth-api.js).
 */

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   fetchFn?: typeof fetch,
 * }} [opts]
 */
export function createStoredValueBitableReader(opts = {}) {
  const env = opts.env || process.env;
  const fetchFn = opts.fetchFn || globalThis.fetch;

  async function getBitableTenantToken() {
    const id = env.BITABLE_TASK_RESP_APP_ID;
    const secret = env.BITABLE_TASK_RESP_APP_SECRET;
    if (!id || !secret) throw new Error('bitable_app_not_configured');
    const r = await fetchFn('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: id, app_secret: secret }),
    });
    const d = await r.json();
    if (!d.tenant_access_token) {
      throw new Error(`bitable_token_failed:${d.code || ''} ${d.msg || ''}`);
    }
    return d.tenant_access_token;
  }

  return async function readStoredValueBitableRecords() {
    const appToken = env.STORED_VALUE_BITABLE_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe';
    const tableId = env.STORED_VALUE_BITABLE_TABLE_ID || 'tblvAcEjXHmEYQGZ';
    const token = await getBitableTenantToken();
    let all = [];
    let pageToken = '';
    for (let i = 0; i < 500; i += 1) {
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500`
        + (pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '');
      const d = await (await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } })).json();
      if (d.code !== 0) throw new Error(`bitable_read_failed:${d.code} ${d.msg}`);
      all = all.concat((d.data && d.data.items) || []);
      if (d.data && d.data.has_more && d.data.page_token) pageToken = d.data.page_token;
      else break;
    }
    return all;
  };
}
