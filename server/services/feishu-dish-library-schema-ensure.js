/**
 * 菜品库成本表(dish_library_costs)遗留 listen-time ensure*：从 server/feishu-sync.js 外提
 * （只搬家，不新增 schema；B5 冻结要求新表走 migrations，domains/ 一律禁止 ensure*+CREATE TABLE，
 * 存量 ensure* 只能落在 services/ 并进 ensure-ddl-freeze.test.mjs 的白名单）。
 */
import { pool } from '../utils/database.js';

export async function ensureDishLibraryTable() {
  await pool().query(`
    CREATE TABLE IF NOT EXISTS dish_library_costs (
      id BIGSERIAL PRIMARY KEY,
      store VARCHAR(200) NOT NULL,
      brand VARCHAR(50) NOT NULL DEFAULT '*',
      biz_type VARCHAR(20) NOT NULL,
      dish_name VARCHAR(255) NOT NULL,
      dish_price NUMERIC(12,2),
      unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      source_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      source_record_id VARCHAR(120),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_dish_library_costs_brand_biz_dish UNIQUE (brand, biz_type, dish_name)
    )
  `);
  // 迁移既有表：加 brand 列，并把唯一键从 (store,biz_type,dish_name) 改为 (brand,biz_type,dish_name)。
  // 品牌是成本归属的唯一可靠维度，避免两品牌同名菜成本互相覆盖/污染。
  await pool().query(`ALTER TABLE dish_library_costs ADD COLUMN IF NOT EXISTS brand VARCHAR(50) NOT NULL DEFAULT '*'`);
  await pool().query(`
    UPDATE dish_library_costs
       SET brand = COALESCE(
             NULLIF(source_data->>'品牌',''),
             CASE WHEN source_data->>'所属门店' LIKE '洪潮%' THEN '洪潮'
                  WHEN source_data->>'所属门店' LIKE '马己仙%' THEN '马己仙' END,
             '*')
     WHERE brand IS NULL OR brand = '*'`);
  await pool().query(`ALTER TABLE dish_library_costs DROP CONSTRAINT IF EXISTS uq_dish_library_costs_store_biz_dish`);
  await pool().query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_dish_library_costs_brand_biz_dish') THEN
        ALTER TABLE dish_library_costs ADD CONSTRAINT uq_dish_library_costs_brand_biz_dish UNIQUE (brand, biz_type, dish_name);
      END IF;
    END $$`);
  await pool().query(`CREATE INDEX IF NOT EXISTS idx_dish_library_costs_brand_lookup ON dish_library_costs (brand, biz_type, dish_name) WHERE enabled = TRUE`);
}
