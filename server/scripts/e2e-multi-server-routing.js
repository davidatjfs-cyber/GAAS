#!/usr/bin/env node
// Requires a running API and a configured test secret. It intentionally does not create business data.
const base = String(process.env.E2E_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const secret = process.env.MINIPROGRAM_SYNC_SECRET || '';
if (!secret) { console.log('SKIP e2e-multi-server-routing: MINIPROGRAM_SYNC_SECRET is not configured'); process.exit(2); }
const cases = [
  ['missing signature', '/api/growth/payment-rules', { 'X-Miniprogram-Sync-Secret': secret }],
  ['invalid tenant signature', '/api/growth/payment-rules', { 'X-Miniprogram-Sync-Secret': secret, 'X-Tenant-Id': 'tenant_test_a', 'X-Store-Id': 'store_test_a', 'X-Request-Id': 'e2e-invalid', 'X-Timestamp': '0', 'X-Signature': 'invalid' }]
];
let passed = 0;
for (const [name, url, headers] of cases) {
  const res = await fetch(base + url, { headers });
  const body = await res.text();
  const ok = res.status >= 400;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} status=${res.status} body=${body.slice(0, 180)}`);
  if (ok) passed++;
}
console.log(`E2E multi-server routing PASSED: ${passed}/${cases.length}`);
process.exitCode = passed === cases.length ? 0 : 1;
