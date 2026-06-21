-- RLS Phase5全量推进第4批：training_tasks(index.js批量下发路径，auto-ops-engine.js那条
-- 早已正确)/dish_name_aliases/attention_scores/employee_attachments均在authRequired路由内，
-- 用resolveTenantIdDefault()。feishu_sync_logs是飞书webhook(签名/加密自证身份，无ALS上下文)
-- 写入的同步审计日志，固定tenant_id='default'，整段用tenantContext.run()包裹(包括setImmediate
-- 延迟的异步处理，已验证AsyncLocalStorage能正确跨setImmediate传播)。
-- licenses/tenants两张表是platformAdminRequired管理的平台级跨租户元数据表(创建租户本身就是
-- 跨租户操作)，故意不开RLS。
ALTER TABLE training_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON training_tasks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE dish_name_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish_name_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dish_name_aliases
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE attention_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE attention_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attention_scores
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE employee_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employee_attachments
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE feishu_sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE feishu_sync_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feishu_sync_logs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
