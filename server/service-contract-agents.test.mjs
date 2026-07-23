import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gaasRoot = path.resolve(__dirname, '..');
const agentsRoot = path.resolve(__dirname, '../../agents-service-v2');
const hasAgentsCheckout = fs.existsSync(path.join(agentsRoot, 'src/index.js'));

test('HRMS growth-api / agents proxy must send internal auth header when calling agents', () => {
  const growth = fs.readFileSync(path.join(__dirname, 'growth-api.js'), 'utf8');
  // Either X-Internal-Secret or Authorization Bearer for service calls
  const hasInternal =
    /x-internal-secret|X-Internal-Secret|AGENTS_INTERNAL_SECRET|MINIPROGRAM_SYNC_SECRET/i.test(growth);
  assert.ok(hasInternal, 'growth-api should reference internal secret for agents calls');
});

test('agents /health gates detailed payload via allowDetailedHealth', { skip: !hasAgentsCheckout }, () => {
  const index = fs.readFileSync(path.join(agentsRoot, 'src/index.js'), 'utf8');
  assert.match(index, /allowDetailedHealth/);
  assert.match(index, /app\.get\(['"]\/health['"]/);
  const auth = fs.readFileSync(path.join(agentsRoot, 'src/middleware/internal-auth.js'), 'utf8');
  assert.match(auth, /export function allowDetailedHealth/);
  assert.match(auth, /HEALTH_TOKEN/);
});

test('ontology-client contract: diagnosis URL + Bearer service token', { skip: !hasAgentsCheckout }, () => {
  const src = fs.readFileSync(
    path.join(agentsRoot, 'src/services/ontology-client.js'),
    'utf8'
  );
  assert.match(src, /\/api\/ai\/operation-diagnosis/);
  assert.match(src, /Authorization/);
  assert.match(src, /Bearer/);
  assert.match(src, /HRMS_BASE_URL|HRMS_INTERNAL_URL/);
});

test('public API surface documents health and tenant branding', () => {
  const docPath = path.join(gaasRoot, 'docs/public-api-surface.md');
  assert.ok(fs.existsSync(docPath), `missing ${docPath}`);
  const doc = fs.readFileSync(docPath, 'utf8');
  assert.match(doc, /\/api\/tenant\/branding|branding/i);
  assert.match(doc, /\/health|health/i);
});
