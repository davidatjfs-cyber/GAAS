-- 给 brand_configs.config_json 补两个index.js相关子键，收编：
-- 1) STORE_FORECAST_CONFIG（天气预测系数：雨天/雪天折扣、节假日按周末算）
-- 2) STORE_SLOT_CONFIG（营业时段配置：是否有下午茶时段、堂食最早开始时间）
-- 值与现有硬编码原值完全一致，代码侧改造后仍保留原常量作为DB查不到时的兜底。

UPDATE brand_configs
SET config_json = config_json || '{
  "forecast": { "rainFactor": 0.90, "snowFactor": 0.85, "holidayAsWeekend": true },
  "slotConfig": { "hasAfternoon": false, "dineinEarlyStart": 16 }
}'::jsonb
WHERE brand_key = 'hongchao';

UPDATE brand_configs
SET config_json = config_json || '{
  "forecast": { "rainFactor": 0.85, "snowFactor": 0.80, "holidayAsWeekend": true },
  "slotConfig": { "hasAfternoon": true, "dineinEarlyStart": 17 }
}'::jsonb
WHERE brand_key = 'majixian';
