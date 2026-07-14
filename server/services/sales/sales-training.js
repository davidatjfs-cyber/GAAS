/**
 * 销售话术培训：场景演练 + 评分
 */
export const TRAINING_SCENARIOS = [
  {
    key: 'ask_price',
    title: '客户询价',
    prompt: '客户：你们多少钱？能不能便宜点？',
    hints: ['不讲具体折扣', '引导确认门店数和数据条件', '约 Demo'],
    keywords: ['门店', '数据', 'Demo', '试跑', '评估'],
  },
  {
    key: 'pos_concern',
    title: 'POS 接入顾虑',
    prompt: '客户：我们 POS 很老，能接吗？要多久？',
    hints: ['不承诺全部可接', '说明需评估', '给典型周期范围'],
    keywords: ['评估', '对接', '标准', '清单', '试跑'],
  },
  {
    key: 'no_decision',
    title: '非决策人沟通',
    prompt: '客户：我是运营，得问老板。',
    hints: ['确认决策链', '争取老板参与 Demo', '留资料'],
    keywords: ['老板', '决策', 'Demo', '资料', '时间'],
  },
  {
    key: 'trial_doubt',
    title: '试跑价值质疑',
    prompt: '客户：30天能看出什么？',
    hints: ['讲可量化指标', '回店/营收/执行率', '案例'],
    keywords: ['回店', '营业额', '执行', '指标', '验证'],
  },
];

export function scoreTrainingResponse(scenarioKey, response = '') {
  const scenario = TRAINING_SCENARIOS.find((s) => s.key === scenarioKey);
  if (!scenario) return { ok: false, error: 'unknown_scenario' };
  const text = String(response || '');
  const hits = (scenario.keywords || []).filter((k) => text.includes(k));
  const forbidden = [/保证.*涨/, /全部.*POS/, /一定/, /打折/, /优惠.*给/].filter((re) => re.test(text));
  let score = Math.min(100, 40 + hits.length * 15);
  if (forbidden.length) score -= 25 * forbidden.length;
  score = Math.max(0, score);
  const feedback = [
    hits.length ? `覆盖要点：${hits.join('、')}` : '建议补充：门店数/数据条件/Demo/试跑指标',
    forbidden.length ? `避免过度承诺：${forbidden.length} 处` : '未检测到明显过度承诺',
  ].join('；');
  return { ok: true, score, feedback, hits, forbidden_count: forbidden.length, scenario };
}

export async function recordTrainingSession(pool, { username, scenarioKey, response, score, feedback }) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_training_sessions (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      scenario_key TEXT NOT NULL,
      user_response TEXT,
      score INT,
      feedback TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  const r = await pool.query(
    `INSERT INTO sales_training_sessions (username, scenario_key, user_response, score, feedback)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [username, scenarioKey, response, score, feedback]
  );
  return r.rows?.[0];
}

export async function getTrainingStats(pool, username, limit = 20) {
  const r = await pool.query(
    `SELECT scenario_key, AVG(score)::int AS avg_score, COUNT(*)::int AS attempts, MAX(created_at) AS last_at
       FROM sales_training_sessions
      WHERE username=$1
      GROUP BY scenario_key
      ORDER BY last_at DESC
      LIMIT $2`,
    [username, limit]
  ).catch(() => ({ rows: [] }));
  return r.rows || [];
}
