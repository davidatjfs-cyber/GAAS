-- RLS Phase5全量推进第8批：agent_*集群10张表开RLS
-- 前置修复(已单独commit)：onFeishuEvent里"用户已注册→处理消息"整段补上了
-- tenantContext.run(feishuUser.tenant_id,...)包裹——之前lookupFeishuUser内部
-- 用完ALS作用域就结束了，导致这之后的agent_messages写入及handleAgentMessage
-- 内部触发的所有agent_*写入完全跑在无ALS上下文里。
--
-- agent_appeals/agent_eval_runs/agent_issues/agent_scores：代码里早已正确传tenant_id，
-- 这次只是开关。
-- agent_autonomous_tasks/agent_quality_audits/agent_visual_audits：INSERT补上
-- resolveTenantIdDefault()(之前完全没传，靠列DEFAULT 'default'，在非default租户下
-- 会被WITH CHECK拒绝)；agent_autonomous_tasks顺带把ON CONFLICT(fingerprint)
-- 改成(fingerprint, tenant_id)防跨租户碰撞。
-- agent_collaboration_archives：确认调用方(collaborationOrchestrator单例)全代码库
-- 零引用，按本文件logTaskExecution已有模式固定tenant_id='default'。
-- agent_issues_reports/agent_notifications/master_events(本批未含，留给下批)：
-- reportIssue/notifyAgent的INSERT补上resolveTenantIdDefault()，调用链已确认
-- 跑在master-agent.js的per-tenant tick(getActiveTenantIds+tenantContext.run)内。
--
-- 另外发现并修复了index.js启动时"奖惩记录回填"(state→hrms_reward_punishment_records)
-- 跑在app.listen回调里、没有HTTP请求ALS上下文，补了tenantContext.run('default',...)包裹。
ALTER TABLE agent_appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_appeals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_appeals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_autonomous_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_autonomous_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_autonomous_tasks
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_eval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_eval_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_eval_runs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_issues
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_quality_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_quality_audits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_quality_audits
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_scores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_scores
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_visual_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_visual_audits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_visual_audits
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_collaboration_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_collaboration_archives FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_collaboration_archives
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_issues_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_issues_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_issues_reports
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_notifications
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
