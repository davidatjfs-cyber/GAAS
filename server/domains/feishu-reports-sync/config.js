/**
 * 飞书表格同步：应用配置、租户飞书集成加载、webhook 租户路由。
 * 从 server/feishu-sync.js 拆出（behavior-preserving extract）。
 */
import { pool, runWithSystemTenantContext } from '../../utils/database.js';
import { getTenantFeishuIntegration, saveTenantFeishuIntegration } from '../../tenant-integrations.js';
import { allowLegacyFeishuFallback } from '../../safety.js';
import { SHARED_TABLES } from '@gaas/shared';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'feishu-sync' });

export const LEGACY_FEISHU_TABLE_DEFAULTS = {
  closing_reports: { app_token: 'PTWrbUdcbarCshst0QncMoY7nKe', table_id: 'tblXYfSBRrgNGohN', view_id: 'vewYvZudua', name: '收档报告DB', type: 'kitchen_report', report_type: 'closing' },
  opening_reports: { app_token: 'PTWrbUdcbarCshst0QncMoY7nKe', table_id: 'tbl32E6d0CyvLvfi', view_id: 'vewUZZmWnZ', name: '开档报告', type: 'kitchen_report', report_type: 'opening' },
  meeting_reports: { app_token: 'PTWrbUdcbarCshst0QncMoY7nKe', table_id: 'tblZXgaU0LpSye2m', view_id: 'vewq7G0SpU', name: '例会报告', type: 'store_meeting' },
  dish_library: { app_token: 'PTWrbUdcbarCshst0QncMoY7nKe', table_id: 'tbltSvY7SBTr3Sw8', view_id: 'vewva7M4SZ', name: '菜品库', type: 'dish_library' },
  dish_library_majixian_takeaway: { app_token: 'PTWrbUdcbarCshst0QncMoY7nKe', table_id: 'tbltaVzb2nei9NwO', view_id: '', name: '马己仙外卖菜品库', type: 'dish_library', force_biz_type: 'takeaway' },
  sop_steps: { app_token: 'PTWrbUdcbarCshst0QncMoY7nKe', table_id: 'tblQTKrYjHT5VldI', view_id: 'vewLKxLzbY', name: '厨房SOP步骤库', type: 'sop_steps' },
  material_majixian: { app_token: 'PTWrbUdcbarCshst0QncMoY7nKe', table_id: 'tblz4kW1cY22XRlL', view_id: 'vewyyTyKf6', name: '马己仙原料收货日报', brand: 'majixian' },
  material_hongchao: { app_token: 'PTWrbUdcbarCshst0QncMoY7nKe', table_id: 'tbllcV1evqTJyzlN', view_id: 'vewyyTyKf6', name: '洪潮原料收货日报', brand: 'hongchao' }
};

// 兼容旧调用方（如 index.js 的 webhook/table 映射逻辑）：
// 新逻辑的真实凭证与表 ID 以 tenant_integrations 为准，这里只保留历史静态映射用于“通过 app_token+table_id 反查 configKey”。
export const FEISHU_TABLE_CONFIG = LEGACY_FEISHU_TABLE_DEFAULTS;

function feishuIntegrationEncryptionKey() {
  return String(process.env.TENANT_INTEGRATION_ENCRYPTION_KEY || '').trim();
}

function buildLegacyDefaultFeishuIntegration() {
  const app_id = String(process.env.FEISHU_APP_ID || process.env.LARK_APP_ID || '').trim();
  const app_secret = String(process.env.FEISHU_APP_SECRET || process.env.LARK_APP_SECRET || '').trim();
  if (!app_id || !app_secret) return null;
  return {
    app_id,
    app_secret,
    tables: Object.fromEntries(Object.entries(LEGACY_FEISHU_TABLE_DEFAULTS).map(([key, value]) => [key, {
      app_token: String(value.app_token || '').trim(),
      table_id: String(value.table_id || '').trim(),
      view_id: String(value.view_id || '').trim()
    }]))
  };
}

export function withTableMeta(tableKey, row) {
  const meta = LEGACY_FEISHU_TABLE_DEFAULTS[tableKey] || {};
  return {
    ...meta,
    ...(row || {}),
    app_token: String(row?.app_token || meta.app_token || '').trim(),
    table_id: String(row?.table_id || meta.table_id || '').trim(),
    view_id: String(row?.view_id || meta.view_id || '').trim(),
  };
}

export async function loadTenantFeishuConfig(tenantId) {
  const key = feishuIntegrationEncryptionKey();
  if (!key) return null;
  const configured = await getTenantFeishuIntegration(pool(), tenantId, key);
  if (configured) return configured;
  if (!allowLegacyFeishuFallback()) {
    log.warn({ msg: 'integration_missing_legacy_fallback_disabled', tenant_id: tenantId });
    return null;
  }
  if (tenantId !== 'default') return null;
  const legacy = buildLegacyDefaultFeishuIntegration();
  if (!legacy) return null;
  await saveTenantFeishuIntegration(pool(), tenantId, legacy, key);
  return legacy;
}

// ── Webhook 租户路由：通过 app_token 反查 tenant_id ──
let _appTokenTenantCache = new Map(); // appToken -> tenantId
let _appTokenTenantCacheAt = 0;

/**
 * 根据飞书 app_token 找出对应租户 ID，供 webhook 路由使用。
 * 缓存 5 分钟，避免每次 webhook 都全量解密 tenant_integrations。
 * 查不到则返回 'default'（兜底向后兼容）。
 */
export async function resolveWebhookTenantId(appToken) {
  if (!appToken) return 'default';
  const now = Date.now();
  if (now - _appTokenTenantCacheAt > 5 * 60 * 1000) {
    try {
      const rows = await runWithSystemTenantContext(() =>
        pool().query(
          `SELECT DISTINCT tenant_id FROM ${SHARED_TABLES.TENANT_INTEGRATIONS}
           WHERE integration_key = $1 AND status = 'active'`,
          ['feishu_bitable']
        )
      );
      const newMap = new Map();
      for (const { tenant_id } of rows.rows) {
        const cfg = await loadTenantFeishuConfig(tenant_id).catch(() => null);
        if (!cfg?.tables) continue;
        for (const row of Object.values(cfg.tables)) {
          const t = String(row.app_token || '').trim();
          if (t) newMap.set(t, tenant_id);
        }
      }
      _appTokenTenantCache = newMap;
      _appTokenTenantCacheAt = now;
    } catch (e) {
      log.error({ msg: 'resolve_webhook_tenant_cache_failed', err: e?.message });
    }
  }
  return _appTokenTenantCache.get(String(appToken).trim()) || 'default';
}
