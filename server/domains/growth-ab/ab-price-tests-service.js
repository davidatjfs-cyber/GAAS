/**
 * 定价 A/B 测试的查询与创建（从 growth-ab/service 外提）。
 */
import { cleanText } from '../growth-phase-auth.js';
import { safeDateOnly, todayShanghaiYmd, ymdAddDays } from './dates.js';
import { computeAbTestOutcome } from './ab-outcome-service.js';

function httpError(code, status = 400, message = '') {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

export async function listPriceTests(pool, tenantId, opts = {}) {
  const storeCode = cleanText(opts.storeCode || '', 128);
  const status = cleanText(opts.status || '', 40);
  const r = await pool.query(
    `SELECT * FROM ab_test_tasks
      WHERE test_type IN ('price_test', 'price_bundle')
        AND tenant_id = $3
        AND ($1 = '' OR store_code = $1)
        AND ($2 = '' OR status = $2)
      ORDER BY created_at DESC
      LIMIT 100`,
    [storeCode, status, tenantId]
  );
  const tasks = [];
  for (const row of r.rows || []) {
    const outcome = await computeAbTestOutcome(pool, row, tenantId).catch(() => null);
    tasks.push({ ...row, metrics: outcome?.byVariant || {} });
  }
  return tasks;
}

export async function createPriceTest(pool, tenantId, body, authUser) {
  const b = body || {};
  const testName = cleanText(b.test_name, 255);
  const storeCode = cleanText(b.store_code, 128);
  if (!testName || !storeCode) throw httpError('missing_fields', 400, 'missing test_name or store_code');
  const startDate = safeDateOnly(b.start_date) || todayShanghaiYmd();
  const endDate = safeDateOnly(b.end_date) || ymdAddDays(startDate, 14);
  const testType = b.test_type === 'price_bundle' ? 'price_bundle' : 'price_test';
  const targetMetric = cleanText(b.target_metric || 'revenue_per_order', 80);
  const r = await pool.query(
    `INSERT INTO ab_test_tasks (
       test_name, store_code, test_type, target_metric,
       variant_a, variant_b, rotation_config, start_date, end_date,
       min_sample_size, created_by, status, tenant_id
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,'running',$12)
     RETURNING *`,
    [
      testName, storeCode, testType, targetMetric,
      JSON.stringify(b.variant_a || {}),
      JSON.stringify(b.variant_b || {}),
      JSON.stringify(b.rotation_config || { method: 'store', note: '不同门店或不同日期轮换' }),
      startDate, endDate,
      Math.max(1, Math.floor(Number(b.min_sample_size) || 50)),
      cleanText(authUser?.username || 'system', 80),
      tenantId
    ]
  );
  return r.rows[0];
}
