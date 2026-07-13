/**
 * 销售意向评分（证据明细，禁止黑盒）
 */
const RULES = [
  { key: 'stores_3plus', points: 15, test: (e) => (e.store_count || 0) >= 3, evidence: (e) => `${e.store_count}家门店` },
  { key: 'stores_10plus', points: 10, test: (e) => (e.store_count || 0) >= 10, evidence: (e) => `${e.store_count}家（连锁加权）` },
  { key: 'phone_data', points: 15, test: (e) => e.phone_data_ready === true, evidence: () => '具备手机号数据基础' },
  { key: 'pain_repurchase', points: 10, test: (e) => /复购|老客|流失/.test(String(e.pain_point || '')), evidence: () => '明确复购/流失痛点' },
  { key: 'pain_execution', points: 8, test: (e) => /执行|店长/.test(String(e.pain_point || '')), evidence: () => '明确执行痛点' },
  { key: 'boss', points: 10, test: (e) => e.decision_role === '老板', evidence: () => '老板本人参与' },
  { key: 'ask_price', points: 15, test: (_e, ev) => ev.has('ASK_PRICE'), evidence: () => '主动询价' },
  { key: 'request_demo', points: 20, test: (_e, ev) => ev.has('REQUEST_DEMO'), evidence: () => '要求Demo' },
  { key: 'request_trial', points: 15, test: (_e, ev) => ev.has('REQUEST_TRIAL'), evidence: () => '询问试跑' },
  { key: 'buying_intent', points: 15, test: (_e, ev) => ev.has('BUYING_INTENT'), evidence: () => '表达正在找解决方案' },
  { key: 'no_phone_data', points: -10, test: (e) => e.phone_data_ready === false, evidence: () => '暂无手机号数据' },
  { key: 'single_store', points: -5, test: (e) => e.store_count === 1, evidence: () => '单店（优先度降低）' },
];

export function scoreLead({ extracted = {}, eventTypes = [] } = {}) {
  const ev = new Set(eventTypes || []);
  const items = [];
  let total = 0;
  for (const rule of RULES) {
    if (rule.test(extracted, ev)) {
      items.push({ rule_key: rule.key, points: rule.points, evidence: rule.evidence(extracted, ev) });
      total += rule.points;
    }
  }
  total = Math.max(0, Math.min(100, total));
  const intent_level = total >= 70 ? 'high' : total >= 40 ? 'medium' : 'low';
  return { intent_score: total, intent_level, items };
}

export async function persistScore(pool, leadId, scoreResult) {
  await pool.query(`DELETE FROM sales_score_items WHERE lead_id=$1`, [leadId]).catch(() => {});
  for (const item of scoreResult.items || []) {
    await pool.query(
      `INSERT INTO sales_score_items (lead_id, rule_key, points, evidence) VALUES ($1,$2,$3,$4)`,
      [leadId, item.rule_key, item.points, item.evidence]
    );
  }
  await pool.query(
    `UPDATE sales_leads SET intent_score=$2, intent_level=$3, updated_at=NOW() WHERE id=$1`,
    [leadId, scoreResult.intent_score, scoreResult.intent_level]
  );
}
