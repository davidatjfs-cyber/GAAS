-- RLS Phase5全量推进-agent_messages独立批
-- 代码已补全17处INSERT(agents.js 16处 + force_sync.js 2处)的tenant_id列写入
-- 6处CTE手工UPSERT(negative_review/generic_bitable/closing_report/opening_report/meeting_report/material_report)
-- 的UPDATE WHERE子句已补tenant_id过滤，避免跨租户覆盖风险
-- record_id+content_type唯一索引保持不变(Feishu record_id全局唯一，无需加tenant_id)
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_messages
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
