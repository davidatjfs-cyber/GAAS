-- 150: 客户AI销售转化激活。
-- 只补充已由系统代码与产品手册验证的公开事实；不写价格、客户名称、效果数字或未授权案例。

INSERT INTO sales_knowledge_items (item_key, title, body, pain_keys, active, sort_order)
VALUES
  ('core-differentiator', '核心卖点', '最大的差别不是多一张报表，而是把发现问题、安排执行、提交证据、验收结果和复盘改善连成闭环。老板看到的不只是数据，而是问题有没有真正解决。', '[]'::jsonb, true, 5),
  ('package-differences', '基础、连锁与集团方案', '方案差别主要来自门店数量、跨店汇总、区域与总部的分级权限、使用模块、数据接入和试跑范围。客户AI只说明定价维度和优惠原则，具体报价与折扣由获授权顾问审批确认。', '["多店管理"]'::jsonb, true, 85),
  ('cooperation-process', '演示、试跑与合作流程', '先确认门店情况和核心需求，再做数据接入评估与针对性演示；适合试跑时选择代表门店并约定30天验证指标，复盘真实结果后再确认正式范围、商务方案和合同。', '[]'::jsonb, true, 86),
  ('case-disclosure-policy', '客户案例公开边界', '只有获得对外使用授权并完成匿名处理的案例才能展示。没有授权时，不得编造客户名称、经营结果或提升比例，可改为提供针对性演示和可验收的试跑指标。', '[]'::jsonb, true, 87)
ON CONFLICT (item_key) DO UPDATE SET
  title=EXCLUDED.title,
  body=EXCLUDED.body,
  pain_keys=EXCLUDED.pain_keys,
  active=EXCLUDED.active,
  sort_order=EXCLUDED.sort_order,
  updated_at=NOW();

INSERT INTO sales_content_assets (
  asset_key,title,content_type,text_content,external_approved,active,auto_send_allowed,
  tags,created_by,approved_by,nurture_step,knowledge_domain,customer_types,version_no
)
VALUES (
  'gaas_verified_product_intro_v1',
  'GAAS餐厅AI增长服务文字介绍',
  'text',
  '我们提供的是餐厅AI增长服务，核心不是再增加一套报表，而是把POS经营数据、客户维护、门店执行和员工培养串成闭环：发现问题后形成动作，明确责任人和证据，再跟踪结果是否改善。合作前会先确认门店情况和数据条件，可通过针对性演示或代表门店30天试跑，用真实结果判断是否扩大。具体报价、折扣、POS接入与合同条款由顾问评估确认。',
  true,true,false,
  '["产品介绍","核心卖点","演示","试跑"]'::jsonb,
  'migration:150',
  'verified_product_knowledge',
  NULL,
  'customer_ai',
  '["餐饮门店","连锁餐饮","集团餐饮"]'::jsonb,
  1
)
ON CONFLICT (asset_key) DO UPDATE SET
  title=EXCLUDED.title,
  content_type=EXCLUDED.content_type,
  text_content=EXCLUDED.text_content,
  external_approved=EXCLUDED.external_approved,
  active=EXCLUDED.active,
  auto_send_allowed=EXCLUDED.auto_send_allowed,
  tags=EXCLUDED.tags,
  approved_by=EXCLUDED.approved_by,
  knowledge_domain=EXCLUDED.knowledge_domain,
  customer_types=EXCLUDED.customer_types,
  version_no=EXCLUDED.version_no,
  updated_at=NOW();
