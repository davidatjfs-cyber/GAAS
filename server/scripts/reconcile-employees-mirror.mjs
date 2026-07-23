#!/usr/bin/env node
/**
 * 员工表 vs hrms_state.employees 镜像对账。
 * Usage: node scripts/reconcile-employees-mirror.mjs [tenantId]
 * Exit 1 when drift detected.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { reconcileEmployeesMirror } from '../domains/employees/mirror-tx.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const tenantId = process.argv[2] || process.env.TENANT_ID || 'default';
const pool = new Pool({ connectionString: DATABASE_URL });

try {
  const report = await reconcileEmployeesMirror(pool, tenantId);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
} finally {
  await pool.end();
}
