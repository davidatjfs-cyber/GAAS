-- 151: 已验证产品事实的个性化培育资料。
-- 只提供可选素材；只有销售为具体线索显式开启 auto_nurture_enabled 后才会自动发送。

INSERT INTO sales_content_assets (
  asset_key,title,content_type,text_content,external_approved,active,auto_send_allowed,
  tags,created_by,approved_by,nurture_step,knowledge_domain,customer_types,version_no
)
VALUES (
  'gaas_verified_nurture_day7_v1',
  'Day7：按客户痛点推进演示或试跑',
  'text',
  '{{customer_name}}，上次您关注的是{{pain_point}}。判断系统值不值得继续看，不用先比较页面数量；更有效的是选一个当前问题，确认数据条件和验收指标，再通过针对性演示或代表门店30天试跑看真实结果。您回复“演示”，我们就按{{store_count}}家门店的情况准备。',
  true,true,true,
  '["培育","针对性演示","30天试跑"]'::jsonb,
  'migration:151',
  'verified_product_knowledge',
  3,
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
  nurture_step=EXCLUDED.nurture_step,
  knowledge_domain=EXCLUDED.knowledge_domain,
  customer_types=EXCLUDED.customer_types,
  version_no=EXCLUDED.version_no,
  updated_at=NOW();
