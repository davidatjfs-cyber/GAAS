-- 业务确认的真实发布渠道（2026-08-06）：
-- 大众点评 / 小红书 / 抖音 / 企微。企微走 store_wecom_configs，其余在此登记，
-- 营销建议生成侧按此表判断「渠道本店可用」，不再把业务在运营的渠道剔除。
INSERT INTO public_channels (channel_key, name, platform, store_id, enabled, tenant_id)
VALUES
  ('v8_dianping',   '大众点评', 'dianping',    '', TRUE, 'default'),
  ('v8_xiaohongshu','小红书',   'xiaohongshu', '', TRUE, 'default'),
  ('v8_douyin',     '抖音号',   'douyin',      '', TRUE, 'default')
ON CONFLICT (channel_key) DO NOTHING;
