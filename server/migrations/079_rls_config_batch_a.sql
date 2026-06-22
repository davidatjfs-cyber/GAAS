-- RLS Phase5批2a: 16张中小型config表写入路径补tenant_id后，约束改为复合(含tenant_id)+开RLS
-- 代码侧已补全所有INSERT/UPSERT的tenant_id列写入与UPDATE WHERE的tenant_id过滤
-- (agent_configs/agent_prompt_templates/agent_reply_templates/agent_rules/hr_rating_configs/
--  metric_dictionary/margin_targets/revenue_targets/kpi_targets/kpi_snapshots/
--  store_marketing_constraints/poster_templates/marketing_templates/marketing_case_library/
--  public_channels/sop_cases)，外加3张零写入路径表(analysis_rules/analysis_sop/cn_holiday_calendar)

-- agent_configs: agent_id 全局唯一 → (agent_id, tenant_id)
ALTER TABLE agent_configs DROP CONSTRAINT agent_configs_agent_id_key;
ALTER TABLE agent_configs ADD CONSTRAINT agent_configs_agent_id_tenant_key UNIQUE (agent_id, tenant_id);

-- agent_prompt_templates: template_key 全局唯一 → (template_key, tenant_id)
ALTER TABLE agent_prompt_templates DROP CONSTRAINT agent_prompt_templates_template_key_key;
ALTER TABLE agent_prompt_templates ADD CONSTRAINT agent_prompt_templates_template_key_tenant_key UNIQUE (template_key, tenant_id);

-- agent_reply_templates: template_key 全局唯一 → (template_key, tenant_id)
ALTER TABLE agent_reply_templates DROP CONSTRAINT agent_reply_templates_template_key_key;
ALTER TABLE agent_reply_templates ADD CONSTRAINT agent_reply_templates_template_key_tenant_key UNIQUE (template_key, tenant_id);

-- agent_rules: category 全局唯一 → (category, tenant_id)
ALTER TABLE agent_rules DROP CONSTRAINT agent_rules_category_key;
ALTER TABLE agent_rules ADD CONSTRAINT agent_rules_category_tenant_key UNIQUE (category, tenant_id);

-- hr_rating_configs: config_key 全局唯一 → (config_key, tenant_id)
ALTER TABLE hr_rating_configs DROP CONSTRAINT hr_rating_configs_config_key_key;
ALTER TABLE hr_rating_configs ADD CONSTRAINT hr_rating_configs_config_key_tenant_key UNIQUE (config_key, tenant_id);

-- margin_targets: (store,brand,period) → 加 tenant_id
ALTER TABLE margin_targets DROP CONSTRAINT margin_targets_store_brand_period_key;
ALTER TABLE margin_targets ADD CONSTRAINT margin_targets_store_brand_period_tenant_key UNIQUE (store, brand, period, tenant_id);

-- revenue_targets: 表owner历史遗留为postgres(非hrms)，需先转移owner才能ALTER(用superuser连接执行这3行)
ALTER TABLE revenue_targets OWNER TO hrms;
ALTER INDEX revenue_targets_pkey OWNER TO hrms;
ALTER INDEX revenue_targets_store_brand_period_key OWNER TO hrms;

-- revenue_targets: (store,brand,period) → 加 tenant_id
ALTER TABLE revenue_targets DROP CONSTRAINT revenue_targets_store_brand_period_key;
ALTER TABLE revenue_targets ADD CONSTRAINT revenue_targets_store_brand_period_tenant_key UNIQUE (store, brand, period, tenant_id);

-- kpi_targets: 表达式唯一索引加 tenant_id
DROP INDEX idx_kpi_targets_unique;
CREATE UNIQUE INDEX idx_kpi_targets_unique ON kpi_targets (COALESCE(store,'__all__'), COALESCE(brand,'__all__'), metric_key, effective_from, tenant_id);

-- kpi_snapshots: (snapshot_date,store) → 加 tenant_id
ALTER TABLE kpi_snapshots DROP CONSTRAINT kpi_snapshots_snapshot_date_store_key;
ALTER TABLE kpi_snapshots ADD CONSTRAINT kpi_snapshots_snapshot_date_store_tenant_key UNIQUE (snapshot_date, store, tenant_id);

-- store_marketing_constraints: store_id 全局唯一 → (store_id, tenant_id)
ALTER TABLE store_marketing_constraints DROP CONSTRAINT store_marketing_constraints_store_id_key;
ALTER TABLE store_marketing_constraints ADD CONSTRAINT store_marketing_constraints_store_id_tenant_key UNIQUE (store_id, tenant_id);

-- poster_templates: template_key 全局唯一 → (template_key, tenant_id)
ALTER TABLE poster_templates DROP CONSTRAINT poster_templates_template_key_key;
ALTER TABLE poster_templates ADD CONSTRAINT poster_templates_template_key_tenant_key UNIQUE (template_key, tenant_id);

-- marketing_case_library: case_key 全局唯一 → (case_key, tenant_id)
ALTER TABLE marketing_case_library DROP CONSTRAINT marketing_case_library_case_key_key;
ALTER TABLE marketing_case_library ADD CONSTRAINT marketing_case_library_case_key_tenant_key UNIQUE (case_key, tenant_id);

-- public_channels: channel_key 全局唯一 → (channel_key, tenant_id)
ALTER TABLE public_channels DROP CONSTRAINT public_channels_channel_key_key;
ALTER TABLE public_channels ADD CONSTRAINT public_channels_channel_key_tenant_key UNIQUE (channel_key, tenant_id);

-- metric_dictionary / marketing_templates / sop_cases: 无ON CONFLICT耦合约束变更，仅开RLS

-- analysis_rules/analysis_sop/cn_holiday_calendar: 现存数据为系统级共享参考数据(BI诊断规则/法定节假日)，
-- 非各租户可定制内容，零写入路径。与agent_v2_configs同类处理：不开per-tenant RLS，
-- 否则新租户会因没有对应tenant_id行而看不到这些数据，需先有"全局表豁免"或"按需复制种子数据"机制才能安全开启。

ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_configs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_prompt_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_prompt_templates
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_reply_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_reply_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_reply_templates
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE agent_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_rules
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE hr_rating_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_rating_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_rating_configs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE metric_dictionary ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_dictionary FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON metric_dictionary
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE margin_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE margin_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON margin_targets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE revenue_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON revenue_targets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE kpi_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_targets
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE kpi_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_snapshots
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE store_marketing_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_marketing_constraints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_marketing_constraints
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE poster_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE poster_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON poster_templates
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE marketing_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing_templates
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE marketing_case_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_case_library FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing_case_library
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE public_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON public_channels
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE sop_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE sop_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sop_cases
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
