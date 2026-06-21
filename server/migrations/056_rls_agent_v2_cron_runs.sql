-- RLS Phase5: agent_v2_cron_runs开启RLS。此前推迟是因为agents-service-v2的index.js
-- /health端点对此表+user_login_log各有一处跨租户聚合查询(给运维看全系统健康状况，不是
-- 单租户视图)，需要先改成"遍历active租户分别查再app层汇总"才能在RLS下正确工作，
-- 否则会因为没有单一租户上下文而静默返回0/空，造成"看起来很健康"的假象。
-- 对应代码修复见agents-service-v2仓库同批commit(index.js的/health路由)。
ALTER TABLE agent_v2_cron_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_v2_cron_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_v2_cron_runs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
