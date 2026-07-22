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

// 登录等大部分路由都会先查 tenants 表判断 loginAllowed，测试库是空schema，
// 没有这一条'default'租户的话，所有请求会在到达业务逻辑前就被403拦下。
export async function ensureDefaultTenant() {
  const db = testDb();
  await db.query(
    `insert into tenants (tenant_id, name, status) values ('default', '测试租户', 'active')
     on conflict (tenant_id) do update set status = 'active'`
  );
}

// 多个测试文件并行跑，都要给 hrms_state.employees 追加一条测试数据。
// 用单条原子UPDATE（jsonb_set + ||）而不是"JS里读出来改数组再整份写回"，
// 避免并行测试互相覆盖对方刚写入的数据（应用层read-modify-write在并发下不安全，
// 单条SQL语句由Postgres行锁保证原子性）。
export async function appendStateEmployee(tenantId, employee) {
  const db = testDb();
  await db.query(
    `insert into hrms_state (key, data)
     values ($1, jsonb_build_object('employees', jsonb_build_array($2::jsonb)))
     on conflict (key) do update
     set data = jsonb_set(
       coalesce(hrms_state.data, '{}'::jsonb),
       '{employees}',
       coalesce(hrms_state.data->'employees', '[]'::jsonb) || jsonb_build_array($2::jsonb)
     )`,
    [tenantId, JSON.stringify(employee)]
  );
}

export async function truncateTables(tableNames) {
  const db = testDb();
  for (const name of tableNames) {
    await db.query(`DELETE FROM ${name} WHERE username LIKE 'test\\_%' OR tenant_id LIKE 'test\\_%'`).catch(() => {
      // 表没有 username/tenant_id 列时会失败，忽略——调用方应该只传相关表
    });
  }
}
