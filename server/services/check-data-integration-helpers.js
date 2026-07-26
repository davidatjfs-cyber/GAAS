/**
 * P4 peel: checkDataIntegration query + issue builders.
 */
import { SHARED_TABLES } from '@gaas/shared';

export async function fetchDataIntegrationSnapshot(pool, ctx, stores, deps) {
  const {
    previousDate,
    storeFilterValues,
    storeFilterPatterns,
  } = deps;
  const { queryIfTable } = deps;

  const yesterday = previousDate(ctx.date);
  const storeValues = storeFilterValues(ctx, stores);
  const storePatterns = storeFilterPatterns(storeValues);

  const posR = await queryIfTable(
    pool,
    SHARED_TABLES.POS_ORDER_ITEMS,
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE poi.biz_date=$3::date)::int AS yesterday_total,
            MAX(poi.biz_date)::text AS latest_date,
            COUNT(*)::int AS phone_rows,
            COUNT(*) FILTER (WHERE COALESCE(po.phone,'') <> '')::int AS rows_with_phone,
            COUNT(DISTINCT poi.dish_name)::int AS dish_rows,
            COUNT(DISTINCT poi.dish_name) FILTER (WHERE COALESCE(poi.category,'') <> '')::int AS categorized_dish_rows
       FROM ${SHARED_TABLES.POS_ORDER_ITEMS} poi
       LEFT JOIN pos_orders po ON po.order_no = poi.order_no AND po.tenant_id = poi.tenant_id
      WHERE poi.tenant_id=$1 AND ($2::text[] IS NULL OR poi.store_code = ANY($2::text[]) OR poi.store_name = ANY($2::text[]) OR poi.store_name ILIKE ANY($4::text[]))`,
    [ctx.tenantId, storeValues.length ? storeValues : null, yesterday, storePatterns.length ? storePatterns : null]
  );

  const customerR = await queryIfTable(
    pool,
    'growth_customer_profiles',
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE updated_at >= ($2::date - INTERVAL '7 days'))::int AS updated_7d,
            COUNT(*) FILTER (WHERE COALESCE(lifecycle_stage,'') <> '' OR COALESCE(value_tier,'') <> '')::int AS segmented,
            COUNT(*) FILTER (WHERE COALESCE(phone,'') <> '')::int AS phone_matched,
            COUNT(*)::int AS phone_total
       FROM growth_customer_profiles
      WHERE tenant_id=$1`,
    [ctx.tenantId, ctx.date]
  );

  const customerOpsR = await queryIfTable(
    pool,
    'customer_ops_source_records',
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE created_at >= ($2::date - INTERVAL '7 days'))::int AS updated_7d
       FROM customer_ops_source_records WHERE tenant_id=$1`,
    [ctx.tenantId, ctx.date]
  );

  const attributabilityR = await queryIfTable(
    pool,
    'pos_orders',
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(phone,'') <> '')::int AS with_phone,
            COUNT(*) FILTER (WHERE customer_id IS NOT NULL)::int AS with_customer_id,
            COUNT(*) FILTER (WHERE COALESCE(coupon_id,'') <> '')::int AS with_coupon_id
       FROM pos_orders
      WHERE tenant_id=$1 AND ($2::text[] IS NULL OR store_id = ANY($2::text[]) OR store_name = ANY($2::text[]) OR store_name ILIKE ANY($3::text[]))`,
    [ctx.tenantId, storeValues.length ? storeValues : null, storePatterns.length ? storePatterns : null]
  );

  const briefingR = await queryIfTable(
    pool,
    'agent_v2_morning_briefing_sends',
    `SELECT COUNT(*) FILTER (WHERE ok=true AND run_ymd=$2)::int AS today_ok,
            COUNT(*) FILTER (WHERE ok=true AND run_ymd=$3)::int AS yesterday_ok,
            MAX(updated_at)::text AS latest_sent_at
       FROM agent_v2_morning_briefing_sends
      WHERE tenant_id=$1 AND ($4::text[] IS NULL OR scope = ANY($4::text[]) OR scope ILIKE ANY($5::text[]) OR scope = '__all_stores__')`,
    [ctx.tenantId, ctx.date, yesterday, storeValues.length ? storeValues : null, storePatterns.length ? storePatterns : null]
  );

  return {
    yesterday,
    storeValues,
    storePatterns,
    posR,
    customerR,
    customerOpsR,
    attributabilityR,
    briefingR,
  };
}

export function buildDataIntegrationIssues(snapshot, deps) {
  const { issue, STATUS, n, pct } = deps;
  const {
    yesterday,
    posR,
    customerR,
    customerOpsR,
    attributabilityR,
    briefingR,
  } = snapshot;

  const pos = posR.rows?.[0] || {};
  const posTotal = n(pos.total);
  const yesterdayTotal = n(pos.yesterday_total);
  const phoneRate = pct(pos.rows_with_phone, pos.phone_rows);
  const dishRate = pct(pos.categorized_dish_rows, pos.dish_rows);

  const customers = customerR.rows?.[0] || {};
  const customerTotal = Math.max(n(customers.total), n(customerOpsR.rows?.[0]?.total));

  const attributability = attributabilityR.rows?.[0] || {};
  const attributabilityTotal = n(attributability.total);
  const phoneCompleteRate = pct(attributability.with_phone, attributabilityTotal);
  const customerIdCompleteRate = pct(attributability.with_customer_id, attributabilityTotal);
  const couponIdCompleteRate = pct(attributability.with_coupon_id, attributabilityTotal);

  const briefing = briefingR.rows?.[0] || {};
  const sentRecently = n(briefing.today_ok) > 0 || n(briefing.yesterday_ok) > 0;

  return [
    issue({
      category: '数据接入',
      item_key: 'order_phone_complete_rate',
      item_name: '手机号完整率',
      status: !attributabilityR.exists ? STATUS.pending : attributabilityTotal === 0 ? STATUS.pending : phoneCompleteRate >= 60 ? STATUS.ok : STATUS.abnormal,
      severity: phoneCompleteRate >= 60 ? 'P3' : 'P2',
      owner_role: '实施人员',
      impact_modules: ['自动营销', '客户资产报告'],
      impact_description: attributabilityTotal === 0 ? '暂无订单数据，无法计算手机号完整率。' : `订单中带手机号的比例为 ${phoneCompleteRate}%，决定了短信自动触达能覆盖多少客户。`,
      suggestion: '请确认 POS 导出/导入是否包含手机号字段，或门店是否有会员手机号采集流程。',
      evidence: { ...(attributabilityR.evidence || {}), rate: phoneCompleteRate, with_phone: n(attributability.with_phone), total: attributabilityTotal, structural_watch: true },
    }),
    issue({
      category: '数据接入',
      item_key: 'order_customer_id_complete_rate',
      item_name: '客户身份识别率',
      status: !attributabilityR.exists ? STATUS.pending : attributabilityTotal === 0 ? STATUS.pending : customerIdCompleteRate >= 60 ? STATUS.ok : STATUS.abnormal,
      severity: customerIdCompleteRate >= 60 ? 'P3' : 'P2',
      owner_role: '系统',
      impact_modules: ['客户资产报告', '营销归因'],
      impact_description: attributabilityTotal === 0 ? '暂无订单数据，暂时无法计算客户身份识别率。' : `订单中能识别出同一位客户身份的比例为 ${customerIdCompleteRate}%，这个比例由手机号完整率决定，不是独立指标。`,
      suggestion: '这是系统按手机号自动匹配出来的结果，不需要单独整改；手机号完整率提升后这项会同步提升。',
      evidence: { ...(attributabilityR.evidence || {}), rate: customerIdCompleteRate, with_customer_id: n(attributability.with_customer_id), total: attributabilityTotal },
    }),
    issue({
      category: '数据接入',
      item_key: 'order_coupon_id_complete_rate',
      item_name: '优惠券核销关联率',
      status: !attributabilityR.exists ? STATUS.pending : attributabilityTotal === 0 ? STATUS.pending : STATUS.ok,
      severity: 'P3',
      owner_role: '实施人员',
      impact_modules: ['营销归因'],
      impact_description: attributabilityTotal === 0 ? '暂无订单数据，暂时无法计算优惠券核销关联率。' : `订单中能关联到优惠券核销记录的比例为 ${couponIdCompleteRate}%，这个比例天然不会接近 100%——多数订单本身不使用优惠券，不代表数据缺失。`,
      suggestion: '如果实际发放过优惠券但这里比例明显偏低，请检查优惠券核销结果是否有回写到订单记录里。',
      evidence: { ...(attributabilityR.evidence || {}), rate: couponIdCompleteRate, with_coupon_id: n(attributability.with_coupon_id), total: attributabilityTotal },
    }),
    issue({
      category: '数据接入',
      item_key: 'pos_data_connected',
      item_name: 'POS 数据是否接入',
      status: !posR.exists ? STATUS.pending : posTotal > 0 ? STATUS.ok : STATUS.missing,
      severity: !posR.exists ? 'P0' : posTotal > 0 ? 'P3' : 'P0',
      owner_role: '实施人员',
      impact_modules: ['经营诊断', '老板晨报', '营销归因'],
      impact_description: posTotal > 0 ? 'POS 数据已接入，经营诊断可读取订单明细。' : 'POS 数据未接入会导致经营诊断、老板晨报和客户回店归因无法运转。',
      suggestion: '请检查 POS 接口、pos_order_items 同步任务和租户门店映射。',
      evidence: { ...(posR.evidence || {}), table_exists: posR.exists, total: posTotal },
    }),
    issue({
      category: '数据新鲜度',
      item_key: 'yesterday_orders_synced',
      item_name: '昨日订单数据是否同步',
      status: !posR.exists ? STATUS.pending : yesterdayTotal > 0 ? STATUS.ok : STATUS.delayed,
      severity: !posR.exists ? 'P1' : yesterdayTotal > 0 ? 'P3' : 'P1',
      owner_role: '实施人员',
      impact_modules: ['经营诊断', '老板晨报', '营销归因'],
      impact_description: yesterdayTotal > 0 ? '昨日订单已同步，可生成昨日经营判断。' : '昨日 POS 数据未同步，会导致经营诊断无法判断昨日营业额变化，也会影响客户回店订单归因。',
      suggestion: '请实施人员检查 POS 同步状态，确认同步任务按日执行，或由门店补传昨日订单数据。',
      evidence: { ...(posR.evidence || {}), yesterday, yesterday_order_count: yesterdayTotal, latest_sync_time: pos.latest_date || null, seven_day_avg_order_count: Math.round(posTotal / 7) },
    }),
    issue({
      category: '数据接入',
      item_key: 'customer_phone_match_rate',
      item_name: 'POS 订单客户识别率是否足够',
      status: !posR.exists ? STATUS.pending : phoneRate >= 60 ? STATUS.ok : STATUS.abnormal,
      severity: phoneRate >= 60 ? 'P3' : 'P2',
      owner_role: '实施人员',
      impact_modules: ['客户资产报告', '自动营销', '营销归因'],
      impact_description: phoneRate >= 60 ? 'POS 订单里的手机号、会员 ID 或顾客标识可支持基础客户识别。' : `当前 ${phoneRate}% 的订单能识别出客户身份，其余是未留手机号的散客或未开卡消费。这个比例主要由 POS 系统本身是否采集手机号、以及门店收银时是否引导顾客留手机号决定，不是系统数据丢失或运营失误。`,
      suggestion: '这项通常无法靠系统内操作提升。如果希望提高比例，需要门店在收银环节主动引导顾客留手机号/办会员；如果怀疑 POS 本身有采集但没有导出手机号字段，可以请我方核对导入映射。',
      evidence: { ...(posR.evidence || {}), phone_match_rate: phoneRate, rows_with_phone: n(pos.rows_with_phone), phone_rows: n(pos.phone_rows), structural_watch: true },
    }),
    issue({
      category: '数据接入',
      item_key: 'dish_data_complete',
      item_name: '菜品数据是否完整',
      status: !posR.exists ? STATUS.pending : dishRate >= 60 ? STATUS.ok : STATUS.abnormal,
      severity: dishRate >= 60 ? 'P3' : 'P3',
      owner_role: '实施人员',
      impact_modules: ['经营诊断', '月度复盘'],
      impact_description: dishRate >= 60 ? '菜品分类可支持基础菜品分析。' : '菜品分类不完整会影响菜品结构、毛利和复盘分析。',
      suggestion: '请补齐菜品分类、别名和门店菜品映射。',
      evidence: { ...(posR.evidence || {}), dish_rate: dishRate, dish_rows: n(pos.dish_rows), categorized_dish_rows: n(pos.categorized_dish_rows) },
    }),
    issue({
      category: '数据新鲜度',
      item_key: 'customer_data_updated',
      item_name: '会员 / 客户数据是否更新',
      status: customerR.exists || customerOpsR.exists ? (customerTotal > 0 ? STATUS.ok : STATUS.missing) : STATUS.pending,
      severity: customerTotal > 0 ? 'P3' : 'P0',
      owner_role: '实施人员',
      impact_modules: ['客户资产报告', '自动营销'],
      impact_description: customerTotal > 0 ? '客户数据已接入，可支持客户资产分析。' : '客户数据为空时，客户资产报告和自动营销无法运转。',
      suggestion: '请导入会员、客户或客户运营原始记录，并保持定期更新。',
      evidence: { ...(customerR.evidence || customerOpsR.evidence || {}), growth_customer_profiles_exists: customerR.exists, customer_ops_exists: customerOpsR.exists, customer_count: customerTotal, customer_updated_7d: n(customers.updated_7d) || n(customerOpsR.rows?.[0]?.updated_7d) },
    }),
    issue({
      category: '数据新鲜度',
      item_key: 'morning_briefing_delivered',
      item_name: '老板晨报是否按时送达',
      status: !briefingR.exists ? STATUS.pending : sentRecently ? STATUS.ok : STATUS.delayed,
      severity: !briefingR.exists ? 'P2' : sentRecently ? 'P3' : 'P1',
      owner_role: '系统',
      impact_modules: ['老板晨报'],
      impact_description: sentRecently
        ? `老板晨报最近一次成功送达时间：${briefing.latest_sent_at ? String(briefing.latest_sent_at).slice(0, 19) : '-'}。`
        : '最近两天（含今天）没有查到老板晨报的成功送达记录，飞书07:30定时推送可能没有正常执行。',
      suggestion: '请检查 agents-service-v2 的每日07:30晨报定时任务是否正常运行，以及收件人飞书账号绑定是否有效。',
      evidence: { ...(briefingR.evidence || {}), today_ok: n(briefing.today_ok), yesterday_ok: n(briefing.yesterday_ok), latest_sent_at: briefing.latest_sent_at || null },
    }),
  ];
}

export async function runCheckDataIntegration(pool, ctx, stores, deps) {
  const snapshot = await fetchDataIntegrationSnapshot(pool, ctx, stores, deps);
  return buildDataIntegrationIssues(snapshot, deps);
}
