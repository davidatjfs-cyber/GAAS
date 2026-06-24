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
