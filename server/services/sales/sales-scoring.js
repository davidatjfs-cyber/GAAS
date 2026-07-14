/**
 * 销售意向评分（证据明细，禁止黑盒）
 */
const RULES = [
  { key: 'stores_3plus', points: 15, test: (e) => (e.store_count || 0) >= 3, evidence: (e) => `${e.store_count}家门店` },
  { key: 'stores_10plus', points: 25, test: (e) => (e.store_count || 0) >= 10, evidence: (e) => `${e.store_count}家（连锁加权）` },
  { key: 'phone_data', points: 15, test: (e) => e.phone_data_ready === true, evidence: () => '具备手机号数据基础' },
  { key: 'member_system', points: 10, test: (e) => e.has_member_system === true, evidence: () => '已有会员系统' },
  { key: 'budget_high', points: 10, test: (e) => e.budget_range === 'high', evidence: () => '预算充足' },
  { key: 'pain_repurchase', points: 10, test: (e) => /复购|老客|流失/.test(String(e.pain_point || '')), evidence: () => '明确复购/流失痛点' },
  { key: 'pain_revenue', points: 10, test: (e) => /营业额下降|营销归因|缺少经营数据/.test(String(e.pain_point || '')), evidence: (e) => `明确${e.pain_point}痛点` },
  { key: 'pain_execution', points: 8, test: (e) => /门店执行|多店管理|人才培养/.test(String(e.pain_point || '')), evidence: (e) => `明确${e.pain_point}痛点` },
  { key: 'boss', points: 10, test: (e) => e.decision_role === '老板', evidence: () => '老板本人参与' },
  { key: 'decision_role_known', points: 5, test: (e) => !!e.decision_role && e.decision_role !== '职能', evidence: (e) => `决策角色${e.decision_role}` },
  { key: 'ask_price', points: 10, test: (_e, ev) => ev.has('ASK_PRICE'), evidence: () => '主动询价' },
  { key: 'request_demo', points: 15, test: (_e, ev) => ev.has('REQUEST_DEMO'), evidence: () => '要求Demo' },
  { key: 'request_trial', points: 15, test: (_e, ev) => ev.has('REQUEST_TRIAL'), evidence: () => '询问试跑' },
  { key: 'ask_contract', points: 10, test: (_e, ev) => ev.has('ASK_CONTRACT'), evidence: () => '进入合同/付款流程' },
  { key: 'buying_intent', points: 15, test: (_e, ev) => ev.has('BUYING_INTENT'), evidence: () => '表达正在找解决方案' },
  { key: 'timeline_clear', points: 10, test: (e) => !!e.expected_close_hint || /年底|明年|春节后|一季度|二季度|三季度|四季度|6月|7月|8月|9月|10月|11月|12月|下个月|下月|这个月|本月/.test(String(e.expected_close_hint || '')), evidence: () => '有明确上线时间' },
  { key: 'no_decision_power', points: -10, test: (e) => e.decision_role === '职能' || /不是.*决策|我定不了|要问老板|要问领导|要问店长|汇报|建议|推荐/.test(String(e.pain_point || '')), evidence: () => '无决策权' },
  { key: 'only_free_trial', points: -10, test: (_e, ev) => ev.has('LOW_INTEREST') || /只想免费|只试用|先用免费版|不要钱|免费试用|免费版|白嫖/.test(String(_e.pain_point || '')), evidence: () => '只想免费试用' },
  { key: 'heavy_customization', points: -20, test: (e) => /定制|定制开发|二次开发|个性化|特殊需求|必须开发|独家|私有化部署|本地部署|买断/.test(String(e.pain_point || '')), evidence: () => '需要大量定制' },
  { key: 'nonstandard_pos', points: -20, test: (e) => /自研POS|自己开发|小票|Excel|手工账|没有POS|无POS|旧的POS|小众POS|不支持/.test(String(e.pain_point || '')), evidence: () => 'POS无法标准接入' },
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

export function computeWinProbability({ stage = 'new', intent_score = 0, demo_count = 0, meeting_count = 0, trial_status = '' } = {}) {
  if (stage === 'won') return 100;
  if (stage === 'lost' || stage === 'unfit') return 0;
  let base = 0;
  if (stage === 'trial') base = 60;
  else if (stage === 'demo_completed') base = 45;
  else if (stage === 'proposal') base = 35;
  else if (stage === 'sales_takeover') base = 25;
  else if (stage === 'need_identified') base = 15;
  else base = 10;
  base += Math.min(30, intent_score / 3.3);
  if (demo_count > 0) base += 10;
  if (meeting_count > 0) base += 5;
  if (trial_status === 'in_progress') base += 15;
  return Math.min(95, Math.max(5, Math.round(base)));
}
