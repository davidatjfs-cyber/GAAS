-- 给 brand_configs.config_json 补两个评分相关子键，收编：
-- 1) new-scoring-model.js 的 LABOR_EFFICIENCY_THRESHOLDS（人效扣分阈值，按品牌不同）
-- 2) lib/pm-execution-for-scoring.js 的 KITCHEN_STATIONS_MAJIXIAN/HONGCHAO（档口清单，按品牌不同）
-- 值与现有硬编码原值完全一致，代码侧改造后仍保留这两个常量作为DB查不到时的兜底。

UPDATE brand_configs
SET config_json = config_json || '{
  "laborEfficiencyThresholds": { "high": { "below": 1000, "points": 20 }, "medium": { "below": 1100, "points": 10 } },
  "kitchenStations": ["煲仔", "水吧", "炒锅", "卤水", "砧板", "刺身"]
}'::jsonb
WHERE brand_key = 'hongchao';

UPDATE brand_configs
SET config_json = config_json || '{
  "laborEfficiencyThresholds": { "high": { "below": 1400, "points": 20 }, "medium": { "below": 1500, "points": 10 } },
  "kitchenStations": ["煲仔", "水吧", "炒锅", "烧味", "砧板"]
}'::jsonb
WHERE brand_key = 'majixian';
