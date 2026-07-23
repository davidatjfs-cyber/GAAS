/**
 * Phase ③：门店上线向导（10 步 checklist）
 * 复用巡检 item_key 自动判定，平台控制台驱动进度。
 */
import { runInspection } from './tenant-operation-inspection-service.js';
import { tenantContext } from '../utils/database.js';
import { SHARED_TABLES } from '@gaas/shared';

export const ONBOARDING_STEPS = [
  { step_key: 'create_store', step_order: 1, title: '创建门店', owner_role: 'platform_team', inspection_keys: ['tenant_has_stores'], impact: '无门店则无法经营诊断与派单' },
  { step_key: 'pos_brand', step_order: 2, title: '选择 POS / 品牌', owner_role: 'platform_team', inspection_keys: [], impact: '影响订单映射与短信签名' },
  { step_key: 'pos_orders', step_order: 3, title: '接入订单', owner_role: 'platform_team', inspection_keys: ['pos_data_connected'], impact: '无订单则营收与诊断不可用' },
  { step_key: 'data_quality', step_order: 4, title: '检查数据质量', owner_role: 'platform_team', inspection_keys: ['yesterday_orders_synced', 'order_phone_complete_rate', 'dish_data_complete'], impact: '质量不足导致营销/归因不可靠' },
  { step_key: 'business_hours', step_order: 5, title: '配置营业时间', owner_role: 'tenant_admin', inspection_keys: ['store_business_hours'], impact: '影响时段诊断与排班建议' },
  { step_key: 'outreach', step_order: 6, title: '配置客户触达', owner_role: 'platform_team', inspection_keys: ['sms_wecom_sent'], impact: '无法触达则自动营销不可用' },
  { step_key: 'growth_rules', step_order: 7, title: '选择默认经营规则', owner_role: 'tenant_admin', inspection_keys: ['marketing_list_non_empty'], impact: '无规则无法自动触达' },
  { step_key: 'first_report', step_order: 8, title: '生成首份报告', owner_role: 'system', inspection_keys: ['morning_briefing_delivered'], impact: '客户看不到交付价值' },
  { step_key: 'training', step_order: 9, title: '管理员培训', owner_role: 'customer_success', inspection_keys: ['manager_roles_configured'], impact: '无人会用导致续费风险' },
  { step_key: 'go_live', step_order: 10, title: '正式启用', owner_role: 'platform_team', inspection_keys: [], impact: '验收通过后租户可正式使用' },
];

let ensurePromise = null;

export async function ensureOnboardingTables(pool) {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_onboarding_runs (
        id BIGSERIAL PRIMARY KEY,
        tenant_id VARCHAR(80) NOT NULL,
        store_id TEXT,
        status TEXT NOT NULL DEFAULT 'in_progress',
        current_step TEXT NOT NULL DEFAULT 'create_store',
        started_by TEXT,
        completed_at TIMESTAMPTZ,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_onboarding_steps (
        id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL REFERENCES tenant_onboarding_runs(id) ON DELETE CASCADE,
        step_key TEXT NOT NULL,
        step_order SMALLINT NOT NULL,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        owner_role TEXT NOT NULL DEFAULT 'platform_team',
        impact TEXT,
        evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        inspection_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
        missing TEXT,
        completed_at TIMESTAMPTZ,
        completed_by TEXT,
        UNIQUE (run_id, step_key)
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tor_tenant ON tenant_onboarding_runs (tenant_id, status)`);
  })().catch((e) => { ensurePromise = null; throw e; });
  return ensurePromise;
}

async function latestInspectionByKey(pool, tenantId) {
  const result = await tenantContext.run(tenantId, () => runInspection(pool, { tenantId, scope: '全部' }));
  const byKey = Object.fromEntries((result.items || []).map((i) => [i.item_key, i]));
  return { overview: result.overview, byKey, items: result.items || [] };
}

function evalStep(stepDef, byKey, meta = {}) {
  if (stepDef.step_key === 'pos_brand') {
    const ok = !!meta.has_brand;
    return { status: ok ? 'done' : 'pending', missing: ok ? '' : '尚未配置品牌/POS 映射', evidence: { has_brand: !!meta.has_brand } };
  }
  if (stepDef.step_key === 'go_live') {
    const ok = String(meta.tenant_status || '') === 'active' && !!meta.acceptance_ok;
    return { status: ok ? 'done' : 'pending', missing: ok ? '' : '需平台验收通过且租户状态为 active', evidence: { tenant_status: meta.tenant_status, acceptance_ok: !!meta.acceptance_ok } };
  }
  const keys = stepDef.inspection_keys || [];
  if (!keys.length) return { status: 'pending', missing: '待人工确认', evidence: {} };
  const bad = [];
  const evidence = {};
  for (const k of keys) {
    const item = byKey[k];
    evidence[k] = item ? { status: item.status, severity: item.severity } : { status: 'missing' };
    if (!item || item.status !== '正常') bad.push(item?.item_name || k);
  }
  return {
    status: bad.length ? 'pending' : 'done',
    missing: bad.length ? `缺少/异常：${bad.join('、')}` : '',
    evidence,
  };
}

async function loadMeta(pool, tenantId) {
  const meta = { has_brand: false, tenant_status: '', acceptance_ok: false };
  const t = await pool.query(`SELECT status FROM tenants WHERE tenant_id=$1 LIMIT 1`, [tenantId]).catch(() => ({ rows: [] }));
  meta.tenant_status = t.rows?.[0]?.status || '';
  const state = await pool.query(
    `SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key=$1 ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
    [tenantId]
  ).catch(() => ({ rows: [] }));
  const raw = state.rows?.[0]?.data;
  const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
  meta.has_brand = Array.isArray(parsed.brands) && parsed.brands.length > 0;
  const acc = await pool.query(
    `SELECT config_value FROM tenant_config WHERE tenant_key=$1 AND config_key='platform_acceptance_report' LIMIT 1`,
    [tenantId]
  ).catch(() => ({ rows: [] }));
  const report = acc.rows?.[0]?.config_value;
  meta.acceptance_ok = !!(report && (report.ok === true || report.ok === 'true'));
  return meta;
}

export async function startOnboarding(pool, { tenantId, startedBy } = {}) {
  await ensureOnboardingTables(pool);
  const id = String(tenantId || '').trim();
  if (!id) throw new Error('tenant_id_required');

  const existing = await pool.query(
    `SELECT * FROM tenant_onboarding_runs WHERE tenant_id=$1 AND status='in_progress' ORDER BY id DESC LIMIT 1`,
    [id]
  );
  if (existing.rows?.[0]) return getOnboarding(pool, existing.rows[0].id);

  const runR = await pool.query(
    `INSERT INTO tenant_onboarding_runs (tenant_id, status, current_step, started_by)
     VALUES ($1,'in_progress','create_store',$2) RETURNING *`,
    [id, startedBy || '']
  );
  const run = runR.rows[0];
  for (const step of ONBOARDING_STEPS) {
    await pool.query(
      `INSERT INTO tenant_onboarding_steps (run_id, step_key, step_order, title, status, owner_role, impact, inspection_keys)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7::jsonb)`,
      [run.id, step.step_key, step.step_order, step.title, step.owner_role, step.impact, JSON.stringify(step.inspection_keys || [])]
    );
  }
  return refreshOnboarding(pool, run.id);
}

export async function getOnboarding(pool, runId) {
  await ensureOnboardingTables(pool);
  const runR = await pool.query(`SELECT * FROM tenant_onboarding_runs WHERE id=$1`, [runId]);
  const run = runR.rows?.[0];
  if (!run) return { ok: false, error: 'not_found' };
  const stepsR = await pool.query(`SELECT * FROM tenant_onboarding_steps WHERE run_id=$1 ORDER BY step_order`, [runId]);
  return { ok: true, run, steps: stepsR.rows || [], step_defs: ONBOARDING_STEPS };
}

export async function getOnboardingByTenant(pool, tenantId) {
  await ensureOnboardingTables(pool);
  const r = await pool.query(
    `SELECT * FROM tenant_onboarding_runs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`,
    [tenantId]
  );
  if (!r.rows?.[0]) return { ok: true, run: null, steps: [], step_defs: ONBOARDING_STEPS };
  return getOnboarding(pool, r.rows[0].id);
}

export async function refreshOnboarding(pool, runId) {
  await ensureOnboardingTables(pool);
  const base = await getOnboarding(pool, runId);
  if (!base.ok) return base;
  const tenantId = base.run.tenant_id;
  const meta = await loadMeta(pool, tenantId);
  let byKey = {};
  try {
    const insp = await latestInspectionByKey(pool, tenantId);
    byKey = insp.byKey;
  } catch (e) {
    console.warn('[onboarding] inspection failed:', e?.message || e);
  }

  let current = 'go_live';
  for (const step of base.steps) {
    const def = ONBOARDING_STEPS.find((s) => s.step_key === step.step_key) || step;
    const manualDone = step.status === 'done' && step.completed_by && step.completed_by !== 'auto';
    const ev = evalStep(def, byKey, meta);
    const status = manualDone ? 'done' : ev.status;
    if (status !== 'done' && current === 'go_live') current = step.step_key;
    await pool.query(
      `UPDATE tenant_onboarding_steps
          SET status=$2, missing=$3, evidence=$4::jsonb,
              completed_at=CASE WHEN $2='done' THEN COALESCE(completed_at, NOW()) ELSE NULL END,
              completed_by=CASE WHEN $2='done' AND completed_by IS NULL THEN 'auto' ELSE completed_by END
        WHERE id=$1`,
      [step.id, status, ev.missing || '', JSON.stringify(ev.evidence || {})]
    );
  }

  const steps = (await pool.query(`SELECT * FROM tenant_onboarding_steps WHERE run_id=$1 ORDER BY step_order`, [runId])).rows || [];
  const allDone = steps.every((s) => s.status === 'done');
  await pool.query(
    `UPDATE tenant_onboarding_runs
        SET current_step=$2, status=$3, completed_at=CASE WHEN $3='completed' THEN NOW() ELSE NULL END, updated_at=NOW(),
            meta = COALESCE(meta,'{}'::jsonb) || $4::jsonb
      WHERE id=$1`,
    [runId, allDone ? 'go_live' : current, allDone ? 'completed' : 'in_progress', JSON.stringify(meta)]
  );
  return getOnboarding(pool, runId);
}

export async function completeOnboardingStep(pool, runId, stepKey, { completedBy, note } = {}) {
  await ensureOnboardingTables(pool);
  await pool.query(
    `UPDATE tenant_onboarding_steps
        SET status='done', missing='', completed_at=NOW(), completed_by=$3,
            evidence = COALESCE(evidence,'{}'::jsonb) || jsonb_build_object('manual_note', $4::text)
      WHERE run_id=$1 AND step_key=$2`,
    [runId, stepKey, completedBy || 'platform_admin', String(note || '').slice(0, 500)]
  );
  return refreshOnboarding(pool, runId);
}
