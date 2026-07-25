import { randomUUID } from 'node:crypto';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'ontology', handler: 'result-tracking' });

export async function trackGrowthResults(pool, options = {}) {
  const tenantId = options.tenantId || 'default';
  const storeId = options.storeId || '';
  const opportunityId = options.opportunityId || '';
  const beforeDays = Math.max(1, Number(options.beforeDays || 7));
  const afterDays = Math.max(1, Number(options.afterDays || 7));
  const opp = opportunityId
    ? await pool.query(`SELECT opportunity_type, evidence_json FROM growth_ontology_opportunities WHERE tenant_id=$1 AND opportunity_id=$2 LIMIT 1`, [tenantId, opportunityId]).then(r => r.rows?.[0]).catch(() => null)
    : null;
  if (opp?.opportunity_type === 'new_customer_second_visit') {
    const r = await pool.query(
      `WITH touched AS (
         SELECT DISTINCT customer_id FROM growth_ontology_touches
          WHERE tenant_id=$1 AND store_id=$2
            AND customer_id IN (
              SELECT customer_id FROM growth_ontology_customers
               WHERE tenant_id=$1 AND store_id=$2 AND lifecycle_stage='new'
            )
       ), returned AS (
         SELECT o.customer_id, o.order_id, o.actual_paid, o.discount_amount
           FROM growth_ontology_orders o
           JOIN touched t ON t.customer_id=o.customer_id
          WHERE o.tenant_id=$1 AND o.store_id=$2
            AND o.order_time >= now() - interval '30 days'
            AND o.source IN ('second_visit','demo_second_visit','e2e_second_visit','pos')
       )
       SELECT (SELECT count(*) FROM touched)::numeric AS touched_count,
              count(DISTINCT customer_id)::numeric AS returned_count,
              COALESCE(sum(actual_paid),0)::numeric AS second_visit_revenue,
              COALESCE(sum(discount_amount),0)::numeric AS offer_cost
         FROM returned`,
      [tenantId, storeId]
    );
    const row = r.rows[0] || {};
    const touched = Number(row.touched_count || 0);
    const returned = Number(row.returned_count || 0);
    const revenue = Number(row.second_visit_revenue || 0);
    const cost = Number(row.offer_cost || 0);
    const id = `result_${randomUUID()}`;
    const evidence = {
      newCustomerTouchedCount: touched,
      secondVisitCustomerCount: returned,
      secondVisitRate: touched ? returned / touched : 0,
      secondVisitRevenue: revenue,
      offerCost: cost,
      netUplift: revenue - cost,
    };
    const saved = await pool.query(
      `INSERT INTO growth_ontology_business_results (
        result_id, tenant_id, store_id, result_type, entity_type, entity_id, metric_name,
        before_value, after_value, delta_value, result_period_start, result_period_end, evidence_json
      ) VALUES ($1,$2,$3,'new_customer_second_visit','opportunity',$4,'second_visit_revenue',0,$5,$6,now()-interval '14 days',now(),$7::jsonb)
      RETURNING *`,
      [id, tenantId, storeId, opportunityId, revenue, revenue - cost, JSON.stringify(evidence)]
    );
    log.info({ msg: 'new_customer_second_visit_results_tracked' });
    return saved.rows[0];
  }
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
  log.info({ msg: 'results_tracked' });
  return saved.rows[0];
}
