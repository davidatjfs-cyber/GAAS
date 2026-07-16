-- 身份表租户 RLS：仅对当前库中存在且含 tenant_id 的表启用。
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','employees','user_sessions','feishu_users'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I',t);
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))',t);
    END IF;
  END LOOP;
END $$;
