import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decryptIntegrationConfig,
  encryptIntegrationConfig,
  findTenantForFeishuAppId,
  getTenantIntegrationSummary,
  listTenantIntegrationSummaries,
  saveTenantFeishuIntegration,
  validateFeishuIntegrationConfig,
} from './tenant-integrations.js';

const key = Buffer.alloc(32, 7).toString('base64');

test('integration secrets are encrypted and round-trip only with the deployment key', () => {
  const config = { app_id: 'cli_example', app_secret: 'secret-value', tables: { sop_steps: { app_token: 'app', table_id: 'tbl' } } };
  const encrypted = encryptIntegrationConfig(config, key);
  assert.doesNotMatch(encrypted, /secret-value/);
  assert.deepEqual(decryptIntegrationConfig(encrypted, key), config);
  assert.throws(() => decryptIntegrationConfig(encrypted, Buffer.alloc(32, 8).toString('base64')));
});

test('feishu integration requires app credentials and named table definitions', () => {
  assert.throws(() => validateFeishuIntegrationConfig({ app_id: 'x' }), /invalid_feishu_integration/);
  assert.deepEqual(
    validateFeishuIntegrationConfig({ app_id: 'x', app_secret: 'y', tables: { sop_steps: { app_token: 'a', table_id: 'b' } } }),
    { app_id: 'x', app_secret: 'y', tables: { sop_steps: { app_token: 'a', table_id: 'b' } } }
  );
});

test('platform helpers only expose masked integration summaries', async () => {
  const rows = new Map();
  const db = {
    async query(sql, params) {
      if (/INSERT INTO tenant_integrations/.test(sql)) {
        rows.set(`${params[0]}:${params[1]}`, { encrypted_config: params[2] });
        return { rows: [] };
      }
      if (/SELECT encrypted_config FROM tenant_integrations/.test(sql)) {
        return { rows: rows.get(`${params[0]}:${params[1]}`) ? [rows.get(`${params[0]}:${params[1]}`)] : [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await saveTenantFeishuIntegration(db, 'tenant_a', {
    app_id: 'cli_example_123456',
    app_secret: 'super-secret',
    tables: { sop_steps: { app_token: 'app_a', table_id: 'tbl_a' } }
  }, key);

  const one = await getTenantIntegrationSummary(db, 'tenant_a', 'feishu_bitable', key);
  assert.deepEqual(one, {
    tenant_id: 'tenant_a',
    integration_key: 'feishu_bitable',
    configured: true,
    app_id: 'cli_ex…',
    tables: ['sop_steps'],
  });

  const listed = await listTenantIntegrationSummaries(db, ['tenant_a', 'tenant_b'], 'feishu_bitable', key);
  assert.deepEqual(listed, [
    one,
    {
      tenant_id: 'tenant_b',
      integration_key: 'feishu_bitable',
      configured: false,
      app_id: '',
      tables: [],
    }
  ]);
});

test('platform can resolve which tenant owns a feishu app id without leaking secrets', async () => {
  const rows = new Map();
  const db = {
    async query(sql, params) {
      if (/INSERT INTO tenant_integrations/.test(sql)) {
        rows.set(`${params[0]}:${params[1]}`, { encrypted_config: params[2] });
        return { rows: [] };
      }
      if (/SELECT encrypted_config FROM tenant_integrations/.test(sql)) {
        return { rows: rows.get(`${params[0]}:${params[1]}`) ? [rows.get(`${params[0]}:${params[1]}`)] : [] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };

  await saveTenantFeishuIntegration(db, 'tenant_a', {
    app_id: 'cli_app_a',
    app_secret: 'secret-a',
    tables: { sop_steps: { app_token: 'app_a', table_id: 'tbl_a' } }
  }, key);
  await saveTenantFeishuIntegration(db, 'tenant_b', {
    app_id: 'cli_app_b',
    app_secret: 'secret-b',
    tables: { sop_steps: { app_token: 'app_b', table_id: 'tbl_b' } }
  }, key);

  assert.equal(await findTenantForFeishuAppId(db, ['tenant_a', 'tenant_b'], 'cli_app_b', key), 'tenant_b');
  assert.equal(await findTenantForFeishuAppId(db, ['tenant_a', 'tenant_b'], 'missing', key), null);
});
