-- 098_dish_name_aliases_seed.sql
-- dish_name_aliases 初始种子数据。
--
-- 表的作用：把 POS 中出现的变体菜品名显式映射到 canonical_name，
-- 供 bi-weekly-report 里的成本覆盖率计算正确匹配 dish_library_costs。
--
-- 注意：bi-weekly-report.js 的 DISH_NAME_NORMALIZE_SQL 已处理：
--   • 繁体→简体（魚→鱼、鹅→鹅等）
--   • 阿拉伯数字→汉字（9→九）
--   • 中/英文括号内容删除（【...】、（...）、(...)）
--   • 常见标点/符号删除（+、/、·、-等）
-- 以上场景无需在此表中再写 alias，SQL 归一化已自动处理。
-- 本表只处理归一化 SQL 无法覆盖的情况：
--   A. 错别字（字符本身不同，translate 不包含的）
--   B. 实质多一个字的变体（如 五指毛桃乌鸡汤 vs 五指毛桃炖乌鸡汤）
--   C. 新租户引入的 POS 菜品名与菜品库名称不一致（运营人员通过管理界面添加）

INSERT INTO dish_name_aliases (tenant_id, store, biz_type, alias_name, canonical_name, enabled, created_by)
VALUES
  -- 错字：冰淇凌（凌）→ 冰淇淋（淋），两字不同，DISH_NAME_NORMALIZE_SQL 无法处理
  ('default', '*', '*', '冰淇凌麻薯西多士', '冰淇淋麻薯西多士', TRUE, 'system'),

  -- 变体：五指毛桃乌鸡汤（无"炖"字）→ 规范名 五指毛桃炖乌鸡汤（有"炖"字）
  ('default', '*', '*', '五指毛桃乌鸡汤', '五指毛桃炖乌鸡汤', TRUE, 'system')

ON CONFLICT (store, biz_type, alias_name, tenant_id) DO NOTHING;
