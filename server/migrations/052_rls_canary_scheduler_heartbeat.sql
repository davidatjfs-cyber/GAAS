-- RLS Phase1金丝雀验证：scheduler_heartbeat(低流量监控表，误配置时优雅降级，
-- 标准tenant_id列命名)率先开启行级安全，验证app.tenant_id会话变量机制可用后再批量铺开。
ALTER TABLE scheduler_heartbeat ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_heartbeat FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON scheduler_heartbeat
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
