-- Ontology rule configuration MVP.
-- Rules are scoped by specificity: system default (tenant/store null),
-- tenant override, and store override. This migration is idempotent.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ontology_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id varchar(120) NOT NULL,
  tenant_id varchar(80),
  store_id varchar(120),
  rule_type varchar(60) NOT NULL DEFAULT 'diagnosis',
  rule_name varchar(200) NOT NULL,
  business_domain varchar(80) NOT NULL,
  target_metric varchar(120),
  condition_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  boss_language_template text,
  severity varchar(20) DEFAULT 'P2',
  priority varchar(20) DEFAULT 'P2',
  confidence_base numeric DEFAULT 0.75,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by varchar(120) DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS tenant_id varchar(80);
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS store_id varchar(120);
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS condition_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS action_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS boss_language_template text;
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS effective_from timestamptz NOT NULL DEFAULT now();
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS effective_to timestamptz;
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ontology_rules ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS ontology_rules_scope_version_idx
  ON ontology_rules (rule_id, COALESCE(tenant_id, ''), COALESCE(store_id, ''), version);
CREATE INDEX IF NOT EXISTS idx_ontology_rules_lookup
  ON ontology_rules (rule_id, tenant_id, store_id, is_active, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_ontology_rules_domain
  ON ontology_rules (business_domain, rule_type, is_active);

CREATE TABLE IF NOT EXISTS ontology_rule_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id varchar(120) NOT NULL,
  tenant_id varchar(80),
  store_id varchar(120),
  threshold_key varchar(120) NOT NULL,
  threshold_value numeric NOT NULL,
  threshold_unit varchar(40),
  comparator varchar(20),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ontology_rule_thresholds_scope_idx
  ON ontology_rule_thresholds (rule_id, threshold_key, COALESCE(tenant_id, ''), COALESCE(store_id, ''));
CREATE INDEX IF NOT EXISTS idx_ontology_rule_thresholds_lookup
  ON ontology_rule_thresholds (rule_id, threshold_key, tenant_id, store_id, is_active);

CREATE TABLE IF NOT EXISTS ontology_rule_hits (
  id bigserial PRIMARY KEY,
  tenant_id varchar(80) NOT NULL DEFAULT 'default',
  store_id varchar(120),
  rule_id varchar(120) NOT NULL,
  rule_version integer,
  rule_type varchar(60),
  entity_type varchar(80),
  entity_id varchar(200),
  input_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched_conditions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_issue_id varchar(200),
  generated_opportunity_id varchar(200),
  generated_task_id varchar(200),
  confidence_score numeric,
  severity varchar(20),
  boss_language_output text,
  hit_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ontology_rule_hits_tenant_time
  ON ontology_rule_hits (tenant_id, hit_at DESC);
CREATE INDEX IF NOT EXISTS idx_ontology_rule_hits_rule
  ON ontology_rule_hits (rule_id, tenant_id, store_id, hit_at DESC);

CREATE TABLE IF NOT EXISTS ontology_rule_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(80),
  store_id varchar(120),
  rule_set_name varchar(200) NOT NULL,
  business_type varchar(80),
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ontology_rule_sets_scope
  ON ontology_rule_sets (tenant_id, store_id, is_active);

INSERT INTO ontology_rules (
  rule_id, rule_type, rule_name, business_domain, target_metric,
  condition_json, action_json, boss_language_template,
  severity, priority, confidence_base, version, is_active, created_by
) VALUES
('dormant_customer_reactivation','diagnosis','沉睡老客唤醒','customer_growth','last_visit_days',
 '{"all":[{"field":"lastVisitDays","comparator":"between","value":[90,180]},{"any":[{"field":"visitCount","comparator":">=","value":2},{"field":"totalSpend","comparator":">=","value":300}]}]}'::jsonb,
 '{"generate_issue":"customer_asset_risk","issue_type":"customer_asset_risk","generate_opportunity":"dormant_customer_reactivation","recommended_action":"老客专属唤醒","owner_role":"营销负责人","deadline_days":7,"expected_result":"追回沉睡老客并形成回店消费","tracking_metrics":["触达人数","回店人数","贡献营业额"]}'::jsonb,
 '系统发现一批 {days_min} 天以上未回店的老客，其中 {priority_customer_count} 位过去消费过多次，属于值得优先追回的客户。',
 'P2','P2',0.80,1,true,'system'),
('new_customer_second_visit','diagnosis','新客二次转化','customer_growth','first_visit_days',
 '{"all":[{"field":"firstVisitDays","comparator":"between","value":[7,14]},{"field":"secondVisitCount","comparator":"=","value":0}]}'::jsonb,
 '{"generate_issue":"new_customer_no_second_visit","issue_type":"new_customer_no_second_visit","generate_opportunity":"new_customer_second_visit","recommended_action":"新客二次到店邀请","owner_role":"店长","deadline_days":7,"expected_result":"新客二次到店率 >= 12%","tracking_metrics":["新客触达人数","二次回店人数","二次回店率","二次消费金额","优惠成本","净增量"]}'::jsonb,
 '系统发现一批新客第一次来店后还没有第二次消费，建议本周完成一次二次到店邀请，把新客变成熟客。',
 'P2','P2',0.82,1,true,'system'),
('revenue_decline','diagnosis','营业额下降','operation_improvement','revenue_change_rate',
 '{"all":[{"field":"revenueChangeRate","comparator":"<=","value":-8}]}'::jsonb,
 '{"generate_issue":"revenue_decline","issue_type":"revenue_decline","generate_opportunity":"operation_recovery","fallback_opportunity":"lunch_revenue_recovery","recommended_action":"经营恢复拆解","owner_role":"店长","deadline_days":3,"expected_result":"找到营业额下降主因并制定恢复动作","tracking_metrics":["营业额","客流","客单价","复购率"]}'::jsonb,
 '系统发现门店营业额相比基准下降 {change_rate}%，需要优先判断是客流下降、客单价下降还是复购下降。',
 'P2','P2',0.84,1,true,'system'),
('repeat_rate_low','diagnosis','复购率偏低','customer_growth','repeat_rate',
 '{"all":[{"field":"repeatRate","comparator":"<","value":0.35}]}'::jsonb,
 '{"generate_issue":"repeat_decline","issue_type":"repeat_decline","generate_opportunity":"dormant_customer_reactivation","fallback_opportunity":"new_customer_second_visit","recommended_action":"客户复购提升","owner_role":"营销负责人","deadline_days":7,"expected_result":"提升复购率到健康线以上","tracking_metrics":["复购率","回店人数","二次到店率"]}'::jsonb,
 '系统发现复购率低于健康水平，说明客户进得来但没有留下来。',
 'P2','P2',0.76,1,true,'system'),
('marketing_conversion_low','diagnosis','营销转化不足','customer_growth','marketing_conversion_rate',
 '{"all":[{"field":"marketingConversionRate","comparator":"<","value":0.25}]}'::jsonb,
 '{"generate_issue":"marketing_ineffective","issue_type":"marketing_ineffective","generate_opportunity":"marketing_optimization","fallback_opportunity":"dormant_customer_reactivation","recommended_action":"复盘客群权益文案","owner_role":"营销负责人","deadline_days":5,"expected_result":"提升触达回店转化率","tracking_metrics":["触达转化率","回店人数","贡献营业额"]}'::jsonb,
 '系统发现客户已经触达，但回店转化不足，建议检查客群、权益和文案是否匹配。',
 'P2','P2',0.78,1,true,'system'),
('task_overdue_high','diagnosis','任务逾期偏高','task_execution','overdue_task_count',
 '{"any":[{"field":"overdueTaskCount","comparator":">=","value":1},{"field":"overdueRate","comparator":">","value":0.2}]}'::jsonb,
 '{"generate_issue":"staff_execution_risk","issue_type":"staff_execution_risk","generate_opportunity":"staff_execution_improvement","recommended_action":"执行逾期跟进","owner_role":"店长","deadline_days":2,"expected_result":"逾期任务清零并恢复执行节奏","tracking_metrics":["逾期任务数","任务完成率"]}'::jsonb,
 '系统发现有增长动作没有按时完成，问题不是没发现，而是执行没有跟上。',
 'P2','P2',0.72,1,true,'system')
ON CONFLICT (rule_id, COALESCE(tenant_id, ''), COALESCE(store_id, ''), version) DO UPDATE SET
  rule_name = EXCLUDED.rule_name,
  business_domain = EXCLUDED.business_domain,
  target_metric = EXCLUDED.target_metric,
  condition_json = EXCLUDED.condition_json,
  action_json = EXCLUDED.action_json,
  boss_language_template = EXCLUDED.boss_language_template,
  severity = EXCLUDED.severity,
  priority = EXCLUDED.priority,
  confidence_base = EXCLUDED.confidence_base,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO ontology_rule_thresholds (
  rule_id, threshold_key, threshold_value, threshold_unit, comparator, description
) VALUES
('dormant_customer_reactivation','days_min',90,'days','>=','沉睡客户起始天数'),
('dormant_customer_reactivation','days_max',180,'days','<=','沉睡客户结束天数'),
('dormant_customer_reactivation','min_historical_visit_count',2,'count','>=','优先维护最低历史消费次数'),
('dormant_customer_reactivation','min_total_spend',300,'yuan','>=','优先维护最低历史消费金额'),
('new_customer_second_visit','first_visit_days_min',7,'days','>=','首次到店后观察起始天数'),
('new_customer_second_visit','first_visit_days_max',14,'days','<=','首次到店后观察结束天数'),
('new_customer_second_visit','second_visit_window_days',14,'days','<=','二次转化归因窗口'),
('revenue_decline','revenue_decline_threshold',-8,'percent','<=','营业额下降阈值'),
('repeat_rate_low','repeat_rate_threshold',0.35,'ratio','<','复购率健康线'),
('marketing_conversion_low','marketing_conversion_threshold',0.25,'ratio','<','营销转化健康线'),
('task_overdue_high','overdue_task_count',1,'count','>=','逾期任务数阈值'),
('task_overdue_high','overdue_rate',0.2,'ratio','>','逾期率阈值')
ON CONFLICT (rule_id, threshold_key, COALESCE(tenant_id, ''), COALESCE(store_id, '')) DO UPDATE SET
  threshold_value = EXCLUDED.threshold_value,
  threshold_unit = EXCLUDED.threshold_unit,
  comparator = EXCLUDED.comparator,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();
