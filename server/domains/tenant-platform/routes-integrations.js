import { tenantContext } from '../../utils/database.js';
import {
  getTenantIntegrationSummary,
  saveTenantFeishuIntegration,
  getTenantIntegrationConfig,
  saveTenantIntegrationConfig,
  getTenantAiModelConfig,
  saveTenantAiModelConfig,
  getTenantFeishuBotIntegration,
  saveTenantFeishuBotIntegration,
  feishuBotIntegrationPublicSummary,
} from '../../tenant-integrations.js';
import { resetLarkTenantTokenCache } from '../../feishu-messaging.js';
import { requireTenantIntegrationKey } from './helpers.js';

function aiModelConfigPublicView(config) {
  return {
    configured: !!config,
    models: (config?.models || []).map((m) => ({ provider: m.provider, model: m.model, api_key_configured: !!m.api_key })),
  };
}

// 通用集成配置（飞书对话/定时任务覆盖）— 复用 tenant_integrations 表，按 integration_key 区分
const GENERIC_INTEGRATION_KEYS = new Set(['feishu_chat', 'cron_overrides']);

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformIntegrationsRoutes(app, deps) {
  const {
    pool,
    platformAdminRequired,
    TENANT_INTEGRATION_ENCRYPTION_KEY,
    invalidateTenantLlmConfigCache,
  } = deps;

  app.get('/api/admin/tenants/:tenantId/integrations/feishu_bitable', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey(TENANT_INTEGRATION_ENCRYPTION_KEY);
      const summary = await tenantContext.run(
        tenantId,
        () => getTenantIntegrationSummary(pool, tenantId, 'feishu_bitable', key)
      );
      return res.json({ ok: true, integration: summary });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/integrations/feishu_bitable', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey(TENANT_INTEGRATION_ENCRYPTION_KEY);
      const saved = await tenantContext.run(
        tenantId,
        () => saveTenantFeishuIntegration(pool, tenantId, req.body || {}, key)
      );
      const summary = await tenantContext.run(
        tenantId,
        () => getTenantIntegrationSummary(pool, tenantId, 'feishu_bitable', key)
      );
      return res.json({ ok: true, saved, integration: summary });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.get('/api/admin/tenants/:tenantId/integrations/ai_model_config', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey(TENANT_INTEGRATION_ENCRYPTION_KEY);
      const config = await tenantContext.run(tenantId, () => getTenantAiModelConfig(pool, tenantId, key));
      return res.json({ ok: true, integration: aiModelConfigPublicView(config) });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/integrations/ai_model_config', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey(TENANT_INTEGRATION_ENCRYPTION_KEY);
      // 每个模型条目的 api_key 留空表示"沿用旧配置里对应位置的密钥"，避免每次调整顺序/加一个模型都要重填所有密钥
      const existing = await tenantContext.run(tenantId, () => getTenantAiModelConfig(pool, tenantId, key)).catch(() => null);
      const body = req.body || {};
      const inputModels = Array.isArray(body.models) ? body.models : [];
      const models = inputModels.map((m, i) => ({
        provider: m?.provider,
        model: m?.model,
        api_key: String(m?.api_key || '').trim() || existing?.models?.[i]?.api_key || '',
      }));
      if (models.length < 2 || models.length > 3) {
        return res.status(400).json({ error: 'invalid_ai_model_config_count', message: '必须配置2-3个模型' });
      }
      await tenantContext.run(tenantId, () => saveTenantAiModelConfig(pool, tenantId, { models }, key));
      if (typeof invalidateTenantLlmConfigCache === 'function') invalidateTenantLlmConfigCache(tenantId);
      const config = await tenantContext.run(tenantId, () => getTenantAiModelConfig(pool, tenantId, key));
      return res.json({ ok: true, integration: aiModelConfigPublicView(config) });
    } catch (e) {
      return res.status(e?.statusCode || (String(e?.message || '').includes('invalid_ai_model_config') ? 400 : 500)).json({ error: e?.message || 'internal_error' });
    }
  });

  // 租户自己的飞书消息机器人应用(app_id/app_secret)——用于 sendLarkMessage/sendLarkCard 按租户
  // 使用各自的飞书自建应用身份发消息，而不是永远用平台全局 LARK_APP_ID。跟 feishu_bitable(多维表格
  // 同步用)是两个独立配置。未配置时 getLarkTenantToken 回退到全局应用，兼容未做迁移的老租户。
  app.get('/api/admin/tenants/:tenantId/integrations/feishu_bot', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey(TENANT_INTEGRATION_ENCRYPTION_KEY);
      const config = await tenantContext.run(tenantId, () => getTenantFeishuBotIntegration(pool, tenantId, key));
      return res.json({ ok: true, integration: feishuBotIntegrationPublicSummary(config) });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/integrations/feishu_bot', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const key = requireTenantIntegrationKey(TENANT_INTEGRATION_ENCRYPTION_KEY);
      const saved = await tenantContext.run(tenantId, () => saveTenantFeishuBotIntegration(pool, tenantId, req.body || {}, key));
      resetLarkTenantTokenCache(tenantId);
      const config = await tenantContext.run(tenantId, () => getTenantFeishuBotIntegration(pool, tenantId, key));
      return res.json({ ok: true, saved, integration: feishuBotIntegrationPublicSummary(config) });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.get('/api/admin/tenants/:tenantId/integrations/:integKey', platformAdminRequired, async (req, res) => {
    const { tenantId, integKey } = req.params;
    if (!GENERIC_INTEGRATION_KEYS.has(integKey)) return res.status(404).json({ error: 'unsupported_integration_key' });
    try {
      const key = requireTenantIntegrationKey(TENANT_INTEGRATION_ENCRYPTION_KEY);
      const config = await tenantContext.run(tenantId, () => getTenantIntegrationConfig(pool, tenantId, integKey, key));
      return res.json({ ok: true, integration: { configured: !!config, ...(config || {}) } });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'internal_error' });
    }
  });

  app.put('/api/admin/tenants/:tenantId/integrations/:integKey', platformAdminRequired, async (req, res) => {
    const { tenantId, integKey } = req.params;
    if (!GENERIC_INTEGRATION_KEYS.has(integKey)) return res.status(404).json({ error: 'unsupported_integration_key' });
    try {
      const key = requireTenantIntegrationKey(TENANT_INTEGRATION_ENCRYPTION_KEY);
      await tenantContext.run(tenantId, () => saveTenantIntegrationConfig(pool, tenantId, integKey, req.body || {}, key));
      const config = await tenantContext.run(tenantId, () => getTenantIntegrationConfig(pool, tenantId, integKey, key));
      return res.json({ ok: true, integration: { configured: !!config, ...(config || {}) } });
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'internal_error' });
    }
  });
}
