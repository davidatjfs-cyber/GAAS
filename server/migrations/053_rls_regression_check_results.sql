-- RLS Phase5批1：regression_check_results是全局系统代码健康检查记录(initializeRegressionProtection
-- 启动时跑一次，不属于任何租户)，写路径已改为固定tenant_id='default'(见regression-protection.js)。
DO $$
BEGIN
  IF to_regclass('public.regression_check_results') IS NOT NULL THEN
    ALTER TABLE regression_check_results ENABLE ROW LEVEL SECURITY;
    ALTER TABLE regression_check_results FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON regression_check_results;
    CREATE POLICY tenant_isolation ON regression_check_results
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;
