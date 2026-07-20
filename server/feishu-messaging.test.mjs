import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolveLarkAppCredentials, resetLarkTenantTokenCache } from './feishu-messaging.js';
import { encryptIntegrationConfig } from './tenant-integrations.js';

const KEY = randomBytes(32).toString('base64');
const GLOBAL_APP_ID = 'cli_global';
const GLOBAL_APP_SECRET = 'global_secret';

function poolWithConfig(config) {
  const encrypted = encryptIntegrationConfig(config, KEY);
  return {
    query: async (_sql, params) => {
      const [, integrationKey] = params;
      if (integrationKey !== 'feishu_bot') return { rows: [] };
      return { rows: [{ encrypted_config: encrypted }] };
    },
  };
}

const emptyPool = { query: async () => ({ rows: [] }) };

test('tenant with its own feishu_bot config uses its own app credentials, not the global one', async () => {
  const pool = poolWithConfig({ app_id: 'cli_tenant_yannianyoux', app_secret: 'tenant_secret' });
  const creds = await resolveLarkAppCredentials('tenant_yannianyoux', pool, KEY, GLOBAL_APP_ID, GLOBAL_APP_SECRET);
  assert.equal(creds.app_id, 'cli_tenant_yannianyoux');
  assert.equal(creds.app_secret, 'tenant_secret');
});

test('tenant without a feishu_bot config falls back to the global app (old tenants keep working)', async () => {
  const creds = await resolveLarkAppCredentials('some_other_tenant', emptyPool, KEY, GLOBAL_APP_ID, GLOBAL_APP_SECRET);
  assert.equal(creds.app_id, GLOBAL_APP_ID);
  assert.equal(creds.app_secret, GLOBAL_APP_SECRET);
});

test('"default" tenant id always uses the global app without even querying the db', async () => {
  let queried = false;
  const pool = { query: async () => { queried = true; return { rows: [] }; } };
  const creds = await resolveLarkAppCredentials('default', pool, KEY, GLOBAL_APP_ID, GLOBAL_APP_SECRET);
  assert.equal(creds.app_id, GLOBAL_APP_ID);
  assert.equal(queried, false);
});

test('missing pool/encryptionKey (e.g. TENANT_INTEGRATION_ENCRYPTION_KEY not set) degrades to global app instead of throwing', async () => {
  const creds = await resolveLarkAppCredentials('tenant_yannianyoux', null, null, GLOBAL_APP_ID, GLOBAL_APP_SECRET);
  assert.equal(creds.app_id, GLOBAL_APP_ID);
});

test('resetLarkTenantTokenCache does not throw for an unknown tenant', () => {
  assert.doesNotThrow(() => resetLarkTenantTokenCache('never_cached_tenant'));
  assert.doesNotThrow(() => resetLarkTenantTokenCache());
});
