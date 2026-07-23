/**
 * 活动计划 / 营销模板 / 门店排行（从 growth-phases Phase 3 外提）。
 */
import { cleanText } from '../growth-phase-auth.js';

function parseOccurredAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export async function upsertCampaignPlan(pool, tenantId, body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const tid = String(tenantId || 'default');
  const r = await pool.query(
    `INSERT INTO growth_campaign_plans(plan_id,store_id,campaign_id,title,channel,voucher_template_id,target_audience,coupon_value_fen,budget_fen,status,planned_start,planned_end,created_by,source_template_id,recommended_poster_id,tenant_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT(plan_id, tenant_id) DO UPDATE SET title=EXCLUDED.title,status=EXCLUDED.status,channel=EXCLUDED.channel,target_audience=EXCLUDED.target_audience,coupon_value_fen=EXCLUDED.coupon_value_fen,budget_fen=EXCLUDED.budget_fen,source_template_id=EXCLUDED.source_template_id,recommended_poster_id=EXCLUDED.recommended_poster_id,updated_at=NOW() RETURNING *`,
    [
      cleanText(b.plan_id, 128),
      cleanText(b.store_id, 128),
      cleanText(b.campaign_id, 128),
      cleanText(b.title, 500),
      cleanText(b.channel, 80),
      cleanText(b.voucher_template_id, 128),
      cleanText(b.target_audience || 'all', 200),
      Math.max(0, Math.floor(Number(b.coupon_value_fen) || 0)),
      Math.max(0, Math.floor(Number(b.budget_fen) || 0)),
      cleanText(b.status || 'draft', 40),
      b.planned_start ? parseOccurredAt(b.planned_start) : null,
      b.planned_end ? parseOccurredAt(b.planned_end) : null,
      cleanText(b.created_by || 'admin', 80),
      b.source_template_id ? Number(b.source_template_id) : null,
      b.recommended_poster_id ? Number(b.recommended_poster_id) : null,
      tid,
    ]
  );
  if (b.source_template_id) {
    pool.query('UPDATE marketing_templates SET use_count = use_count + 1 WHERE id = $1', [Number(b.source_template_id)]).catch(() => {});
  }
  return r.rows[0] || null;
}

export async function listCampaignPlans(pool, { storeId = '', status = '' } = {}) {
  const sid = cleanText(storeId, 128);
  const st = cleanText(status, 40);
  const r = await pool.query(
    `SELECT * FROM growth_campaign_plans WHERE ($1='' OR store_id=$1) AND ($2='' OR status=$2) ORDER BY created_at DESC LIMIT 200`,
    [sid, st]
  );
  return r.rows || [];
}

export async function listMarketingTemplates(pool) {
  const r = await pool.query(
    'SELECT id, name, category, description, actions, expected_roi, budget_range, duration_days, success_rate, use_count, channel, target_audience, payload_template FROM marketing_templates ORDER BY success_rate DESC NULLS LAST, use_count DESC'
  );
  return r.rows || [];
}

export async function createMarketingTemplate(pool, tenantId, body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const r = await pool.query(
    `INSERT INTO marketing_templates(name,category,description,actions,expected_roi,budget_range,duration_days,success_rate,channel,target_audience,payload_template,tenant_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      cleanText(b.name, 200),
      cleanText(b.category, 80),
      cleanText(b.description, 1000),
      JSON.stringify(b.actions || []),
      Number(b.expected_roi) || 0,
      cleanText(b.budget_range, 100),
      Math.max(1, Math.floor(Number(b.duration_days) || 7)),
      Number(b.success_rate) || 0,
      cleanText(b.channel, 80),
      cleanText(b.target_audience || 'all', 200),
      JSON.stringify(b.payload_template || {}),
      String(tenantId || 'default'),
    ]
  );
  return r.rows[0] || null;
}

export async function deleteMarketingTemplate(pool, id) {
  await pool.query('DELETE FROM marketing_templates WHERE id = $1', [Number(id)]);
}

export async function listStoreRankings(pool, daysRaw) {
  const days = Math.min(Math.max(Number(daysRaw) || 7, 1), 90);
  const r = await pool.query(
    `SELECT dm.store_id,SUM(dm.scan_count)::int scan_count,SUM(dm.authorized_count)::int auth_count,
              SUM(dm.coupon_issued_count)::int issued_count,SUM(dm.coupon_redeemed_count)::int redeemed_count,
              SUM(dm.payment_count)::int payment_count,SUM(dm.revenue_fen)::int revenue_fen,
              COUNT(DISTINCT dm.campaign_id)::int active_campaigns
       FROM growth_daily_metrics dm WHERE dm.metric_date>=CURRENT_DATE-($1::int||' days')::interval
       GROUP BY dm.store_id ORDER BY revenue_fen DESC,scan_count DESC LIMIT 200`,
    [days]
  );
  return (r.rows || []).map((row, i) => ({ rank: i + 1, ...row }));
}

/**
 * 激活 campaign plan：更新状态，必要时创建 growth_actions 并执行。
 * @param {{ executeGrowthActionRecord: Function }} deps
 */
export async function patchCampaignPlanStatus(pool, tenantId, { id, status, authUser }, deps) {
  const planId = cleanText(id, 128);
  const st = cleanText(status, 40);
  if (!['draft', 'active', 'completed', 'cancelled'].includes(st)) {
    const err = new Error('invalid_status');
    err.code = 'invalid_status';
    throw err;
  }
  const before = await pool.query(`SELECT * FROM growth_campaign_plans WHERE (plan_id=$1 OR campaign_id=$1) LIMIT 1`, [planId]);
  if (!before.rows.length) {
    const err = new Error('not_found');
    err.code = 'not_found';
    throw err;
  }
  const r = await pool.query(
    `UPDATE growth_campaign_plans SET status=$1, updated_at=NOW() WHERE (plan_id=$2 OR campaign_id=$2) RETURNING *`,
    [st, planId]
  );
  const plan = r.rows[0];
  let execution = null;
  if (st === 'active' && before.rows[0].status !== 'active') {
    const previous = before.rows[0];
    const actionKey = `manual_activate_${cleanText(plan.plan_id || plan.campaign_id || planId, 120)}_${Date.now()}`;
    const plannedStart = previous.planned_start ? new Date(previous.planned_start) : null;
    const plannedEnd = previous.planned_end ? new Date(previous.planned_end) : null;
    const validDays =
      plannedStart && plannedEnd ? Math.max(1, Math.ceil((plannedEnd.getTime() - plannedStart.getTime()) / 86400000)) : 7;
    const payload = {
      store_id: previous.store_id || '',
      plan_id: previous.plan_id || '',
      campaign_id: previous.campaign_id || '',
      channel: previous.channel || 'miniprogram',
      target_audience: previous.target_audience || 'all',
      budget_fen: Number(previous.budget_fen || 0),
      coupon_value_fen: Number(previous.coupon_value_fen || previous.voucher_template_id || 0),
      valid_days: validDays,
      source_template_id: previous.source_template_id || null,
      recommended_poster_id: previous.recommended_poster_id || null,
      execution_action: '手动激活活动计划',
    };
    await pool.query(
      `INSERT INTO growth_actions (action_key, action_type, status, store_id, campaign_id, title, detail, payload, created_by, tenant_id)
       VALUES ($1,'campaign_activate','proposed',$2,$3,$4,$5,$6::jsonb,$7,$8)`,
      [
        actionKey,
        previous.store_id || '',
        previous.campaign_id || '',
        previous.title || '手动激活活动',
        `活动 ${previous.title || previous.campaign_id || previous.plan_id || planId} 已手动激活`,
        JSON.stringify(payload),
        authUser?.username || previous.created_by || 'admin',
        tenantId,
      ]
    );
    const actionRow = {
      action_key: actionKey,
      action_type: 'campaign_activate',
      store_id: previous.store_id || '',
      campaign_id: previous.campaign_id || '',
      title: previous.title || '手动激活活动',
      detail: `活动 ${previous.title || previous.campaign_id || previous.plan_id || planId} 已手动激活`,
      payload,
    };
    execution = await deps.executeGrowthActionRecord(
      pool,
      actionRow,
      {
        username: authUser?.username || previous.created_by || 'admin',
        role: authUser?.role || 'admin',
      },
      {},
      '手动激活活动'
    );
  }
  return { plan, execution };
}
