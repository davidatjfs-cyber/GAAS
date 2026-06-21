// RLS Phase4自动化隔离测试套件：对任意一批"已开启RLS"的表，无需插入合成数据，
// 直接用表里已有的真实租户数据做3类断言：
//   1. 用真实存在的tenant_id设置会话变量 -> 行数应等于superuser绕过RLS看到的同口径行数
//   2. 不设置会话变量(空字符串) -> 行数必须是0(fail-closed)
//   3. 设置成RLS哨兵值('__rls_no_tenant_context__') -> 行数必须是0(fail-closed)
// 用法: node rls-isolation-test.mjs table1 table2 ...
import pg from 'pg';
const { Client } = pg;

const SENTINEL = '__rls_no_tenant_context__';
const CONN = 'postgres://hrms:Abc1234567!@127.0.0.1:5432/hrms';
const SUPER_CONN = 'postgres://postgres@127.0.0.1:5432/hrms';

async function withClient(connStr, fn) {
  const c = new Client({ connectionString: connStr });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function testTable(table) {
  const results = [];

  // RLS配置是否真的生效(relrowsecurity + relforcerowsecurity)
  const cfg = await withClient(SUPER_CONN, (c) =>
    c.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass`,
      [table]
    )
  );
  const { relrowsecurity, relforcerowsecurity } = cfg.rows[0] || {};
  if (!relrowsecurity || !relforcerowsecurity) {
    results.push({ table, test: 'rls_enabled_and_forced', pass: false, detail: cfg.rows[0] });
    return results;
  }
  results.push({ table, test: 'rls_enabled_and_forced', pass: true });

  // 挑一个真实存在、行数最多的tenant_id做对照
  const top = await withClient(SUPER_CONN, (c) =>
    c.query(
      `SELECT tenant_id, count(*) AS cnt FROM ${table} GROUP BY tenant_id ORDER BY cnt DESC LIMIT 1`
    )
  );
  if (!top.rows.length) {
    results.push({ table, test: 'has_data', pass: false, detail: 'table empty, skipping data tests' });
    return results;
  }
  const { tenant_id: realTenant, cnt: expectedCnt } = top.rows[0];

  await withClient(CONN, async (c) => {
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [realTenant]);
    const r = await c.query(`SELECT count(*) AS cnt FROM ${table}`);
    results.push({
      table,
      test: 'real_tenant_sees_own_rows',
      pass: String(r.rows[0].cnt) === String(expectedCnt),
      detail: { realTenant, expected: expectedCnt, actual: r.rows[0].cnt },
    });
  });

  await withClient(CONN, async (c) => {
    await c.query(`SELECT set_config('app.tenant_id', '', false)`);
    const r = await c.query(`SELECT count(*) AS cnt FROM ${table}`);
    results.push({
      table,
      test: 'empty_context_fails_closed',
      pass: String(r.rows[0].cnt) === '0',
      detail: r.rows[0],
    });
  });

  await withClient(CONN, async (c) => {
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [SENTINEL]);
    const r = await c.query(`SELECT count(*) AS cnt FROM ${table}`);
    results.push({
      table,
      test: 'sentinel_fails_closed',
      pass: String(r.rows[0].cnt) === '0',
      detail: r.rows[0],
    });
  });

  return results;
}

const tables = process.argv.slice(2);
if (!tables.length) {
  console.error('Usage: node rls-isolation-test.mjs <table1> [table2 ...]');
  process.exit(1);
}

let allPass = true;
for (const table of tables) {
  const results = await testTable(table);
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass) allPass = false;
    console.log(`[${status}] ${r.table}.${r.test}`, r.detail ? JSON.stringify(r.detail) : '');
  }
}
process.exit(allPass ? 0 : 1);
