#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(new URL('..', import.meta.url).pathname);
const migrationDir = path.join(root, 'migrations');
const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'));
const sql = files.map(f => fs.readFileSync(path.join(migrationDir, f), 'utf8')).join('\n');
const checks = [
  ['server_tenant_bindings table', /CREATE TABLE IF NOT EXISTS server_tenant_bindings/i],
  ['binding unique server+tenant', /UNIQUE\s*\(server_code,\s*tenant_id\)/i],
  ['route version', /route_version/i],
  ['outbox target server', /target_server_code/i],
  ['outbox route version', /hrms_event_outbox[\s\S]*route_version/i]
];
let failed = 0;
for (const [name, re] of checks) { const ok = re.test(sql); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
console.log(`tenant isolation static checks: ${checks.length - failed}/${checks.length}`);
process.exitCode = failed ? 1 : 0;
