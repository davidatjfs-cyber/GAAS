-- RLS Phase5全量推进第2批：data-executor.js(agent_metric_cache/diagnosis_feedback，按store
-- 解析真实租户)、growth-api.js(store_marketing_profiles/creative_assets，按getGrowthTenantId
-- 解析；这两个路由+growth-phases.js的wechat_work_customers相关路由都补了tenantContext.run()
-- 自包裹——发现growth-api.js/growth-phases.js此前完全没用过tenantContext.run()，全靠显式
-- 参数传递做应用层过滤，这意味着此文件里所有用getGrowthTenantId/resolveTenantIdForStore的
-- 写入点，在它们各自目标表开RLS之前都不会出问题，但开了之后必须补这层包裹，否则会议重演
-- scheduler_heartbeat那次"列值与会话变量不一致"的静默/报错问题。本批次顺带修了
-- wechat_work_customers相关的5处调用点(2处写+1处cron同步+2处读)。
ALTER TABLE agent_metric_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_metric_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_metric_cache
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE diagnosis_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagnosis_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON diagnosis_feedback
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE store_marketing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_marketing_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_marketing_profiles
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE creative_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON creative_assets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE wechat_work_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE wechat_work_customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wechat_work_customers
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
