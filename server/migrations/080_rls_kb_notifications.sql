-- 可选知识库/通知表：存在且含 tenant_id 时启用租户 RLS。
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['knowledge_base','knowledge_edit_history','hrms_user_notifications'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',t);
    END IF;
  END LOOP;
END $$;
