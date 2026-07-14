-- 111: 销售 AI 商业闭环——成交后租户开通与 growth_customers 桥接字段

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS growth_customer_id BIGINT,
  ADD COLUMN IF NOT EXISTS provision_status TEXT,
  ADD COLUMN IF NOT EXISTS provision_meta JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sales_leads_tenant ON sales_leads (tenant_id);

ALTER TABLE sales_trials
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS provision_status TEXT,
  ADD COLUMN IF NOT EXISTS validation_status TEXT,
  ADD COLUMN IF NOT EXISTS validation_report JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provision_meta JSONB DEFAULT '{}'::jsonb;

ALTER TABLE sales_deals
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80),
  ADD COLUMN IF NOT EXISTS provision_status TEXT,
  ADD COLUMN IF NOT EXISTS provision_meta JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_sales_trials_tenant ON sales_trials (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sales_deals_tenant ON sales_deals (tenant_id);

-- 销售案例库默认种子（与 sales-case-library.js 表结构一致）
CREATE TABLE IF NOT EXISTS sales_case_assets (
  id BIGSERIAL PRIMARY KEY,
  case_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  pain_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  body TEXT NOT NULL,
  suggested_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sales_case_assets (case_key, title, theme, pain_tags, summary, body, suggested_modules, sort_order)
VALUES
  ('revenue_decline_hotpot', '火锅品牌 21 天营业额回升 12%', '营业额下降', '["营业额","下降","归因"]', '某火锅连锁 5 店通过时段/菜品归因找到 18:00-20:00 出餐瓶颈，优化后营业额回升。', '问题：营业额连续 3 周下滑，但订单量没变。\n诊断：POS 分析发现 18:00-20:00 出餐慢导致翻台率下降。\n动作：优化后厨动线 + 预点餐提醒。\n结果：21 天营业额回升 12%，高峰期翻台率提升 0.4。', '["经营日报","异常归因","菜品优化"]', 10),
  ('vip_return_bakery', '烘焙品牌老客 30 天回店率提升 22%', '老客复购', '["复购","老客","回店"]', '烘焙连锁通过沉睡客户自动唤醒 + 生日券，老客回店率提升。', '问题：老客户 90 天未消费占比高。\n动作：AI 分层沉睡客户，自动推送「满 50-15」召回券。\n结果：30 天回店率提升 22%，券核销率 31%。', '["客户分层","自动营销","券核销跟踪"]', 20),
  ('execution_bbq', '烧烤品牌店长执行闭环案例', '门店执行', '["执行","店长","督导"]', '烧烤 8 店通过「问题-责任人-确认完成」闭环，人效提升。', '问题：每日问题多但无人跟进。\n动作：AI 日报只推送必要动作，店长 1 键确认完成。\n结果：执行完成率 89%，客户差评下降 35%。', '["AI店长日报","任务追踪","执行复盘"]', 30),
  ('training_catering', '正餐品牌人才培养与绩效', '人才培养', '["培训","人才","员工","绩效"]', '正餐品牌通过标准化岗位路径 + 绩效看板，降低离职率。', '问题：新员工 3 个月离职率高，培训靠师傅口传。\n动作：岗位 SOP + 任务通关 + 绩效排名。\n结果：3 个月离职率下降 18%，人效提升 11%。', '["员工培训","绩效看板","任务通关"]', 40)
ON CONFLICT (case_key) DO UPDATE SET
  title = EXCLUDED.title,
  theme = EXCLUDED.theme,
  pain_tags = EXCLUDED.pain_tags,
  summary = EXCLUDED.summary,
  body = EXCLUDED.body,
  suggested_modules = EXCLUDED.suggested_modules,
  updated_at = NOW();

-- 成交事件日志类型
-- TENANT_PROVISIONED 会在 sales_lead_events 里记录
