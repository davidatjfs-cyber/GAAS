/**
 * handleAgentMessage 门店解析（HQ 文本提及 + data_auditor canonical）。
 */
import { STORE_CANONICAL_MAP } from '../../brands-config.js';
import {
  brandPrefixFromText,
  resolveStoreFromCanonicalMap,
  resolveStoreFromKnownList,
} from './helpers.js';

/**
 * HQ/admin：从 feishu_users 已知门店列表解析文本中的门店。
 * @param {import('pg').Pool} pool
 * @param {string} text
 * @param {string} currentStore
 */
export async function resolveHqStoreFromText(pool, text, currentStore) {
  let store = String(currentStore || '').trim();
  if (store && store !== '总部') return store;
  try {
    const storeR = await pool.query(
      `SELECT DISTINCT store FROM feishu_users WHERE store IS NOT NULL AND store != '' AND store != '总部'`
    );
    const knownStores = (storeR.rows || []).map((r) => r.store).filter(Boolean);
    return resolveStoreFromKnownList(text, knownStores, store) || store;
  } catch {
    return store;
  }
}

/**
 * data_auditor 顶层门店解析：canonical map + POS 品牌兜底。
 * @param {import('pg').Pool} pool
 * @param {{
 *   text: string,
 *   boundStore: string,
 *   inferBrandFromStoreName: (store: string) => string|null|undefined,
 * }} opts
 */
export async function resolveDataAuditorStore(pool, opts) {
  const { resolvedStore: afterMap, textMentionedStore, overridden } = resolveStoreFromCanonicalMap({
    text: opts.text,
    boundStore: opts.boundStore,
    storeCanonicalMap: STORE_CANONICAL_MAP,
    inferBrandFromStoreName: opts.inferBrandFromStoreName,
  });
  let resolvedStore = afterMap;
  if (overridden && textMentionedStore) {
    const mentionedBrand = opts.inferBrandFromStoreName(textMentionedStore);
    if (mentionedBrand && mentionedBrand !== opts.inferBrandFromStoreName(opts.boundStore)) {
      console.log(
        `[data_auditor] store override from text: ${opts.boundStore} → ${resolvedStore} (brand: ${mentionedBrand})`
      );
    } else {
      console.log(`[data_auditor] store resolved from text: ${opts.boundStore} → ${resolvedStore}`);
    }
  }

  if (!resolvedStore || resolvedStore === '总部') {
    try {
      const prefix = brandPrefixFromText(opts.text);
      if (prefix) {
        const r = await pool.query(
          `SELECT store FROM pos_sales_detail WHERE store LIKE $1 GROUP BY store ORDER BY COUNT(*) DESC LIMIT 1`,
          [`%${prefix}%`]
        );
        resolvedStore = r.rows?.[0]?.store || resolvedStore;
      }
    } catch {
      /* ignore */
    }
    if (resolvedStore && resolvedStore !== '总部') {
      console.log(`[data_auditor] HQ store fallback: ${opts.boundStore} → ${resolvedStore}`);
    }
  }
  return resolvedStore;
}

/**
 * 数字/汉字短回复：继承 5 分钟内最近非 general 路由。
 * @param {import('pg').Pool} pool
 * @param {string} senderUsername
 * @param {string} currentRoute
 * @returns {Promise<string>}
 */
export async function maybeInheritRecentRoute(pool, senderUsername, currentRoute) {
  if (currentRoute !== 'general') return currentRoute;
  try {
    const lastRouteResult = await pool.query(
      `SELECT routed_to FROM agent_messages WHERE sender_username = $1 AND direction = 'in' AND content_type IN ('text','image') AND routed_to IS NOT NULL AND routed_to != 'general' AND created_at > NOW() - INTERVAL '5 minutes' ORDER BY created_at DESC LIMIT 1`,
      [senderUsername]
    );
    if (lastRouteResult.rows?.length) {
      const route = lastRouteResult.rows[0].routed_to;
      console.log(`[route] Inherited recent route: ${route}`);
      return route;
    }
  } catch (e) {
    console.error('[route] inherit route error:', e?.message);
  }
  return currentRoute;
}
