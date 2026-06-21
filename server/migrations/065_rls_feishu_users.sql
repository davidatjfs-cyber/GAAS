-- RLS Phase5全量推进第5批：feishu_users开RLS。open_id单列唯一约束改成(open_id, tenant_id)，
-- 配合agents.js里registerFeishuUser的ON CONFLICT目标同步改。
ALTER TABLE feishu_users DROP CONSTRAINT IF EXISTS feishu_users_open_id_key;
ALTER TABLE feishu_users ADD CONSTRAINT feishu_users_open_id_key UNIQUE (open_id, tenant_id);

ALTER TABLE feishu_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE feishu_users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feishu_users
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
