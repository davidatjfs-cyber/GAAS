-- RLS Phase5全量推进第一批：recipe-management.js(配方4表，按store解析真实租户)、
-- file-manager.js(files+file_access_logs，调用方均在authRequired路由内，用
-- resolveTenantIdDefault()读取请求的ALS上下文)、feishu-sync.js(厨房/例会/原料
-- 收货3张飞书同步表，按store解析真实租户)。
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recipes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE recipe_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_components FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recipe_components
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE recipe_component_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_component_ingredients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recipe_component_ingredients
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE recipe_component_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_component_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recipe_component_steps
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON files
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE file_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_access_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON file_access_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE kitchen_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kitchen_reports
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE store_meeting_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_meeting_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_meeting_reports
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE material_receiving_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_receiving_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON material_receiving_reports
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
