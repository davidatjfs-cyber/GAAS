/**
 * 集成测试用的数据库直连（用于测试断言"数据库最终状态"，以及测试间清理数据）。
 *
 * 约定：不在每个测试前重置整个schema（155张表全量truncate太慢，会拖垮CI速度）。
 * 改为约定每个测试用 uniqueId() 生成的随机后缀构造租户/用户名，天然互不冲突；
 * 需要清理时用 truncateTables() 只清测试自己用到的表。
 */
import pg from 'pg';

const { Pool } = pg;

let pool = null;

export function testDb() {
  if (!pool) {
    const url = process.env.TEST_DATABASE_URL || 'postgres://' + (process.env.USER || 'postgres') + '@localhost:5432/gaas_test';
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

export async function closeTestDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function uniqueId(prefix = 'test') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function truncateTables(tableNames) {
  const db = testDb();
  for (const name of tableNames) {
    await db.query(`DELETE FROM ${name} WHERE username LIKE 'test\\_%' OR tenant_id LIKE 'test\\_%'`).catch(() => {
      // 表没有 username/tenant_id 列时会失败，忽略——调用方应该只传相关表
    });
  }
}
