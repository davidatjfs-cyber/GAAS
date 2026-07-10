-- agent_v2_configs 唯一约束从 config_key 单列改为 (config_key, tenant_id) 复合列
-- 现状：所有行 tenant_id='default'，改动前后对现有数据行为完全一致（单租户不受影响）
-- 目的：为未来HRMS DEMO多租户场景下，不同租户各自拥有一份同名config_key配置留出空间
ALTER TABLE agent_v2_configs DROP CONSTRAINT IF EXISTS agent_v2_configs_config_key_key;
ALTER TABLE agent_v2_configs ADD CONSTRAINT agent_v2_configs_config_key_tenant_key UNIQUE (config_key, tenant_id);
