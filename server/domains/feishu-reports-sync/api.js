/**
 * 飞书表格同步：access token 获取 + 多维表记录拉取（分页 + 瞬态重试）。
 * 从 server/feishu-sync.js 拆出（behavior-preserving extract）。
 */
import { fetchFeishuTenantAccessToken } from '@gaas/shared/feishu-token.js';
import { childLogger } from '../../utils/logger.js';
import { isTransientFeishuBitableError, isDataNotReadyError, isFeishuInternalError, sleep } from './transient-errors.js';

const log = childLogger({ domain: 'feishu-sync' });

// 获取飞书访问令牌
export async function getFeishuAccessToken(config) {
  const { token } = await fetchFeishuTenantAccessToken({
    appId: config.app_id,
    appSecret: config.app_secret,
  });
  return token;
}

/**
 * 拉取单页多维表记录；对 1254607「Data not ready」等瞬态错误退避重试（与 bitable-poller 策略一致）。
 */
export async function fetchTableRecordsPage(tableConfig, accessToken, queryParams) {
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${tableConfig.app_token}/tables/${tableConfig.table_id}/records?${queryParams}`;
  const MAX_ATTEMPTS = 6;
  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let data;
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      data = await response.json();
    } catch (e) {
      lastErr = String(e?.message || e);
      if (isTransientFeishuBitableError(lastErr) && attempt < MAX_ATTEMPTS) {
        await sleep(Math.min(20000, 2000 * attempt));
        continue;
      }
      throw new Error(`获取表格数据失败: ${lastErr}`);
    }
    if (data.code === 0) {
      return data;
    }
    lastErr = `feishu_code_${data.code}: ${data.msg || ''}`;
    if (isTransientFeishuBitableError(lastErr) && attempt < MAX_ATTEMPTS) {
      const isDNR = isDataNotReadyError(lastErr);
      const isInt = isFeishuInternalError(lastErr);
      const delay = isDNR
        ? Math.min(120000, 30000 * Math.pow(2, attempt - 1))
        : isInt
          ? Math.min(60000, 10000 * Math.pow(2, attempt - 1))
          : Math.min(20000, 2000 * attempt);
      log.warn({ msg: 'fetch_table_records_retry', err: lastErr, attempt, max_attempts: MAX_ATTEMPTS, sleep_ms: delay });
      await sleep(delay);
      continue;
    }
    throw new Error(`获取表格数据失败: ${data.msg || lastErr}`);
  }
  throw new Error(lastErr || '获取表格数据失败');
}

// 获取表格记录（分页 + 每页瞬态重试）
export async function fetchTableRecords(tableConfig, accessToken) {
  let allRecords = [];
  let pageToken = null;

  do {
    const queryParams = new URLSearchParams({ page_size: '100' });
    if (String(tableConfig.view_id || '').trim()) {
      queryParams.append('view_id', String(tableConfig.view_id || '').trim());
    }
    if (pageToken) {
      queryParams.append('page_token', pageToken);
    }

    const data = await fetchTableRecordsPage(tableConfig, accessToken, queryParams);
    allRecords = allRecords.concat(data.data?.items || []);
    pageToken = data.data?.page_token;
  } while (pageToken);

  return allRecords;
}
