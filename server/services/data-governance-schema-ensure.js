/**
 * dish_name_aliases（数据治理别名表）遗留 listen-time ensure*：从 server/index.js 外提
 * （只搬家，不新增 schema；B5 冻结要求新表走 migrations，domains/ 一律禁止 ensure*+CREATE TABLE，
 * 存量 ensure* 只能落在 services/ 并进 ensure-ddl-freeze.test.mjs 的白名单）。
 */
export async function ensureDataGovernanceTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dish_name_aliases (
      id BIGSERIAL PRIMARY KEY,
      store VARCHAR(200) NOT NULL DEFAULT '*',
      biz_type VARCHAR(20) NOT NULL DEFAULT '*',
      alias_name VARCHAR(255) NOT NULL,
      canonical_name VARCHAR(255) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_by VARCHAR(120),
      updated_by VARCHAR(120),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_dish_name_aliases_scope UNIQUE (store, biz_type, alias_name)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_dish_name_aliases_lookup ON dish_name_aliases (store, biz_type, alias_name) WHERE enabled = TRUE`);
  // sales_raw已于2026-07-03下线，pos_sales_detail视图已直接提供dish_code(sku别名)/category列，
  // category_code该视图固定为NULL，不需要再对sales_raw做列补齐。
}
