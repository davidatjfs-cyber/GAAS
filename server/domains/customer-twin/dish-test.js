/**
 * 菜品测试服务（阶段 1）：体检报告 = 客群匹配 + 风险预判 + 试菜验证清单。
 */

import { matchDishToPersonas } from './dish-match.js';
import { buildDishRisks } from './dish-risk.js';
import { buildTastingChecklist } from './dish-checklist.js';

export async function listDishOptions(pool, brand = '') {
  const r = await pool.query(
    `SELECT dish_name, dish_price, spicy_level, main_ingredient, cooking_method, taste_type,
            is_signature, is_new, portion_size, suitable_scenes
       FROM dish_library_costs
      WHERE biz_type='dinein' AND enabled=TRUE
        AND ($1 = '' OR brand = $1)
        AND (spicy_level <> '' OR main_ingredient <> '')
      ORDER BY dish_name`,
    [String(brand || '').trim()]
  );
  return r.rows || [];
}

export async function runDishTest(pool, { brand, dishName, dish = null }) {
  let d = dish;
  if (!d) {
    const r = await pool.query(
      `SELECT * FROM dish_library_costs
        WHERE biz_type='dinein' AND brand=$1 AND dish_name=$2
        LIMIT 1`,
      [brand, dishName]
    );
    d = r.rows?.[0] || null;
    if (!d) return { ok: false, error: 'dish_not_found' };
  }
  const avg = await pool.query(
    `SELECT avg(dish_price)::float AS avg_price
       FROM dish_library_costs
      WHERE biz_type='dinein' AND brand=$1 AND dish_price > 0`,
    [brand]
  );
  const avgPrice = avg.rows?.[0]?.avg_price || 60;
  const corpusR = await pool.query(
    `SELECT code, category, content FROM customer_twin_negative_feedback WHERE active=TRUE`
  );
  const realR = await pool.query(
    `SELECT agent_data->>'reason' AS reason
       FROM agent_messages
      WHERE content_type='negative_review' AND agent_data ? 'reason'
      ORDER BY created_at DESC LIMIT 120`
  );
  const realComplaints = realR.rows.map((r) => r.reason).filter(Boolean);
  const match = matchDishToPersonas({ dish: d, avgPrice });
  const risks = buildDishRisks({ dish: match.dish, avgPrice, corpus: corpusR.rows, realComplaints });
  const checklist = buildTastingChecklist({ dish: match.dish, match, risks });
  return {
    ok: true,
    brand,
    dish: match.dish,
    avg_price: Math.round(avgPrice),
    match,
    risks,
    checklist,
    generated_at: new Date().toISOString(),
  };
}
