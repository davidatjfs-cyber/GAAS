-- 147: 短信模板配置从散落的 ALIYUN_SMS_* 环境变量迁移到数据库表。
-- 背景：2026-07 洪潮签名从"连年由喜餐饮"改为"上海连年由喜餐饮管理"、ABC轮换模板换新code时，
-- 只改了.env文件但没重启进程，导致老进程用内存里的旧值继续发了几天旧模板/超70字短信而无人发现。
-- env变量必须重启进程才生效，这是这类故障的根因；改成运行时查库，改配置立即生效，不再需要重启。
-- brand_suffix对应 brands-config.js getStoreSmsEnvSuffix() 的返回值('MAJIXIAN'/'HONGCHAO'/'DEFAULT'等)，
-- slot对应原来env变量名去掉 ALIYUN_SMS_ 前缀和门店后缀的中间部分(如 'ABCGIFTA'/'NEW4'/'SIGN'/'TEMPLATE'/
-- 'WINBACK_TEMPLATE'/'BALANCE_TEMPLATE')。sign_name/template_code 均可为空(SIGN行只填sign_name)。
CREATE TABLE IF NOT EXISTS sms_templates (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  brand_suffix TEXT NOT NULL,
  slot TEXT NOT NULL,
  template_code TEXT NOT NULL DEFAULT '',
  sign_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  vars JSONB NOT NULL DEFAULT '[]',
  sample_values JSONB NOT NULL DEFAULT '{}',
  char_len INT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, brand_suffix, slot)
);
CREATE INDEX IF NOT EXISTS idx_sms_templates_lookup ON sms_templates (tenant_id, slot, brand_suffix);
