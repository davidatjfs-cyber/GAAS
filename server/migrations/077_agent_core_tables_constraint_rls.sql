-- agent_* 核心表：空库中不存在的历史/可选表跳过，存在且含 tenant_id 时启用 RLS。
DO $$
DECLARE t TEXT;
BEGIN
  IF to_regclass('public.agent_long_memory') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='agent_long_memory' AND column_name='tenant_id') THEN
    ALTER TABLE agent_long_memory DROP CONSTRAINT IF EXISTS uq_agent_long_memory;
    ALTER TABLE agent_long_memory ADD CONSTRAINT uq_agent_long_memory UNIQUE (user_key, memory_key, tenant_id);
  END IF;
  FOREACH t IN ARRAY ARRAY['agent_long_memory','agent_sessions','agent_memory','agent_task_logs','agent_experience','agent_collaboration_logs','agent_optimization_history'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='tenant_id') THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
    END IF;
  END LOOP;
END $$;
