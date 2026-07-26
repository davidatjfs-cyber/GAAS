/**
 * Growth WeCom facade factory (P4 peel from growth-api.js).
 */
import { SHARED_TABLES } from '@gaas/shared';
import { createWecomTokenCaches } from './token-cache.js';
import {
  getWecomConfig as loadWecomConfig,
  getStoreWecomConfig,
  getAllStoreWecomConfigs,
} from './config.js';
import { createStoreTenantResolver } from './resolve-tenant.js';
import { createGetWecomAccessToken } from './access-token.js';
import { createSendWecomExternalMessage } from './send-message.js';

async function getStateValue(pool, key) {
  const r = await pool.query(
    `SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = $1 LIMIT 1`,
    [key]
  );
  return r.rows?.[0]?.data || null;
}

/**
 * @param {{ cleanText: (v: unknown, max?: number) => string, fetchFn?: typeof fetch }} deps
 */
export function createGrowthWecom(deps) {
  const { cleanText, fetchFn = globalThis.fetch } = deps;
  const caches = createWecomTokenCaches();

  async function getWecomConfig(pool) {
    return loadWecomConfig(pool, getStateValue);
  }

  const getWecomAccessToken = createGetWecomAccessToken({
    cleanText,
    getWecomConfig,
    getStoreWecomConfig,
    caches,
    fetchFn,
  });

  const sendWecomExternalMessage = createSendWecomExternalMessage({
    cleanText,
    getWecomConfig,
    getStoreWecomConfig,
    getWecomAccessToken,
    fetchFn,
  });

  const resolveTenantIdForStore = createStoreTenantResolver({
    employeesTable: SHARED_TABLES.EMPLOYEES,
  });

  return {
    getWecomConfig,
    getStoreWecomConfig,
    getAllStoreWecomConfigs,
    getWecomAccessToken,
    sendWecomExternalMessage,
    resolveTenantIdForStore,
    resetGrowthWecomTokenCache: () => caches.resetGrowthCache(),
    clearStoreWecomTokenCache: (storeId) => caches.clearStoreCache(storeId),
  };
}
