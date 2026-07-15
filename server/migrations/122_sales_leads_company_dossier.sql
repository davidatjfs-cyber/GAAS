-- 122: 客户完整档案——营业执照/开票信息/注册地址/公司规模等正式签约资料。
-- 之前sales_leads只有company/phone/city这类"AI诊断用"字段，且没有任何手动编辑接口，
-- 客户AI提取错了或没问到的信息(比如开票抬头)完全没地方补录。

ALTER TABLE sales_leads
  ADD COLUMN IF NOT EXISTS legal_company_name TEXT,   -- 营业执照全称(可能跟company简称不同)
  ADD COLUMN IF NOT EXISTS unified_credit_code TEXT,   -- 统一社会信用代码
  ADD COLUMN IF NOT EXISTS registered_address TEXT,    -- 注册地址
  ADD COLUMN IF NOT EXISTS company_size TEXT,          -- 公司规模(如"1-10人"/"11-50人"/"50人以上")
  ADD COLUMN IF NOT EXISTS website TEXT,               -- 官网
  ADD COLUMN IF NOT EXISTS invoice_title TEXT,         -- 开票抬头
  ADD COLUMN IF NOT EXISTS invoice_tax_no TEXT,        -- 纳税人识别号(通常同统一社会信用代码，单独存以防不一致)
  ADD COLUMN IF NOT EXISTS invoice_bank_name TEXT,     -- 开户行
  ADD COLUMN IF NOT EXISTS invoice_bank_account TEXT,  -- 银行账号
  ADD COLUMN IF NOT EXISTS legal_contact_name TEXT,    -- 官方联系人姓名
  ADD COLUMN IF NOT EXISTS legal_contact_title TEXT,   -- 官方联系人职位
  ADD COLUMN IF NOT EXISTS legal_contact_phone TEXT;   -- 官方联系人电话

COMMENT ON COLUMN sales_leads.legal_company_name IS '营业执照全称，跟company(客户AI聊天里提取到的简称)分开存';
