/**
 * 试跑期间数据校验：对比 POS 营收与执行指标
 */
import { tenantContext } from '../../utils/database.js';

export async function validateTrialProgress(pool, { leadId, tenantId, trialId, days = 30 } = {}) {
  if (!tenantId) return { ok: false, error: 'missing_tenant' };

  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const report = { tenant_id: tenantId, lead_id: leadId, trial_id: trialId, since, metrics: {}, status: 'unknown', summary: '' };

  try {
    const rev = await tenantContext.run(tenantId, () => pool.query(
      `SELECT COALESCE(SUM(revenue), 0)::numeric AS total_rev, COUNT(DISTINCT date)::int AS active_days
         FROM pos_sales_detail
        WHERE tenant_id = $1 AND date >= $2::date`,
      [tenantId, since]
    ));
    const dr = await tenantContext.run(tenantId, () => pool.query(
      `SELECT COUNT(*)::int AS report_days, COALESCE(AVG(actual_margin), 0)::numeric AS avg_margin
         FROM daily_reports
        WHERE tenant_id = $1 AND date >= $2::date`,
      [tenantId, since]
    ).catch(() => ({ rows: [{ report_days: 0, avg_margin: 0 }] })));

    const totalRev = Number(rev.rows?.[0]?.total_rev || 0);
    const activeDays = Number(rev.rows?.[0]?.active_days || 0);
    const reportDays = Number(dr.rows?.[0]?.report_days || 0);

    report.metrics = {
      pos_revenue: totalRev,
      pos_active_days: activeDays,
      daily_report_days: reportDays,
      avg_margin: Number(dr.rows?.[0]?.avg_margin || 0),
    };

    if (activeDays >= 7 && totalRev > 0) {
      report.status = reportDays >= 3 ? 'on_track' : 'data_partial';
      report.summary = reportDays >= 3
        ? `试跑${activeDays}天有POS数据，营收${Math.round(totalRev)}，日报${reportDays}天，进展正常`
        : `有POS数据但日报偏少（${reportDays}天），建议补齐经营日报`;
    } else if (activeDays > 0) {
      report.status = 'early';
      report.summary = `试跑初期，仅${activeDays}天POS数据，继续观察`;
    } else {
      report.status = 'no_data';
      report.summary = '试跑期内暂无POS营收数据，请检查订单接入';
    }
  } catch (e) {
    report.status = 'error';
    report.summary = e?.message || '校验失败';
  }

  if (trialId) {
    await pool.query(
      `UPDATE sales_trials SET validation_status=$2, validation_report=$3::jsonb, updated_at=NOW() WHERE id=$1`,
      [trialId, report.status, JSON.stringify(report)]
    );
  }
  if (leadId && report.status === 'no_data') {
    await pool.query(`UPDATE sales_leads SET next_action=$2, updated_at=NOW() WHERE id=$1`, [leadId, '试跑无数据：检查POS接入']);
  }

  return { ok: true, report };
}

const KPI_LABELS = { revenue: '营收', active_days: '活跃天数', repeat_rate: '复购率', avg_margin: '毛利率' };

/**
 * 试跑第几天/还剩几天 + target_kpis(建档时约定的目标) vs 实际值对比，
 * 补上 validateTrialProgress 缺的"倒计时+目标达成"视角(那个函数只判断有没有数据)。
 */
export async function buildTrialProgressSummary(pool, trialId) {
  const t = await pool.query(`SELECT * FROM sales_trials WHERE id=$1 LIMIT 1`, [trialId]);
  const trial = t.rows?.[0];
  if (!trial) return { ok: false, error: 'not_found' };
  if (!trial.tenant_id) return { ok: false, error: 'not_provisioned' };

  const startedAt = trial.started_at ? new Date(trial.started_at) : null;
  const totalDays = 30;
  const dayOf = startedAt ? Math.min(totalDays, Math.max(1, Math.floor((Date.now() - startedAt.getTime()) / 86400000) + 1)) : null;
  const daysRemaining = dayOf != null ? Math.max(0, totalDays - dayOf) : null;
  const since = startedAt ? startedAt.toISOString().slice(0, 10) : new Date(Date.now() - totalDays * 86400000).toISOString().slice(0, 10);

  const rev = await tenantContext.run(trial.tenant_id, () => pool.query(
    `SELECT COALESCE(SUM(revenue), 0)::numeric AS total_rev, COUNT(DISTINCT date)::int AS active_days
       FROM pos_sales_detail WHERE tenant_id = $1 AND date >= $2::date`,
    [trial.tenant_id, since]
  )).catch(() => ({ rows: [{ total_rev: 0, active_days: 0 }] }));
  const actual = {
    revenue: Number(rev.rows?.[0]?.total_rev || 0),
    active_days: Number(rev.rows?.[0]?.active_days || 0),
  };

  const targets = trial.target_kpis && typeof trial.target_kpis === 'object' ? trial.target_kpis : {};
  const kpis = Object.keys(targets).length
    ? Object.entries(targets).map(([key, target]) => {
        const actualVal = actual[key] ?? null;
        const met = actualVal != null && Number(target) > 0 ? actualVal >= Number(target) : null;
        return { key, label: KPI_LABELS[key] || key, target: Number(target), actual: actualVal, met };
      })
    : [];

  const summary = dayOf == null
    ? '试跑尚未开始计时(缺开始日期)'
    : `试跑第${dayOf}/${totalDays}天，剩${daysRemaining}天。${kpis.length ? kpis.map((k) => `${k.label} ${k.actual ?? '无数据'}/${k.target}${k.met === false ? '(未达标)' : k.met === true ? '(已达标)' : ''}`).join('，') : '未设置KPI目标'}`;

  return {
    ok: true,
    trial_id: trialId,
    tenant_id: trial.tenant_id,
    day_of: dayOf,
    total_days: totalDays,
    days_remaining: daysRemaining,
    actual,
    kpis,
    summary,
  };
}

export async function runTrialValidations(pool, { limit = 20 } = {}) {
  const r = await pool.query(
    `SELECT t.id AS trial_id, t.lead_id, t.tenant_id, l.company, l.name
       FROM sales_trials t
       JOIN sales_leads l ON l.id = t.lead_id
      WHERE t.status IN ('in_progress', 'active')
        AND t.tenant_id IS NOT NULL
        AND (t.validation_status IS NULL OR t.validation_status IN ('early', 'data_partial', 'no_data'))
      ORDER BY t.started_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const row of r.rows || []) {
    const v = await validateTrialProgress(pool, { leadId: row.lead_id, tenantId: row.tenant_id, trialId: row.trial_id });
    results.push({ lead_id: row.lead_id, company: row.company || row.name, ...v });
  }
  return results;
}
