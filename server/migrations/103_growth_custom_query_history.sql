-- "六大增长方案" 自定义问题分析(gsAnalyzeCustom)的查询历史存档。
-- 目的：老板不用每次都重新输入问题，可以直接从历史记录里点开之前分析过的结果重复查看。
CREATE TABLE IF NOT EXISTS growth_custom_query_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  store text NOT NULL,
  question text NOT NULL,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_growth_custom_query_history_lookup
  ON growth_custom_query_history (tenant_id, store, created_at DESC);
