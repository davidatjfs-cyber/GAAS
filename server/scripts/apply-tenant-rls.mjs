#!/usr/bin/env node
/**
 * demo 专用 RLS 收尾步骤：对全部租户表显式开启 RLS（ENABLE + FORCE + tenant_isolation 策略）。
 *
 * 设计（2026-08-01 拍板，029/030 所有权收敛）：
 * - 不进编号迁移链：迁移链只做结构（见 177_tenant_platform_schema.sql），
 *   ENABLE/FORCE 由本脚本在 demo/托管环境显式执行，单租户生产保持 relrowsecurity=false。
 * - 硬闸门：TENANT_MODE 必须为 multi，否则拒绝执行（杜绝"忘设环境变量导致漏开"）。
 * - 单事务执行 + 跑完自校验：范围内所有表 relrowsecurity=true，任何缺口非零退出。
 * - 排除清单来自 @gaas/shared（单一真源），禁止在本脚本里另维护。
 *
 * 用法（demo 服务器 /opt/hrms/server 下）：
 *   TENANT_MODE=multi DATABASE_URL=... node scripts/apply-tenant-rls.mjs
 */
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  TENANT_RLS_POLICY_NAME,
  TENANT_RLS_GUC_TENANT_ID,
  TENANT_RLS_SYSTEM_TENANT_VALUE,
  isTenantRlsExcluded,
} from '@gaas/shared';

const { Pool } = pg;

/** 仅 TENANT_MODE=multi|saas|hosted 视为多租户托管环境（与 server/safety.js getTenantMode 对齐）。 */
export function isMultiTenantModeEnv(env = process.env) {
  const v = String(env.TENANT_MODE || '').trim().toLowerCase();
  return v === 'multi' || v === 'saas' || v === 'hosted';
}

/** 纯函数：从 information_schema 行里选出应纳入租户隔离的表（public + 有 tenant_id + 不在排除清单）。 */
export function selectTenantRlsTables(rows) {
  return rows
    .filter((r) => r.table_schema === 'public' && r.has_tenant_id === true && !isTenantRlsExcluded(r.table_name))
    .map((r) => r.table_name)
    .sort();
}

export const TENANT_SCOPE_QUERY = `
  SELECT t.table_schema AS table_schema,
         t.table_name   AS table_name,
         bool_or(c.column_name = 'tenant_id') AS has_tenant_id
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema
     AND c.table_name = t.table_name
   WHERE t.table_schema = 'public'
     AND t.table_type = 'BASE TABLE'
   GROUP BY t.table_schema, t.table_name
   ORDER BY t.table_name`;

/** 针对单张表的 ENABLE/FORCE/策略重建语句（恒量，无注入面）。 */
export function buildTenantRlsStatements(tableName) {
  const esc = (n) => pg.escapeIdentifier(n);
  const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const guc = literal(TENANT_RLS_GUC_TENANT_ID);
  const sys = literal(TENANT_RLS_SYSTEM_TENANT_VALUE);
  const cond =
    `tenant_id = current_setting(${guc}, true) OR ` +
    `current_setting(${guc}, true) = ${sys}`;
  return [
    `ALTER TABLE ${esc(tableName)} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${esc(tableName)} FORCE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS ${esc(TENANT_RLS_POLICY_NAME)} ON ${esc(tableName)}`,
    `CREATE POLICY ${esc(TENANT_RLS_POLICY_NAME)} ON ${esc(tableName)} FOR ALL ` +
      `USING (${cond}) WITH CHECK (${cond})`,
  ];
}

async function main() {
  if (!isMultiTenantModeEnv()) {
    console.error(
      `[apply-tenant-rls] REFUSED: TENANT_MODE 必须为 multi（demo/托管），当前=${JSON.stringify(process.env.TENANT_MODE || '(未设置)')}`
    );
    process.exitCode = 2;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('[apply-tenant-rls] REFUSED: DATABASE_URL 未设置');
    process.exitCode = 2;
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  let tables = [];
  try {
    await client.query('BEGIN');
    const scopeRes = await client.query(TENANT_SCOPE_QUERY);
    tables = selectTenantRlsTables(scopeRes.rows);
    console.log(`[apply-tenant-rls] 纳入租户隔离的表：${tables.length} 张`);
    for (const t of tables) {
      for (const stmt of buildTenantRlsStatements(t)) {
        await client.query(stmt);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[apply-tenant-rls] 失败，已回滚: ${e?.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
  }
  if (process.exitCode) {
    await pool.end();
    return;
  }

  // 自校验：范围内所有表必须 relrowsecurity=true
  const verify = await pool.query(
    `SELECT relname, relrowsecurity FROM pg_class WHERE relkind = 'r' AND relname = ANY($1)`,
    [tables],
  );
  const byName = new Map(verify.rows.map((r) => [r.relname, r]));
  const notEnabled = tables.filter((t) => !byName.get(t)?.relrowsecurity);
  if (notEnabled.length) {
    console.error(`[apply-tenant-rls] 自校验失败，以下表 RLS 未生效: ${notEnabled.join(', ')}`);
    process.exitCode = 1;
    await pool.end();
    return;
  }

  // 清单外但已开启的表：只警告不失败（如 ai_learning_*/ai_quality_* 由 GAAS 136/137 迁移开启）
  const enabledRows = await pool.query(
    `SELECT relname FROM pg_class WHERE relkind = 'r' AND relrowsecurity = true AND NOT (relname = ANY($1))`,
    [tables],
  );
  const outside = enabledRows.rows
    .map((r) => r.relname)
    .filter((n) => !isTenantRlsExcluded(n))
    .sort();
  const excludedEnabled = enabledRows.rows
    .map((r) => r.relname)
    .filter((n) => isTenantRlsExcluded(n))
    .sort();
  if (outside.length) {
    console.warn(`[apply-tenant-rls] 清单外已开启 RLS 的表（未改动，供人工确认）: ${outside.join(', ')}`);
  }
  if (excludedEnabled.length) {
    console.warn(`[apply-tenant-rls] 注意：排除清单内表仍为 relrowsecurity=true: ${excludedEnabled.join(', ')}`);
  }
  console.log(`[apply-tenant-rls] OK：${tables.length} 张租户表 RLS 已生效，自校验通过`);
  await pool.end();
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((e) => {
    console.error(`[apply-tenant-rls] 未预期错误: ${e?.message}`);
    process.exitCode = 1;
  });
}
