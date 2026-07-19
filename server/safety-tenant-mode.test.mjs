import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTenantMode,
  isLicenseEnforced,
  isLicenseExemptTenant,
  allowLegacyFeishuFallback,
  isAiQualityExternalEnabled,
} from './safety.js';

const OLD = { ...process.env };

function clear() {
  delete process.env.TENANT_MODE;
  delete process.env.LICENSE_ENFORCE;
  delete process.env.LICENSE_ENFORCE_EXEMPT_TENANTS;
  delete process.env.ALLOW_LEGACY_FEISHU_FALLBACK;
  delete process.env.ENABLE_AI_QUALITY_EXTERNAL;
}

test.afterEach(() => {
  clear();
  Object.assign(process.env, OLD);
});

test('getTenantMode defaults to single', () => {
  clear();
  assert.equal(getTenantMode(), 'single');
});

test('getTenantMode multi aliases', () => {
  clear();
  process.env.TENANT_MODE = 'multi';
  assert.equal(getTenantMode(), 'multi');
});

test('isLicenseEnforced off in single by default', () => {
  clear();
  assert.equal(isLicenseEnforced(), false);
});

test('isLicenseEnforced on in multi by default', () => {
  clear();
  process.env.TENANT_MODE = 'multi';
  assert.equal(isLicenseEnforced(), true);
});

test('LICENSE_ENFORCE=false overrides multi', () => {
  clear();
  process.env.TENANT_MODE = 'multi';
  process.env.LICENSE_ENFORCE = 'false';
  assert.equal(isLicenseEnforced(), false);
});

test('default tenant is license-exempt by default', () => {
  clear();
  assert.equal(isLicenseExemptTenant('default'), true);
  assert.equal(isLicenseExemptTenant('acme'), false);
});

test('allowLegacyFeishuFallback true in single, false in multi', () => {
  clear();
  assert.equal(allowLegacyFeishuFallback(), true);
  process.env.TENANT_MODE = 'multi';
  assert.equal(allowLegacyFeishuFallback(), false);
});

test('platform AI quality external access requires its independent switch', () => {
  clear();
  assert.equal(isAiQualityExternalEnabled(), false);
  process.env.ENABLE_AI_QUALITY_EXTERNAL = 'true';
  assert.equal(isAiQualityExternalEnabled(), true);
  process.env.ENABLE_AI_QUALITY_EXTERNAL = 'false';
  assert.equal(isAiQualityExternalEnabled(), false);
});
