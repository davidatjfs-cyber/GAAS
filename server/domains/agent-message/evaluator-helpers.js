/**
 * chief_evaluator 路由：绩效文案 / 员工资料上下文（纯逻辑 + 可选 DB 读）。
 */

const SCORE_QUERY_RE = /分数|绩效|考核|得分|扣分|排名|评价|评级|奖金/;

const ROLE_LABEL = {
  admin: '管理员',
  store_manager: '店长',
  store_production_manager: '出品经理',
  store_employee: '员工',
  hr_manager: 'HR',
  hq_manager: '总部营运',
  cashier: '出纳',
};

export function isChiefEvaluatorScoreQuery(text) {
  return SCORE_QUERY_RE.test(String(text || ''));
}

export function roleLabelZh(role) {
  const r = String(role || '').trim();
  return ROLE_LABEL[r] || r || '员工';
}

/**
 * @param {{
 *   employees: Array<{ status?: string, store?: string, name?: string, username?: string, role?: string, position?: string, department?: string }>,
 *   senderRole: string,
 *   store: string,
 * }} opts
 */
export function buildVisibleEmployeeContext(opts) {
  const allEmps = Array.isArray(opts.employees) ? opts.employees : [];
  const canSeeAll = ['admin', 'hr_manager', 'hq_manager'].includes(String(opts.senderRole || ''));
  const store = String(opts.store || '');
  const visibleEmps = canSeeAll
    ? allEmps.filter((e) => e.status === 'active')
    : allEmps.filter((e) => e.status === 'active' && e.store === store);
  if (!visibleEmps.length) return '';
  return (
    '\n\n当前可查询的员工资料（共' +
    visibleEmps.length +
    '人）：\n' +
    visibleEmps
      .map(
        (e) =>
          `- ${e.name}（${e.username}）| ${roleLabelZh(e.role)} | ${e.store || '总部'} | ${e.position || '-'} | ${e.department || '-'}`
      )
      .join('\n')
  );
}

export function formatChiefEvaluatorScoreReply(senderName, score) {
  const bd = score?.breakdown || {};
  const storeRatingText = bd.store_rating ? `${bd.store_rating}级` : '-';
  const execRatingText = bd.execution_rating ? `${bd.execution_rating}级` : '-';
  const attRatingText = bd.attitude_rating ? `${bd.attitude_rating}级` : '-';
  const abiRatingText = bd.ability_rating ? `${bd.ability_rating}级` : '-';
  return `HR: ${senderName}，你在${score.store}（${score.brand}）的最新考核：\n\n📊 绩效得分：${score.total_score} 分\n🏪 门店评级：${storeRatingText}\n📈 执行力：${execRatingText}\n💪 工作态度：${attRatingText}\n🎯 工作能力：${abiRatingText}\n\n${score.summary || ''}`;
}

export function formatChiefEvaluatorNoScoreReply(senderName) {
  return `${senderName}，暂无你的考核记录。考核将在月末自动生成。`;
}

/**
 * 从 shared state 拉员工列表并拼上下文。
 * @param {() => Promise<any>} getSharedState
 */
export async function loadChiefEvaluatorEmployeeContext(getSharedState, opts) {
  try {
    const hrState = await getSharedState();
    const allEmps = Array.isArray(hrState?.employees)
      ? hrState.employees
      : Array.isArray(hrState?.data?.employees)
        ? hrState.data.employees
        : [];
    return buildVisibleEmployeeContext({
      employees: allEmps,
      senderRole: opts.senderRole,
      store: opts.store,
    });
  } catch {
    return '';
  }
}

/**
 * 绩效分数查询早退（读 agent_scores）。
 * @returns {Promise<{ handled: true, response: string } | { handled: false }>}
 */
export async function tryHandleChiefEvaluatorScore(pool, opts) {
  if (!isChiefEvaluatorScoreQuery(opts.text)) return { handled: false };
  const senderUsername = String(opts.senderUsername || '').trim();
  const senderName = String(opts.senderName || '').trim() || senderUsername;
  const scoresR = await pool.query(
    `SELECT * FROM agent_scores WHERE username = $1 ORDER BY created_at DESC LIMIT 1`,
    [senderUsername]
  );
  const score = scoresR.rows?.[0];
  if (score) {
    return { handled: true, response: formatChiefEvaluatorScoreReply(senderName, score) };
  }
  return { handled: true, response: formatChiefEvaluatorNoScoreReply(senderName) };
}
