import { randomUUID } from 'node:crypto';

export async function trackGrowthResults(pool, options = {}) {
  const tenantId = options.tenantId || 'default';
  const storeId = options.storeId || '';
  const opportunityId = options.opportunityId || '';
  const beforeDays = Math.max(1, Number(options.beforeDays || 7));
  const afterDays = Math.max(1, Number(options.afterDays || 7));
  const r = await pool.query(
    `SELECT
       COALESCE(sum(actual_paid) FILTER (WHERE order_time >= now() - ($1::int + $2::int) * interval '1 day'
                                      AND order_time < now() - ($2::int * interval '1 day')),0)::numeric AS before_revenue,
       COALESCE(sum(actual_paid) FILTER (WHERE order_time >= now() - ($2::int * interval '1 day')),0)::numeric AS after_revenue
     FROM growth_ontology_orders
     WHERE tenant_id=$3 AND store_id=$4`,
    [beforeDays, afterDays, tenantId, storeId]
  );
  const before = Number(r.rows[0]?.before_revenue || 0);
  const after = Number(r.rows[0]?.after_revenue || 0);
  const id = `result_${randomUUID()}`;
  const saved = await pool.query(
    `INSERT INTO growth_ontology_business_results (
      result_id, tenant_id, store_id, result_type, entity_type, entity_id, metric_name,
      before_value, after_value, delta_value, result_period_start, result_period_end, evidence_json
    ) VALUES ($1,$2,$3,'growth_closed_loop','opportunity',$4,'attributed_revenue',$5,$6,$7,now()-interval '14 days',now(),$8::jsonb)
    RETURNING *`,
    [id, tenantId, storeId, opportunityId, before, after, after - before, JSON.stringify({ beforeDays, afterDays })]
  );
  console.log('Results tracked');
  return saved.rows[0];
}
