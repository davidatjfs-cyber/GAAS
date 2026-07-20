import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function integrationKeyBuffer(key) {
  const raw = Buffer.from(String(key || ''), 'base64');
  if (raw.length !== 32) throw new Error('tenant_integration_encryption_key_invalid');
  return raw;
}

export function encryptIntegrationConfig(config, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, integrationKeyBuffer(key), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptIntegrationConfig(encrypted, key) {
  const raw = Buffer.from(String(encrypted || ''), 'base64');
  if (raw.length < 29) throw new Error('tenant_integration_ciphertext_invalid');
  const decipher = createDecipheriv(ALGORITHM, integrationKeyBuffer(key), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
}

const AI_MODEL_PROVIDERS = ['qwen', 'deepseek', 'doubao'];
const AI_MODEL_MIN_ITEMS = 2;
const AI_MODEL_MAX_ITEMS = 3;

function validateAiModelEntry(entry) {
  const config = entry && typeof entry === 'object' ? entry : {};
  const provider = String(config.provider || '').trim().toLowerCase();
  const model = String(config.model || '').trim();
  if (!AI_MODEL_PROVIDERS.includes(provider) || !model) throw new Error('invalid_ai_model_config');
  const api_key = String(config.api_key || '').trim();
  return { provider, model, api_key: api_key || null };
}

/**
 * 租户AI模型配置：必须配置2-3个模型，按数组顺序作为降级优先级
 * (第1个失败/不健康 -> 试第2个 -> 试第3个 -> 仍不行才落到平台全局默认)。
 */
export function validateAiModelConfig(value) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const models = Array.isArray(config.models) ? config.models : [];
  if (models.length < AI_MODEL_MIN_ITEMS || models.length > AI_MODEL_MAX_ITEMS) {
    throw new Error('invalid_ai_model_config_count');
  }
  return { models: models.map(validateAiModelEntry) };
}

export async function getTenantAiModelConfig(db, tenantId, key) {
  return getTenantIntegrationConfig(db, tenantId, 'ai_model_config', key, validateAiModelConfig);
}

export async function saveTenantAiModelConfig(db, tenantId, config, key) {
  return saveTenantIntegrationConfig(db, tenantId, 'ai_model_config', config, key, validateAiModelConfig);
}

export function validateFeishuIntegrationConfig(value) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const app_id = String(config.app_id || '').trim();
  const app_secret = String(config.app_secret || '').trim();
  const tables = config.tables && typeof config.tables === 'object' && !Array.isArray(config.tables) ? config.tables : null;
  if (!app_id || !app_secret || !tables) throw new Error('invalid_feishu_integration');
  for (const [name, row] of Object.entries(tables)) {
    if (!name || !row || !String(row.app_token || '').trim() || !String(row.table_id || '').trim()) {
      throw new Error('invalid_feishu_integration');
    }
  }
  return { app_id, app_secret, tables };
}

export async function getTenantIntegrationConfig(db, tenantId, integrationKey, key, validate) {
  const r = await db.query(
    `SELECT encrypted_config FROM tenant_integrations
      WHERE tenant_id = $1 AND integration_key = $2 AND status = 'active'`,
    [tenantId, integrationKey]
  );
  if (!r.rows?.[0]?.encrypted_config) return null;
  const decoded = decryptIntegrationConfig(r.rows[0].encrypted_config, key);
  return typeof validate === 'function' ? validate(decoded) : decoded;
}

export async function getTenantFeishuIntegration(db, tenantId, key) {
  return getTenantIntegrationConfig(db, tenantId, 'feishu_bitable', key, validateFeishuIntegrationConfig);
}

// feishu_bot: 租户自己飞书自建应用的 app_id/app_secret，用于消息机器人(sendLarkMessage/sendLarkCard)，
// 与 feishu_bitable（多维表格同步用）是两个独立的应用/权限范围，分开存储。见 server/feishu-messaging.js。
export function validateFeishuBotConfig(value) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const app_id = String(config.app_id || '').trim();
  const app_secret = String(config.app_secret || '').trim();
  if (!app_id || !app_secret) throw new Error('invalid_feishu_bot_config');
  // encrypt_key/verification_token 是可选的：只有租户需要接收入站事件（机器人回复、审批卡片
  // 点击回调）时才需要配置，仅用来主动发消息(sendLarkMessage/sendLarkCard)可以不填。
  // 对应飞书开发者后台"事件订阅"里的 Encrypt Key / Verification Token。
  return {
    app_id,
    app_secret,
    encrypt_key: String(config.encrypt_key || '').trim(),
    verification_token: String(config.verification_token || '').trim(),
  };
}

export async function getTenantFeishuBotIntegration(db, tenantId, key) {
  return getTenantIntegrationConfig(db, tenantId, 'feishu_bot', key, validateFeishuBotConfig);
}

export async function saveTenantFeishuBotIntegration(db, tenantId, config, key) {
  return saveTenantIntegrationConfig(db, tenantId, 'feishu_bot', config, key, validateFeishuBotConfig);
}

export function feishuBotIntegrationPublicSummary(config) {
  return {
    configured: !!config,
    app_id: config?.app_id ? `${config.app_id.slice(0, 6)}…` : '',
  };
}

export async function saveTenantIntegrationConfig(db, tenantId, integrationKey, config, key, validate) {
  const normalized = typeof validate === 'function' ? validate(config) : config;
  const encrypted = encryptIntegrationConfig(normalized, key);
  await db.query(
    `INSERT INTO tenant_integrations (tenant_id, integration_key, encrypted_config, status, updated_at)
     VALUES ($1, $2, $3, 'active', NOW())
     ON CONFLICT (tenant_id, integration_key)
     DO UPDATE SET encrypted_config = EXCLUDED.encrypted_config, status = 'active', updated_at = NOW()`,
    [tenantId, integrationKey, encrypted]
  );
  return { configured: true, integration_key: integrationKey };
}

export async function saveTenantFeishuIntegration(db, tenantId, config, key) {
  return saveTenantIntegrationConfig(db, tenantId, 'feishu_bitable', config, key, validateFeishuIntegrationConfig);
}

export function tenantIntegrationPublicSummary(config) {
  return {
    configured: !!config,
    app_id: config?.app_id ? `${config.app_id.slice(0, 6)}…` : '',
    tables: Object.keys(config?.tables || {}),
  };
}

export async function getTenantIntegrationSummary(db, tenantId, integrationKey, key, validate = validateFeishuIntegrationConfig) {
  const config = await getTenantIntegrationConfig(db, tenantId, integrationKey, key, validate);
  return {
    tenant_id: tenantId,
    integration_key: integrationKey,
    ...tenantIntegrationPublicSummary(config)
  };
}

export async function listTenantIntegrationSummaries(db, tenantIds, integrationKey, key, validate = validateFeishuIntegrationConfig) {
  const items = [];
  for (const tenantId of tenantIds || []) {
    items.push(await getTenantIntegrationSummary(db, tenantId, integrationKey, key, validate));
  }
  return items;
}

export async function findTenantForFeishuAppId(db, tenantIds, appId, key) {
  const target = String(appId || '').trim();
  if (!target) return null;
  for (const tenantId of tenantIds || []) {
    const config = await getTenantFeishuIntegration(db, tenantId, key);
    if (String(config?.app_id || '').trim() === target) return tenantId;
  }
  return null;
}
