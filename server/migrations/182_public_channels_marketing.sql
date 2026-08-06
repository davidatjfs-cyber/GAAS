-- 业务确认的真实发布渠道（2026-08-06）：
-- 大众点评 / 小红书 / 抖音 / 企微。企微走 store_wecom_configs，其余在此登记，
-- 营销建议生成侧按此表判断「渠道本店可用」，不再把业务在运营的渠道剔除。
-- 不用 ON CONFLICT：各环境唯一约束形态不一致（channel_key 或 channel_key+tenant_id），
-- WHERE NOT EXISTS 与约束无关且天然幂等。
INSERT INTO public_channels (channel_key, name, platform, store_id, enabled, tenant_id)
SELECT v.k, v.n, v.p, '', TRUE, 'default'
FROM (VALUES
  ('v8_dianping',   '大众点评', 'dianping'),
  ('v8_xiaohongshu','小红书',   'xiaohongshu'),
  ('v8_douyin',     '抖音号',   'douyin')
) AS v(k, n, p)
WHERE NOT EXISTS (
  SELECT 1 FROM public_channels c WHERE c.channel_key = v.k AND c.tenant_id = 'default'
);
