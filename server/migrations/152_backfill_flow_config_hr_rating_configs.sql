-- A2: 将 hrms_state 中的流程/角色模块配置回填到 hr_rating_configs（表权威）
-- config_key:
--   role_module_config      ← roleModules
--   approval_flows          ← approvalFlows
--   payment_flow_by_store   ← paymentFlowByStore
-- 冲突时：表已有非空 config 则保留表；否则用 state 覆盖。

INSERT INTO hr_rating_configs (config_key, config, enabled, tenant_id, updated_at)
SELECT
  'role_module_config',
  COALESCE(data->'roleModules', '{}'::jsonb),
  true,
  key,
  NOW()
FROM hrms_state
WHERE jsonb_typeof(COALESCE(data->'roleModules', 'null'::jsonb)) = 'object'
  AND COALESCE(data->'roleModules', '{}'::jsonb) <> '{}'::jsonb
ON CONFLICT (config_key, tenant_id) DO UPDATE SET
  config = CASE
    WHEN hr_rating_configs.config IS NULL
      OR hr_rating_configs.config = 'null'::jsonb
      OR hr_rating_configs.config = '{}'::jsonb
    THEN EXCLUDED.config
    ELSE hr_rating_configs.config
  END,
  enabled = true,
  updated_at = NOW();

INSERT INTO hr_rating_configs (config_key, config, enabled, tenant_id, updated_at)
SELECT
  'approval_flows',
  COALESCE(data->'approvalFlows', '{}'::jsonb),
  true,
  key,
  NOW()
FROM hrms_state
WHERE jsonb_typeof(COALESCE(data->'approvalFlows', 'null'::jsonb)) = 'object'
  AND COALESCE(data->'approvalFlows', '{}'::jsonb) <> '{}'::jsonb
ON CONFLICT (config_key, tenant_id) DO UPDATE SET
  config = CASE
    WHEN hr_rating_configs.config IS NULL
      OR hr_rating_configs.config = 'null'::jsonb
      OR hr_rating_configs.config = '{}'::jsonb
    THEN EXCLUDED.config
    ELSE hr_rating_configs.config
  END,
  enabled = true,
  updated_at = NOW();

INSERT INTO hr_rating_configs (config_key, config, enabled, tenant_id, updated_at)
SELECT
  'payment_flow_by_store',
  COALESCE(data->'paymentFlowByStore', '{}'::jsonb),
  true,
  key,
  NOW()
FROM hrms_state
WHERE jsonb_typeof(COALESCE(data->'paymentFlowByStore', 'null'::jsonb)) = 'object'
  AND COALESCE(data->'paymentFlowByStore', '{}'::jsonb) <> '{}'::jsonb
ON CONFLICT (config_key, tenant_id) DO UPDATE SET
  config = CASE
    WHEN hr_rating_configs.config IS NULL
      OR hr_rating_configs.config = 'null'::jsonb
      OR hr_rating_configs.config = '{}'::jsonb
    THEN EXCLUDED.config
    ELSE hr_rating_configs.config
  END,
  enabled = true,
  updated_at = NOW();
