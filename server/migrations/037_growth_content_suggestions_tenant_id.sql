-- growth_content_suggestions 表补 tenant_id，堵跨租户互看周内容建议的洞。
-- 纯加列+默认值，现网数据自动归入 'default' 租户，零行为风险。

DO $$
BEGIN
  IF to_regclass('public.growth_content_suggestions') IS NOT NULL THEN
    ALTER TABLE growth_content_suggestions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default';
    CREATE INDEX IF NOT EXISTS idx_growth_content_suggestions_tenant ON growth_content_suggestions(tenant_id);
  END IF;
END $$;
