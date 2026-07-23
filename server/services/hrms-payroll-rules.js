/**
 * 考勤薪资规则：按租户/品牌/门店可配，洪潮&马己仙默认规则见 DEFAULT_RULES。
 */
import { pool as getPool } from '../utils/database.js';
import { getBrandForStoreSync } from '../utils/brand-config-loader.js';

/** 洪潮 / 马己仙 业务确认口径（2026-07） */
export const DEFAULT_ATTENDANCE_PAYROLL_RULES = Object.freeze({
  version: 1,
  monthlyRestDays: 4,
  dailyRateDenominator: 'month_days_minus_rest', // 月天数 - monthlyRestDays
  weeklyRestSource: 'daily_report', // 周休来自营业日报休息，无需休假审批
  approvedLeaveTypesRequireApproval: ['事假', '病假', '还休', 'personal', 'sick', 'compensatory', 'leave'],
  approvedLeaveAuthoritative: true, // 事假/病假/还休以休假审批为准
  attendanceMode: 'schedule_plus_complete_punch',
  // 有排班无完整打卡 → 自动记休息
  noPunchWithSchedule: 'auto_rest',
  // 有完整打卡无排班 → 异常，店长确认
  punchWithoutSchedule: 'abnormal_confirm',
  requireClockInAndOut: true,
  offsetMissingWithRemainingLeave: true,
  // 倒欠公司假期仍算全勤，后续偿还
  oweLeaveStillFullAttendance: true,
  // 首末月：在职日历天 × 日薪
  midMonthProration: 'active_calendar_days',
  pointsYuanPerPoint: 0.5,
  manualSubsidyAddsWithPoints: true, // 人工补贴与积分相加
  promotionEffective: 'next_month_first', // 晋升次月1日整月新薪
  ledgerBizMonthSource: 'business_occurrence', // 积分/奖惩跟业务发生月
  payDayOfMonth: 15
});

export function cloneDefaultRules() {
  return JSON.parse(JSON.stringify(DEFAULT_ATTENDANCE_PAYROLL_RULES));
}

function normalizeScope(scopeType, scopeKey) {
  const t = String(scopeType || 'brand').trim().toLowerCase() || 'brand';
  const k = String(scopeKey || '').trim();
  return { scopeType: t, scopeKey: k };
}

export async function ensurePayrollRulesTables(db = getPool()) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_attendance_payroll_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
      scope_type VARCHAR(20) NOT NULL DEFAULT 'brand',
      scope_key VARCHAR(120) NOT NULL DEFAULT '',
      rules_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, scope_type, scope_key)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_attendance_day (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
      store VARCHAR(200) NOT NULL DEFAULT '',
      username VARCHAR(100) NOT NULL,
      work_date DATE NOT NULL,
      result VARCHAR(30) NOT NULL DEFAULT 'unknown',
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
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_had_store_date ON hrms_attendance_day (tenant_id, store, work_date DESC)`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_payroll_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
      username VARCHAR(100) NOT NULL,
      store VARCHAR(200) NOT NULL DEFAULT '',
      biz_month VARCHAR(7) NOT NULL,
      entry_type VARCHAR(40) NOT NULL,
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
    )`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_hpl_approval_type
      ON hrms_payroll_ledger (tenant_id, approval_id, entry_type)
      WHERE approval_id IS NOT NULL`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_salary_timeline (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
      username VARCHAR(100) NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      effective_from DATE NOT NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'manual',
      approval_id UUID,
      note TEXT,
      created_by VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, username, effective_from, source)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_payroll_month_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
      store VARCHAR(200) NOT NULL DEFAULT '',
      biz_month VARCHAR(7) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'open',
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
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS hrms_attendance_day_confirmations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
      attendance_day_id UUID,
      username VARCHAR(100) NOT NULL,
      store VARCHAR(200) NOT NULL DEFAULT '',
      work_date DATE NOT NULL,
      choice VARCHAR(20) NOT NULL,
      confirmed_by VARCHAR(100) NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
}

/** 种子：洪潮、马己仙品牌默认规则（幂等） */
export async function seedDefaultBrandPayrollRules(tenantId = 'default', db = getPool()) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const rules = cloneDefaultRules();
  for (const brand of ['hongchao', 'majixian']) {
    await db.query(
      `INSERT INTO hrms_attendance_payroll_rules (tenant_id, scope_type, scope_key, rules_json, active, updated_by)
       VALUES ($1, 'brand', $2, $3::jsonb, true, 'system')
       ON CONFLICT (tenant_id, scope_type, scope_key) DO NOTHING`,
      [tid, brand, JSON.stringify(rules)]
    );
  }
  // 租户级兜底
  await db.query(
    `INSERT INTO hrms_attendance_payroll_rules (tenant_id, scope_type, scope_key, rules_json, active, updated_by)
     VALUES ($1, 'tenant', '', $2::jsonb, true, 'system')
     ON CONFLICT (tenant_id, scope_type, scope_key) DO NOTHING`,
    [tid, JSON.stringify(rules)]
  );
}

function mergeRules(base, overlay) {
  const out = { ...base };
  if (!overlay || typeof overlay !== 'object') return out;
  for (const [k, v] of Object.entries(overlay)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

/**
 * 解析优先级：门店规则 > 品牌规则 > 租户规则 > 代码默认
 */
export async function resolveAttendancePayrollRules({ tenantId, store, brandKey, db = getPool() } = {}) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const storeName = String(store || '').trim();
  let brand = String(brandKey || '').trim().toLowerCase();
  if (!brand && storeName) {
    try {
      const b = getBrandForStoreSync(storeName, tid);
      brand = String(b?.brand_key || b?.brandKey || '').trim().toLowerCase();
    } catch (_) { /* ignore */ }
  }

  const r = await db.query(
    `SELECT scope_type, scope_key, rules_json
       FROM hrms_attendance_payroll_rules
      WHERE tenant_id = $1 AND active = true
        AND (
          (scope_type = 'tenant' AND scope_key = '')
          OR (scope_type = 'brand' AND lower(scope_key) = $2)
          OR (scope_type = 'store' AND trim(scope_key) = $3)
        )`,
    [tid, brand || '__none__', storeName || '__none__']
  );

  let rules = cloneDefaultRules();
  const byType = { tenant: null, brand: null, store: null };
  for (const row of r.rows || []) {
    const t = String(row.scope_type || '').toLowerCase();
    if (t === 'tenant' || t === 'brand' || t === 'store') byType[t] = row.rules_json;
  }
  if (byType.tenant) rules = mergeRules(rules, byType.tenant);
  if (byType.brand) rules = mergeRules(rules, byType.brand);
  if (byType.store) rules = mergeRules(rules, byType.store);
  return {
    rules,
    resolvedFrom: {
      tenant: !!byType.tenant,
      brand: brand || null,
      store: storeName || null,
      usedStore: !!byType.store,
      usedBrand: !!byType.brand
    }
  };
}

export async function listAttendancePayrollRules(tenantId = 'default', db = getPool()) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const r = await db.query(
    `SELECT id, tenant_id, scope_type, scope_key, rules_json, active, updated_by, updated_at
       FROM hrms_attendance_payroll_rules
      WHERE tenant_id = $1
      ORDER BY scope_type, scope_key`,
    [tid]
  );
  return r.rows || [];
}

export async function upsertAttendancePayrollRules({
  tenantId = 'default',
  scopeType = 'brand',
  scopeKey = '',
  rules,
  updatedBy,
  db = getPool()
} = {}) {
  await ensurePayrollRulesTables(db);
  const tid = String(tenantId || 'default').trim() || 'default';
  const { scopeType: st, scopeKey: sk } = normalizeScope(scopeType, scopeKey);
  const merged = mergeRules(cloneDefaultRules(), rules || {});
  const r = await db.query(
    `INSERT INTO hrms_attendance_payroll_rules (tenant_id, scope_type, scope_key, rules_json, active, updated_by, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, true, $5, NOW())
     ON CONFLICT (tenant_id, scope_type, scope_key) DO UPDATE SET
       rules_json = EXCLUDED.rules_json,
       active = true,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING id, tenant_id, scope_type, scope_key, rules_json, active, updated_by, updated_at`,
    [tid, st, sk, JSON.stringify(merged), String(updatedBy || '').trim() || null]
  );
  return r.rows?.[0] || null;
}

export function workDaysPerMonthFromRules(month, rules) {
  const m = String(month || '').trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return 26;
  const [y, mo] = m.split('-').map(Number);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const rest = Number(rules?.monthlyRestDays);
  const monthlyRest = Number.isFinite(rest) && rest >= 0 ? rest : 4;
  if (String(rules?.dailyRateDenominator || '') === 'month_days_minus_rest') {
    return Math.max(1, daysInMonth - monthlyRest);
  }
  return Math.max(1, daysInMonth - monthlyRest);
}

/** 晋升审批通过日 → 次月 1 日生效 */
export function nextMonthFirstFromDate(dateStr) {
  const s = String(dateStr || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 2;
    const d = new Date(y, m - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  const [y, mo] = s.split('-').map(Number);
  const d = new Date(y, mo, 1); // next month day 1
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export function safeBizMonth(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  return '';
}
