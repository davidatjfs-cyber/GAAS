-- RLS Phase5批2b: knowledge_base/knowledge_edit_history/hrms_user_notifications大表开RLS
-- 代码侧已补全所有INSERT的tenant_id列写入。这3张表只有PRIMARY KEY约束(knowledge_base另有1个created_by的FK)，
-- 无其他UNIQUE约束，无ON CONFLICT耦合，故无需像079那样改约束/索引，仅需开RLS+建policy。

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_base
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE knowledge_edit_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_edit_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON knowledge_edit_history
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE hrms_user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE hrms_user_notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hrms_user_notifications
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
