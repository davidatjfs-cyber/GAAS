#!/usr/bin/env node
/**
 * 批量迁移：把 hrms_state 里长期没登录、还留着明文密码的用户，
 * 用 bcrypt 哈希后写入 users 表（安全止血 C4 第3步）。
 *
 * 幂等：已存在于 users 表的用户名会被跳过，不会覆盖。
 * 不删除 hrms_state 里的明文字段（留到第4步单独清理）。
 *
 * 用法：
 *   node scripts/migrate-plaintext-passwords-to-bcrypt.mjs --dry-run   # 只统计，不写库
 *   node scripts/migrate-plaintext-passwords-to-bcrypt.mjs             # 实际执行
 */
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('缺少 DATABASE_URL 环境变量，退出。');
  process.exit(1);
}
const DRY_RUN = process.argv.includes('--dry-run');

const pool = new Pool({ connectionString: DATABASE_URL });

// 与 index.js 的 normalizeRoleForJwt / users 表 CHECK 约束保持一致
const JWT_ROLE_MAP_ALLOWED = ['admin', 'hq_manager', 'store_manager', 'store_employee', 'cashier', 'hr_manager', 'store_production_manager', 'front_manager'];
const USERS_TABLE_ALLOWED_ROLES = ['admin', 'hq_manager', 'store_manager', 'hq_employee', 'store_employee'];
function normalizeUsersTableRole(input) {
  const v = String(input || '').trim();
  const role = JWT_ROLE_MAP_ALLOWED.includes(v) ? v : 'store_employee';
  return USERS_TABLE_ALLOWED_ROLES.includes(role) ? role : 'store_employee';
}

async function main() {
  const stateRows = await pool.query('select key as tenant_id, data from hrms_state');
  const existingUsers = await pool.query('select lower(username) as username from users');
  const existingSet = new Set(existingUsers.rows.map((r) => r.username));

  let migrated = 0;
  let skippedExisting = 0;
  let skippedNoPassword = 0;
  const perTenant = {};

  for (const row of stateRows.rows) {
    const tenantId = row.tenant_id;
    const data = row.data;
    if (!data || typeof data !== 'object') continue;
    const employees = Array.isArray(data.employees) ? data.employees : [];
    const users = Array.isArray(data.users) ? data.users : [];
    const all = employees.concat(users);

    for (const u of all) {
      const username = String(u?.username || '').trim();
      if (!username) continue;
      const password = String(u?.password || '');
      if (!password) {
        skippedNoPassword++;
        continue;
      }
      if (existingSet.has(username.toLowerCase())) {
        skippedExisting++;
        continue;
      }

      perTenant[tenantId] = (perTenant[tenantId] || 0) + 1;
      migrated++;
      existingSet.add(username.toLowerCase()); // 防止同一用户名在多个租户的state里重复出现导致本次批量内插入两次

      if (!DRY_RUN) {
        const hash = await bcrypt.hash(password, 10);
        const role = normalizeUsersTableRole(u.role);
        const realName = String(u.name || u.real_name || u.realName || username);
        await pool.query(
          `insert into users (username, password_hash, real_name, role, is_active, tenant_id)
           values ($1, $2, $3, $4, true, $5)
           on conflict (username) do nothing`,
          [username, hash, realName, role, tenantId]
        );
      }
    }
  }

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}迁移完成：`);
  console.log(`  待迁移/已迁移: ${migrated}`);
  console.log(`  已存在于users表(跳过): ${skippedExisting}`);
  console.log(`  无密码字段(跳过): ${skippedNoPassword}`);
  console.log('  按租户分布:', perTenant);

  await pool.end();
}

main().catch((e) => {
  console.error('迁移脚本出错:', e);
  process.exit(1);
});
