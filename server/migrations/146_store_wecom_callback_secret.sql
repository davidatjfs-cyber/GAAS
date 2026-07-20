-- 146: store_wecom_configs 增加租户自己的企微送达状态回调密钥(callback_secret)。
-- 此前 /api/growth/wecom/callback 的密钥校验只认全局 growth_wecom_config.callback_secret，
-- 跟消息发送本身(已按store_id/tenant_id隔离)不一致。这里补上按门店独立配置的入口，
-- 未配置的门店/老租户回退全局密钥，行为不变。

ALTER TABLE store_wecom_configs ADD COLUMN IF NOT EXISTS callback_secret text DEFAULT '';
