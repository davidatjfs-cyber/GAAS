-- Tier 2: strip inventoryForecast* blob keys（表 165 回填后执行）
-- 仅写脚本，不在 CI/生产自动执行。

UPDATE hrms_state
   SET data = data
     - 'inventoryForecastHistory'
     - 'inventoryForecastPredictions'
     - 'inventoryForecastEvaluations',
       updated_at = NOW()
 WHERE data ?| ARRAY['inventoryForecastHistory', 'inventoryForecastPredictions', 'inventoryForecastEvaluations'];
