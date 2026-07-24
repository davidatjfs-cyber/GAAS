export async function getFeishuAccessToken({ axios, isExternalEnabled, safeErrMessage, feishuEnv = {}, appId, appSecret } = {}) {
  if (!isExternalEnabled()) return '';
  const resolvedAppId = appId || feishuEnv.appId;
  const resolvedAppSecret = appSecret || feishuEnv.appSecret;
  const baseUrl = feishuEnv.baseUrl || 'https://open.feishu.cn/open-apis';

  if (!resolvedAppId || !resolvedAppSecret) {
    return '';
  }

  try {
    const response = await axios.post(`${baseUrl}/auth/v3/tenant_access_token/internal`, {
      app_id: resolvedAppId,
      app_secret: resolvedAppSecret
    });

    if (response.data?.code === 0 && response.data?.tenant_access_token) {
      return response.data.tenant_access_token;
    }
    throw new Error(`Feishu API error: ${response.data?.msg || 'Unknown error'} (code: ${response.data?.code})`);
  } catch (error) {
    console.error('[getFeishuAccessToken] Error:', safeErrMessage(error));
    if (error?.response?.data) {
      const code = error.response.data?.code;
      const msg = error.response.data?.msg;
      throw new Error(`Feishu API error: ${msg || error.message} (code: ${code ?? 'unknown'})`);
    }
    throw error;
  }
}

export async function createFeishuBitableRecord({ axios, isExternalEnabled, safeErrMessage, feishuEnv = {}, appToken, tableId, fields, accessToken }) {
  if (!isExternalEnabled()) return null;
  if (!appToken || !tableId) {
    return null;
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return null;
  }

  const baseUrl = feishuEnv.baseUrl || 'https://open.feishu.cn/open-apis';

  try {
    const url = `${baseUrl}/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
    const response = await axios.post(
      url,
      { fields },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data?.code !== 0) {
      throw new Error(`Feishu Bitable Create API error: ${response.data?.msg || 'Unknown error'} (code: ${response.data?.code})`);
    }
    return response.data?.data?.record || null;
  } catch (error) {
    console.error('[createFeishuBitableRecord] Error:', safeErrMessage(error));
    if (error?.response?.data) {
      const code = error.response.data?.code;
      const msg = error.response.data?.msg;
      throw new Error(`Feishu Bitable Create API error: ${msg || error.message} (code: ${code ?? 'unknown'})`);
    }
    throw error;
  }
}

export async function getFeishuBitableData({ axios, isExternalEnabled, safeErrMessage, feishuEnv = {} }, appToken, tableId, accessToken) {
  if (!isExternalEnabled()) return { items: [], has_more: false };
  const baseUrl = feishuEnv.baseUrl || 'https://open.feishu.cn/open-apis';
  try {
    const allItems = [];
    let pageToken = '';
    let guard = 0;

    while (guard < 2000) {
      guard++;
      const url = `${baseUrl}/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          page_size: 500,
          ...(pageToken ? { page_token: pageToken } : {})
        }
      });

      if (response.data?.code !== 0) {
        throw new Error(`Feishu Bitable API error: ${response.data?.msg || 'Unknown error'} (code: ${response.data?.code})`);
      }

      const data = response.data?.data || {};
      const items = Array.isArray(data.items) ? data.items : [];
      allItems.push(...items);

      if (!data.has_more) {
        return { ...data, items: allItems };
      }

      pageToken = String(data.page_token || '').trim();
      if (!pageToken) {
        // defensive: has_more=true but no token
        return { ...data, has_more: false, items: allItems };
      }
    }

    return { items: allItems, has_more: false };
  } catch (error) {
    console.error('[getFeishuBitableData] Error:', safeErrMessage(error));
    if (error?.response?.data) {
      const code = error.response.data?.code;
      const msg = error.response.data?.msg;
      throw new Error(`Feishu Bitable API error: ${msg || error.message} (code: ${code ?? 'unknown'})`);
    }
    throw error;
  }
}
