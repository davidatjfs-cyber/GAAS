/**
 * B5 闸门：listen-time DDL 冻结纪律。
 * - production/staging 默认禁止 isSchemaChangeAllowed
 * - domains/ 禁止 ensure* + CREATE TABLE（新域一律 migration）
 * - services/ 存量 ensure* 可保留；新增文件不得再带 CREATE TABLE
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isSchemaChangeAllowed } from '../safety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

/** 冻结前已存在、允许保留 CREATE 的 ensure* 文件（只减不增） */
const LEGACY_ENSURE_CREATE_ALLOWLIST = new Set([
  'services/demand-governance-service.js',
  // Wave H1：从 index.js 外提的遗留 listen-time ensure*（只搬家，不新增 schema）
  'services/feishu-bitable-schema-ensure.js',
  'services/hrms-core-schema-ensure.js',
  'services/hrms-payroll-rules.js',
  'services/hrms-permission-engine.js',
  'services/sales/sales-case-library.js',
  'services/sales/sales-internal-assistant.js',
  'services/sales/sales-knowledge-store.js',
  'services/sales/sales-permission-config.js',
  'services/sales/sales-store.js',
  'services/tenant-health-incident-service.js',
  'services/tenant-onboarding-service.js',
]);

test('production 默认禁止 schema ensure（需 ALLOW_SCHEMA_CHANGES=true）', () => {
  const prevApp = process.env.APP_ENV;
  const prevAllow = process.env.ALLOW_SCHEMA_CHANGES;
  try {
    process.env.APP_ENV = 'production';
    delete process.env.ALLOW_SCHEMA_CHANGES;
    assert.equal(isSchemaChangeAllowed(), false);
    process.env.ALLOW_SCHEMA_CHANGES = 'true';
    assert.equal(isSchemaChangeAllowed(), true);
  } finally {
    if (prevApp === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prevApp;
    if (prevAllow === undefined) delete process.env.ALLOW_SCHEMA_CHANGES;
    else process.env.ALLOW_SCHEMA_CHANGES = prevAllow;
  }
});

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkJs(p, out);
    else if (/\.js$/.test(name)) out.push(p);
  }
  return out;
}

function hasEnsureWithCreate(src) {
  return (
    /function\s+ensure\w+|async\s+function\s+ensure\w+|export\s+async\s+function\s+ensure\w+/i.test(src) &&
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS/i.test(src)
  );
}

test('domains/ 不得在 ensure* 内 CREATE TABLE', () => {
  const offenders = [];
  for (const abs of walkJs(path.join(serverRoot, 'domains'))) {
    const src = fs.readFileSync(abs, 'utf8');
    if (hasEnsureWithCreate(src)) offenders.push(path.relative(serverRoot, abs));
  }
  assert.deepEqual(offenders, [], `domains/ ensure* 请改用 migrations：\n${offenders.join('\n')}`);
});

test('services/ 不得新增带 CREATE TABLE 的 ensure*（存量白名单只减不增）', () => {
  const offenders = [];
  for (const abs of walkJs(path.join(serverRoot, 'services'))) {
    const rel = path.relative(serverRoot, abs).replace(/\\/g, '/');
    const src = fs.readFileSync(abs, 'utf8');
    if (!hasEnsureWithCreate(src)) continue;
    if (!LEGACY_ENSURE_CREATE_ALLOWLIST.has(rel)) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `新文件禁止 ensure*+CREATE TABLE，请写 server/migrations/：\n${offenders.join('\n')}`
  );
});
