import { randomUUID } from 'node:crypto';
import { matchTouchToOrders } from '../marketing/marketing-attribution-service.js';

export async function generateGrowthAttribution(pool, options = {}) {
  const tenantId = options.tenantId || 'default';
  const storeId = options.storeId || '';
  const campaignId = options.campaignId || '';
  const opportunityId = options.opportunityId || '';
  const taskId = options.taskId || '';
  const windowDays = Math.max(1, Number(options.attributionWindowDays || 7));
  const touches = await pool.query(
    `SELECT touch_id AS "touchId", campaign_id AS "campaignId", customer_id AS "customerId",
            sent_at AS "touchTime", coupon_id AS "couponId", channel
       FROM growth_ontology_touches
      WHERE tenant_id=$1 AND store_id=$2 AND ($3::text='' OR campaign_id=$3) AND status='sent'`,
    [tenantId, storeId, campaignId]
  );
  const orders = await pool.query(
    `SELECT order_id AS "orderId", customer_id AS "customerId", order_time AS "orderTime",
            actual_paid AS "orderAmount", coupon_id AS "couponId", campaign_id AS "directCampaignId"
       FROM growth_ontology_orders
      WHERE tenant_id=$1 AND store_id=$2 AND order_time >= now() - interval '90 days'`,
    [tenantId, storeId]
  );
  const matched = matchTouchToOrders(touches.rows, orders.rows, { attributionWindowDays: windowDays });
  const saved = [];
  for (const m of matched) {
    const id = `attr_${randomUUID()}`;
    const r = await pool.query(
      `INSERT INTO growth_ontology_attributions (
        attribution_id, tenant_id, store_id, campaign_id, task_id, opportunity_id, customer_id,
        related_order_id, baseline_value, actual_value, uplift_value, cost_value, net_value,
        attribution_method, confidence_score, attribution_window_start, attribution_window_end, evidence_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$9,0,$9,$10,$11,$12,$13,$14::jsonb)
      RETURNING *`,
      [
        id, tenantId, storeId, m.campaignId || campaignId, taskId, opportunityId, m.customerId,
        m.relatedOrderId, m.orderAmount, m.attributionType, m.attributionType === 'coupon' ? 0.9 : 0.65,
        m.touchTime, m.conversionTime, JSON.stringify(m),
      ]
    );
    saved.push(r.rows[0]);
  }
  console.log('Attribution generated');
  return {
    ontologyStatus: touches.rows.length ? 'ok' : 'insufficient_data',
    attributedOrderCount: saved.length,
    attributedRevenue: saved.reduce((sum, row) => sum + Number(row.actual_value || 0), 0),
    evidenceDetails: saved.map(row => ({
      customerId: row.customer_id,
      campaignId: row.campaign_id,
      touchTime: row.evidence_json?.touchTime,
      channel: row.evidence_json?.channel || '',
      couponId: row.evidence_json?.couponId || '',
      relatedOrderId: row.related_order_id,
      orderTime: row.evidence_json?.conversionTime,
      orderAmount: Number(row.actual_value || 0),
      attributionType: row.attribution_method,
      attributionWindowDays: windowDays,
    })),
  };
}
