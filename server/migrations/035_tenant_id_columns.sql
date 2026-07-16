-- 给核心规范化表加 tenant_id 列，为多租户改造打地基。
-- 纯加列+默认值，不改任何现有查询逻辑，零行为风险——
-- 所有现有数据自动归入 'default' 租户，现网马己仙/洪潮使用不受影响。

DO $$
DECLARE t TEXT; idx TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['training_topics','training_assignments','training_certifications','growth_actions','ab_test_tasks','strategy_experiments'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT %L', t, 'default');
      idx := 'idx_' || t || '_tenant';
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(tenant_id)', idx, t);
    END IF;
  END LOOP;
END $$;
