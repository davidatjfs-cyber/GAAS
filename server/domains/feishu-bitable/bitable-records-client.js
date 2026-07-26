/**
 * Bitable records HTTP client (P2 peel from agents.js):
 * tenant token cache, list records with retries, image download URL.
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'feishu-bitable', handler: 'bitable-records-client' });

export function isDataNotReadyError(errText) {
  return /1254607|data not ready|try again later/i.test(String(errText || ''));
}

export function isFeishuInternalError(errText) {
  return /1255001|1255002|1255003|1255004|1255005|1255040|feishu_code_2200|internal[\s_]?error|rpc[\s_]?error|marshal[\s_]?error/i.test(
    String(errText || '')
  );
}

export function isTransientBitableError(errText) {
  const s = String(errText || '');
  return /1254607|1255001|1255002|1255003|1255004|1255005|1255040|1254200|feishu_code_2200|internal[\s_]?error|rpc[\s_]?error|marshal[\s_]?error|data not ready|try again later|timeout|ECONNABORTED|ECONNRESET|ETIMEDOUT|socket hang up|EAI_AGAIN|429|502|503|504/i.test(
    s
  );
}

/**
 * @param {object} deps
 * @param {object} deps.bitableConfigs
 * @param {typeof import('axios').default} deps.axios
 * @param {(ms: number) => Promise<void>} deps.sleep
 * @returns {{
 *   getBitableTenantToken: (configKey?: string) => Promise<string>,
 *   getBitableRecords: (configKey?: string, options?: object) => Promise<object>,
 *   getBitableRecordImageDownloadUrl: (configKey?: string, fileToken?: string) => Promise<string|null>,
 * }}
 */
export function createBitableRecordsClient(deps) {
  const { bitableConfigs, axios, sleep } = deps;
  const tenantTokens = new Map();

  async function getBitableTenantToken(configKey = 'ops_checklist') {
    const config = bitableConfigs[configKey];
    if (!config) {
      log.error(`[bitable] invalid config key: ${configKey}`);
      return '';
    }

    const cached = tenantTokens.get(configKey);
    if (cached && Date.now() < cached.expires) {
      return cached.token;
    }

    try {
      const resp = await axios.post(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          app_id: config.appId,
          app_secret: config.appSecret,
        },
        { timeout: 10000 }
      );

      const token = resp.data?.tenant_access_token || '';
      const expires = Date.now() + (resp.data?.expire || 7000) * 1000;

      tenantTokens.set(configKey, { token, expires });
      log.info(`[bitable][${configKey}] tenant token refreshed, expires in`, resp.data?.expire, 's');
      return token;
    } catch (e) {
      log.error(`[bitable][${configKey}] get tenant token failed:`, e?.message);
      return '';
    }
  }

  async function getBitableRecords(configKey = 'ops_checklist', options = {}) {
    const config = bitableConfigs[configKey];
    if (!config) {
      log.error(`[bitable] invalid config key: ${configKey}`);
      return { ok: false, error: 'invalid_config' };
    }

    const MAX_RETRIES_NORMAL = 3;
    const MAX_RETRIES_DATA_NOT_READY = 1;
    let isDataNotReady = false;
    let lastErr = 'unknown';

    for (let attempt = 1; ; attempt++) {
      const maxRetries = isDataNotReady ? MAX_RETRIES_DATA_NOT_READY : MAX_RETRIES_NORMAL;
      if (attempt > maxRetries) break;

      const token = await getBitableTenantToken(configKey);
      if (!token) {
        log.error(`[bitable][${configKey}] cannot get records: no token`);
        return { ok: false, error: 'no_token' };
      }

      const { pageSize = 200, pageToken, filter, sort = [] } = options;
      const params = {
        page_size: pageSize,
        user_id_type: 'open_id',
      };

      if (pageToken) params.page_token = pageToken;
      if (filter) params.filter = filter;
      if (sort.length > 0) {
        params.sort = JSON.stringify(sort);
      } else if (config.sortField) {
        params.sort = config.sortField;
      } else {
        params.sort = JSON.stringify(['_id DESC']);
      }

      try {
        const resp = await axios.get(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`,
          {
            headers: { Authorization: `Bearer ${token}` },
            params,
            timeout: 10000,
          }
        );

        const records = resp.data?.data?.items || [];
        const hasMore = resp.data?.data?.has_more || false;
        const nextPageToken = resp.data?.data?.page_token || '';
        const total = resp.data?.data?.total || 0;

        return { ok: true, records, hasMore, nextPageToken, total };
      } catch (e) {
        const errBody = e?.response?.data;
        const bizCode = errBody?.code;
        lastErr = String(e?.message || e);

        if (bizCode || (errBody && typeof errBody === 'object')) {
          if (
            bizCode === 1254607 ||
            bizCode === '1254607' ||
            /data not ready/i.test(String(errBody?.msg || ''))
          ) {
            isDataNotReady = true;
            // 用 DATA_NOT_READY 上限判定（勿用本轮循环开头的 maxRetries，那时尚未标记）
            if (attempt >= MAX_RETRIES_DATA_NOT_READY) {
              return { ok: false, error: '1254607_data_not_ready' };
            }
            await sleep(30000);
            continue;
          }
          if (isTransientBitableError(String(bizCode) + ' ' + String(errBody?.msg || ''))) {
            if (attempt >= maxRetries) {
              return { ok: false, error: String(bizCode) };
            }
            const isInternal = isFeishuInternalError(String(bizCode));
            const delay = isInternal
              ? Math.min(60000, 10000 * Math.pow(2, attempt - 1))
              : Math.min(15000, 2000 * attempt);
            await sleep(delay);
            continue;
          }
          return { ok: false, error: String(bizCode || lastErr) };
        }

        if (isTransientBitableError(lastErr)) {
          isDataNotReady = isDataNotReady || isDataNotReadyError(lastErr);
          const maxNow = isDataNotReady ? MAX_RETRIES_DATA_NOT_READY : MAX_RETRIES_NORMAL;
          if (attempt >= maxNow) {
            return { ok: false, error: lastErr };
          }
          const delay = isDataNotReady ? 30000 : Math.min(15000, 2000 * attempt);
          await sleep(delay);
          continue;
        }

        return { ok: false, error: lastErr };
      }
    }

    return { ok: false, error: lastErr };
  }

  async function getBitableRecordImageDownloadUrl(configKey = 'ops_checklist', fileToken) {
    const token = await getBitableTenantToken(configKey);
    if (!token) {
      log.error('[bitable] cannot get image url: no token');
      return null;
    }

    try {
      const resp = await axios.get(
        `https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download_url`,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000,
        }
      );

      const downloadUrl = resp.data?.data?.download_url || '';
      if (downloadUrl) {
        log.info('[bitable] got image download url for token:', fileToken);
        return downloadUrl;
      }
      return null;
    } catch (e) {
      log.error('[bitable] get image download url failed:', e?.response?.data || e?.message);

      try {
        const mediaResp = await axios.get(
          `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`,
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 10000,
          }
        );

        if (mediaResp.data) {
          log.info('[bitable] got media download for token:', fileToken);
          return `data:image/jpeg;base64,${Buffer.from(mediaResp.data).toString('base64')}`;
        }
      } catch (e2) {
        log.error('[bitable] media download also failed:', e2?.response?.data || e2?.message);
      }

      return null;
    }
  }

  return {
    getBitableTenantToken,
    getBitableRecords,
    getBitableRecordImageDownloadUrl,
    /** @internal */
    _tenantTokens: tenantTokens,
  };
}
