/**
 * Action-type DB side effects (voucher/campaign/content/poster).
 * Extracted from growth-api.js executeGrowthActionRecord — P5.4.
 */
export async function applyGrowthActionTypeEffects(ctx) {
  const {
    pool, before, payload, storeId, campaignId, actionType, tenantId, operator, executionResults,
    cleanText,
  } = ctx;

  if (actionType === 'send_voucher' || actionType === 'campaign_activate') {
    const title = cleanText(before.title, 500);
    const planId = cleanText(payload.plan_id, 128) || `exec_plan_${Date.now()}`;
    const channel = cleanText(payload.channel || 'miniprogram', 80);
    const sourceTemplateId = payload.source_template_id ? Number(payload.source_template_id) : null;
    const recommendedPosterId = payload.recommended_poster_id ? Number(payload.recommended_poster_id) : null;
    const planResult = await pool.query(
      `INSERT INTO growth_campaign_plans (plan_id, store_id, campaign_id, title, channel, status, planned_start, planned_end, created_by, source_template_id, recommended_poster_id, tenant_id)
       VALUES ($1,$2,$3,$4,$5,'active',NOW(),NOW() + ($6::int || ' days')::interval,$7,$8,$9,$10)
       ON CONFLICT (plan_id, tenant_id) DO UPDATE SET status='active', updated_at=NOW()
       RETURNING plan_id, status`,
      [planId, storeId, campaignId || `camp_${Date.now()}`, title, channel, Math.max(1, Math.floor(Number(payload.valid_days) || 7)), operator.username, sourceTemplateId, recommendedPosterId, tenantId]
    );
    executionResults.real_executions.push({ type: 'campaign_plan', plan_id: planResult.rows[0]?.plan_id, status: 'active' });
    if (sourceTemplateId) {
      pool.query('UPDATE marketing_templates SET use_count = use_count + 1 WHERE id = $1 AND tenant_id = $2', [sourceTemplateId, tenantId]).catch(() => {});
    }
    if (campaignId) {
      await pool.query(
        `INSERT INTO growth_campaigns (campaign_id, name, channel, store_id, status, tenant_id)
         VALUES ($1,$2,$3,$4,'active',$5)
         ON CONFLICT (campaign_id, tenant_id) DO UPDATE SET status='active', updated_at=NOW()`,
        [campaignId, title, channel, storeId, tenantId]
      );
      executionResults.real_executions.push({ type: 'campaign', campaign_id: campaignId, status: 'active' });
    }
    const couponId = payload.coupon_id ? cleanText(payload.coupon_id, 128) : `exec_coupon_${Date.now()}`;
    await pool.query(
      `INSERT INTO growth_coupons (coupon_id, name, type, value_fen, valid_days, usage_rule, store_id, is_active, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,$8)
       ON CONFLICT (coupon_id, tenant_id) DO UPDATE SET name=EXCLUDED.name, value_fen=EXCLUDED.value_fen, valid_days=EXCLUDED.valid_days, usage_rule=EXCLUDED.usage_rule, is_active=TRUE, updated_at=NOW()`,
      [
        couponId,
        cleanText(payload.coupon_name || before.title, 300),
        cleanText(payload.coupon_type || 'cash', 40),
        Math.max(0, Math.floor(Number(payload.coupon_value_fen || payload.value_fen) || 1000)),
        Math.max(1, Math.floor(Number(payload.valid_days) || 7)),
        cleanText(payload.usage_rule || '规则引擎自动触达', 1000),
        storeId,
        tenantId
      ]
    );
    payload.coupon_id = couponId;
    executionResults.real_executions.push({ type: 'coupon', coupon_id: couponId });
  } else if (actionType === 'create_content' || actionType === 'promo_task') {
    const itemId = `exec_content_${Date.now()}`;
    const channel = cleanText(payload.channel || 'miniprogram', 80);
    const contentResult = await pool.query(
      `INSERT INTO growth_content_calendar (item_id, store_id, channel, publish_date, title, content_brief, copy_text, status, tenant_id)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$6,'planned',$7)
       RETURNING item_id`,
      [itemId, storeId, channel, cleanText(before.title, 500), cleanText(payload.content_brief || payload.detail, 2000), cleanText(before.detail, 4000), tenantId]
    );
    executionResults.real_executions.push({ type: 'content_calendar', item_id: contentResult.rows[0]?.item_id });
  } else if (actionType === 'generate_poster') {
    const posterKey = `exec_poster_${Date.now()}`;
    const posterResult = await pool.query(
      `INSERT INTO generated_posters (poster_key, campaign_id, store_id, title, status, tenant_id)
       VALUES ($1,$2,$3,$4,'generated',$5)
       RETURNING poster_key`,
      [posterKey, campaignId, storeId, cleanText(before.title, 500), tenantId]
    );
    executionResults.real_executions.push({ type: 'poster', poster_key: posterResult.rows[0]?.poster_key });
  } else {
    executionResults.real_executions.push({ type: 'marked_executed', note: '直接执行触达动作' });
  }
}
