-- P0–P6 考勤薪资闭环：可配置规则 + 日结果 + 薪资账本 + 底薪时间线 + 月结

CREATE TABLE IF NOT EXISTS hrms_attendance_payroll_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  scope_type VARCHAR(20) NOT NULL DEFAULT 'brand', -- brand | store | tenant
  scope_key VARCHAR(120) NOT NULL DEFAULT '',     -- brand_key / store_name / ''
  rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, scope_type, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_hapr_tenant ON hrms_attendance_payroll_rules (tenant_id, active);

COMMENT ON TABLE hrms_attendance_payroll_rules IS '门店/品牌考勤薪资规则（多租户可配）';

-- 权威日结果
CREATE TABLE IF NOT EXISTS hrms_attendance_day (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  store VARCHAR(200) NOT NULL DEFAULT '',
  username VARCHAR(100) NOT NULL,
  work_date DATE NOT NULL,
  result VARCHAR(30) NOT NULL DEFAULT 'unknown',
  -- work | weekly_rest | approved_leave | auto_rest | absence | abnormal | confirmed_work | confirmed_rest
  has_schedule BOOLEAN NOT NULL DEFAULT FALSE,
  has_clock_in BOOLEAN NOT NULL DEFAULT FALSE,
  has_clock_out BOOLEAN NOT NULL DEFAULT FALSE,
  has_complete_punch BOOLEAN NOT NULL DEFAULT FALSE,
  approved_leave_id UUID,
  leave_type VARCHAR(40),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_by VARCHAR(100),
  confirmed_at TIMESTAMPTZ,
  confirm_choice VARCHAR(20),
  locked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, username, work_date)
);

CREATE INDEX IF NOT EXISTS idx_had_store_date ON hrms_attendance_day (tenant_id, store, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_had_result ON hrms_attendance_day (tenant_id, result, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_had_abnormal ON hrms_attendance_day (tenant_id, result) WHERE result = 'abnormal';

COMMENT ON TABLE hrms_attendance_day IS '考勤日结果权威表（计薪/欠休只读此表）';

-- 薪资加减项账本（积分/奖惩/人工补贴）
CREATE TABLE IF NOT EXISTS hrms_payroll_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  username VARCHAR(100) NOT NULL,
  store VARCHAR(200) NOT NULL DEFAULT '',
  biz_month VARCHAR(7) NOT NULL, -- YYYY-MM 业务发生月
  entry_type VARCHAR(40) NOT NULL, -- points | reward | punishment | manual_subsidy | leave_cash | other
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  points NUMERIC(10,2),
  title TEXT,
  reason TEXT,
  approval_id UUID,
  source_ref TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hpl_user_month ON hrms_payroll_ledger (tenant_id, username, biz_month);
CREATE INDEX IF NOT EXISTS idx_hpl_store_month ON hrms_payroll_ledger (tenant_id, store, biz_month);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hpl_approval_type
  ON hrms_payroll_ledger (tenant_id, approval_id, entry_type)
  WHERE approval_id IS NOT NULL;

COMMENT ON TABLE hrms_payroll_ledger IS '薪资加减项账本：积分/奖惩/人工补贴，按业务发生月归属';

-- 底薪时间线（晋升次月生效等）
CREATE TABLE IF NOT EXISTS hrms_salary_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  username VARCHAR(100) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  effective_from DATE NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'manual', -- onboarding | promotion | manual | import
  approval_id UUID,
  note TEXT,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, username, effective_from, source)
);

CREATE INDEX IF NOT EXISTS idx_hst_user ON hrms_salary_timeline (tenant_id, username, effective_from DESC);

COMMENT ON TABLE hrms_salary_timeline IS '底薪生效时间线；晋升默认次月1日生效';

-- 月结批次
CREATE TABLE IF NOT EXISTS hrms_payroll_month_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  store VARCHAR(200) NOT NULL DEFAULT '', -- '' = 全部门店
  biz_month VARCHAR(7) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  -- open | attendance_locked | payroll_locked | paid
  attendance_locked_at TIMESTAMPTZ,
  attendance_locked_by VARCHAR(100),
  payroll_locked_at TIMESTAMPTZ,
  payroll_locked_by VARCHAR(100),
  paid_at TIMESTAMPTZ,
  paid_by VARCHAR(100),
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, store, biz_month)
);

CREATE INDEX IF NOT EXISTS idx_hpmr_month ON hrms_payroll_month_runs (tenant_id, biz_month, status);

COMMENT ON TABLE hrms_payroll_month_runs IS '考勤/薪资月结状态机';

-- 店长确认异常（有打卡无排班）
CREATE TABLE IF NOT EXISTS hrms_attendance_day_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  attendance_day_id UUID REFERENCES hrms_attendance_day(id) ON DELETE CASCADE,
  username VARCHAR(100) NOT NULL,
  store VARCHAR(200) NOT NULL DEFAULT '',
  work_date DATE NOT NULL,
  choice VARCHAR(20) NOT NULL, -- work | rest
  confirmed_by VARCHAR(100) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hadc_date ON hrms_attendance_day_confirmations (tenant_id, work_date DESC);
