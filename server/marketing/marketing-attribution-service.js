function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function id(v) {
  return String(v || '').trim();
}

function toTime(v) {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

function rateChange(current, previous) {
  if (!Number.isFinite(Number(current)) || !Number.isFinite(Number(previous)) || Number(previous) === 0) return null;
  return Number((((Number(current) - Number(previous)) / Math.abs(Number(previous))) * 100).toFixed(2));
}

export function matchTouchToOrders(touchRecords = [], orderRecords = [], options = {}) {
  const windowDays = Math.max(1, Number(options.attributionWindowDays || 7));
  const windowMs = windowDays * 86400000;
  const matches = [];
  const usedOrders = new Set();
  const touches = (touchRecords || []).filter(t => id(t.customerId)).sort((a, b) => toTime(b.touchTime) - toTime(a.touchTime));

  for (const order of orderRecords || []) {
    const orderCustomerId = id(order.customerId);
    const orderId = id(order.orderId || order.relatedOrderId || order.order_no);
    const orderTime = toTime(order.orderTime || order.conversionTime || order.bizDate || order.biz_date);
    if (!orderCustomerId || !orderId || orderTime === null || usedOrders.has(orderId)) continue;
    const candidates = touches.filter(t => {
      const touchTime = toTime(t.touchTime || t.touchedAt || t.created_at);
      return id(t.customerId) === orderCustomerId && touchTime !== null && orderTime >= touchTime && orderTime - touchTime <= windowMs;
    });
    if (!candidates.length) continue;
    candidates.sort((a, b) => {
      const aCoupon = id(a.couponId) && id(a.couponId) === id(order.couponId);
      const bCoupon = id(b.couponId) && id(b.couponId) === id(order.couponId);
      if (aCoupon !== bCoupon) return aCoupon ? -1 : 1;
      return toTime(b.touchTime || b.touchedAt || b.created_at) - toTime(a.touchTime || a.touchedAt || a.created_at);
    });
    const touch = candidates[0];
    const couponUsed = !!(id(touch.couponId) && id(touch.couponId) === id(order.couponId));
    matches.push({
      conversionId: `conv:${id(touch.campaignId)}:${orderId}`,
      campaignId: id(touch.campaignId),
      customerId: orderCustomerId,
      customerName: order.customerName || touch.customerName || '',
      touchId: id(touch.touchId),
      touchTime: touch.touchTime || touch.touchedAt || touch.created_at,
      channel: touch.channel || order.channel || '',
      couponId: id(touch.couponId) || id(order.couponId),
      conversionType: couponUsed ? 'coupon_used' : 'placed_order',
      conversionTime: order.orderTime || order.conversionTime || order.bizDate || order.biz_date,
      relatedOrderId: orderId,
      orderAmount: n(order.orderAmount ?? order.amount ?? order.revenue),
      couponUsed,
      attributionWindowDays: windowDays,
      attributionType: couponUsed ? 'coupon' : (order.directCampaignId && id(order.directCampaignId) === id(touch.campaignId) ? 'direct' : 'assisted'),
      estimated: false,
    });
    usedOrders.add(orderId);
  }
  return matches;
}

export function calculateCampaignAttributionFromRecords(campaignId, touchRecords = [], orderRecords = [], options = {}) {
  const campaignTouches = (touchRecords || []).filter(t => id(t.campaignId) === id(campaignId));
  const validTouchedCustomers = new Set(campaignTouches.map(t => id(t.customerId)).filter(Boolean));
  const evidenceOrders = matchTouchToOrders(campaignTouches, orderRecords, options);
  const returnedCustomers = new Set(evidenceOrders.map(x => x.customerId));
  const attributedRevenue = evidenceOrders.reduce((sum, x) => sum + n(x.orderAmount), 0);
  const attributedOrderCount = evidenceOrders.length;
  const evidenceDetails = evidenceOrders.map(x => ({
    customerId: x.customerId,
    customerName: x.customerName || '',
    campaignId: x.campaignId,
    touchTime: x.touchTime,
    channel: x.channel || '',
    couponId: x.couponId || '',
    relatedOrderId: x.relatedOrderId,
    orderTime: x.conversionTime,
    orderAmount: x.orderAmount,
    attributionType: x.attributionType,
    couponUsed: x.couponUsed,
    attributionWindowDays: x.attributionWindowDays,
  }));
  return {
    campaignId: id(campaignId),
    touchedCustomerCount: validTouchedCustomers.size,
    returnedCustomerCount: returnedCustomers.size,
    conversionRate: validTouchedCustomers.size ? returnedCustomers.size / validTouchedCustomers.size : 0,
    couponUsedCount: evidenceOrders.filter(x => x.couponUsed).length,
    attributedOrderCount,
    attributedRevenue,
    avgOrderAmount: attributedOrderCount ? attributedRevenue / attributedOrderCount : 0,
    roiEstimate: null,
    repeatPurchaseLift: null,
    attributionWindowDays: Math.max(1, Number(options.attributionWindowDays || 7)),
    evidenceOrders,
    evidenceDetails,
    ontologyStatus: validTouchedCustomers.size ? 'ok' : 'insufficient_data',
  };
}

export async function calculateCampaignAttribution(pool, campaignId, options = {}) {
  const windowDays = Math.max(1, Number(options.attributionWindowDays || 7));
  const tenantId = options.tenantId || 'default';
  const touchRows = await pool.query(
    `SELECT id::text AS "touchId", COALESCE(campaign_id::text, $1::text) AS "campaignId",
            COALESCE(NULLIF(customer_id::text, ''), NULLIF(regexp_replace(COALESCE(phone, payload->>'phone', ''),'[^0-9]','','g'), ''), NULLIF(payload->>'customerId', '')) AS "customerId",
            created_at AS "touchTime", coupon_id::text AS "couponId", channel
       FROM growth_delivery_logs
      WHERE tenant_id = $2 AND (campaign_id::text = $1::text OR rule_key = $1::text OR $1::text = '')
        AND status = 'sent'
      LIMIT 5000`,
    [String(campaignId || ''), tenantId]
  ).catch(() => ({ rows: [] }));
  const orderRows = await pool.query(
    `SELECT order_no AS "orderId", COALESCE(NULLIF(customer_id::text,''), regexp_replace(COALESCE(phone,''),'[^0-9]','','g')) AS "customerId",
            biz_date AS "orderTime", amount_after_discount AS "orderAmount", coupon_id::text AS "couponId"
       FROM pos_orders
      WHERE biz_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
      LIMIT 20000`,
    [Math.max(windowDays + 60, 90)]
  ).catch(() => ({ rows: [] }));
  return calculateCampaignAttributionFromRecords(campaignId, touchRows.rows, orderRows.rows, { attributionWindowDays: windowDays });
}

function addMetric(out, key, current, previous, asPercent = false) {
  if (previous === undefined || previous === null || current === undefined || current === null) return;
  const c = asPercent ? Number((n(current) * 100).toFixed(2)) : n(current);
  const p = asPercent ? Number((n(previous) * 100).toFixed(2)) : n(previous);
  out[key] = { current: c, previous: p, changeRate: rateChange(c, p) };
}

export function buildMarketingAttributionMetricsInput(attributionSummary = {}) {
  const out = {};
  addMetric(out, 'campaign_conversion_rate', attributionSummary.conversionRate, attributionSummary.previousConversionRate, true);
  addMetric(out, 'attributed_revenue', attributionSummary.attributedRevenue, attributionSummary.previousAttributedRevenue);
  addMetric(out, 'returned_customer_count', attributionSummary.returnedCustomerCount, attributionSummary.previousReturnedCustomerCount);
  addMetric(out, 'coupon_used_count', attributionSummary.couponUsedCount, attributionSummary.previousCouponUsedCount);
  addMetric(out, 'repeat_purchase_lift', attributionSummary.repeatPurchaseLift, attributionSummary.previousRepeatPurchaseLift, true);
  if (!Object.keys(out).length) out.ontologyStatus = 'insufficient_data';
  return out;
}
