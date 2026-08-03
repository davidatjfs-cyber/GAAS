/** 对外展示用中文标签（内部仍用英文 key） */

export const SKILL_LABELS = {
  questioning: '提问能力',
  listening: '倾听能力',
  value: '价值表达',
  closing: '成交推进',
  solution_value: '方案价值',
  implementation: '落地实施',
  empathy: '情绪安抚',
  diagnosis: '问题定位',
  resolution: '解决闭环',
  retention: '关系维护',
  service_awareness: '服务意识',
  product_knowledge: '产品知识',
  recommendation: '推荐能力',
  communication: '沟通能力',
  exception_handling: '异常处理',
  member_conversion: '会员转化',
  brand_expression: '品牌表达',
};

export const PRINCIPLE_LABELS = {
  no_early_pitch: '不急着介绍产品',
  sell_outcome: '不卖功能只卖结果',
  stay_on_pain: '围绕客户痛点',
  ask_first: '永远先提问',
  no_argue: '不和客户争论',
  solution_value: '方案价值与边界',
  implementation: '落地实施清晰',
  soothe_first: '先安抚再处理',
  empathy: '共情情绪',
  ask_expectation: '探询期望',
  dig_refund_root: '退款先挖根因',
  close_loop: '闭环交付',
  own_problem: '先揽责不推诿',
  no_overpromise: '承诺有边界',
  closing: '成交推进',
  greet_first: '先问候再办事',
  soothe_guest: '客诉先安抚',
  recommend_after_need: '先了解再推荐',
  own_exception: '异常先揽责',
  member_invite: '适时会员引导',
  brand_tone: '品牌表达得体',
  clear_speak: '表达清晰可执行',
  clear_bill: '账单说清楚',
  refund_verify: '退款先核实',
  queue_calm: '排队先安抚',
  groupbuy_clear: '团购规则说清',
  member_checkout: '结账会员提醒',
  stabilize_first: '升级客诉先稳场',
  listen_staff: '对员工先听再决',
  mystery_fact: '巡店据实应答',
  hq_clear: '对总部汇报清晰',
  service_standard: '强调门店服务标准',
  ack_ticket: '先确认出餐问题',
  eta_clear: '给出明确出餐时间',
  food_safety: '食品安全优先',
  no_blame_foh: '不甩锅前厅',
  clarify_goal: '先澄清总部目标',
  store_context: '结合门店现状',
  actionable: '给出可执行动作',
  brand_align: '对齐品牌标准',
};

export const SCENE_LABELS = {
  has_system: '已有系统',
  too_expensive: '觉得太贵',
  think_again: '再考虑一下',
  no_time: '没时间',
  ask_features: '询问功能',
  ai_useless: '不相信AI',
  complaint: '投诉',
  angry: '情绪不好',
  ux_bad: '功能不好用',
  refund: '要求退款',
  no_early_pitch: '开场挖需',
  custom_win: '高分自提名',
  rush: '催菜',
  wrong_dish: '上错菜',
  ask_recommend: '询问推荐',
  member: '会员相关',
  queue: '排队',
  mystery: '神秘顾客/巡店',
  staff: '员工冲突',
  kitchen: '后厨协同',
  hq: '总部追问',
};

export const TRACK_LABELS = {
  sales: '销售陪练',
  cs: '客服陪练',
  consult: '咨询答疑陪练',
  foh_server: '服务员陪练',
  cashier: '收银陪练',
  store_manager: '店长陪练',
  kitchen_staff: '厨房陪练',
  hq_ops: '总部运营陪练',
};

export function skillLabel(key) {
  return SKILL_LABELS[key] || key;
}

export function principleLabel(key) {
  return PRINCIPLE_LABELS[key] || key;
}

export function sceneLabel(key) {
  if (!key) return '';
  if (SCENE_LABELS[key]) return SCENE_LABELS[key];
  if (String(key).startsWith('nom_')) return '提名话术';
  return key;
}

export function trackLabel(track) {
  return TRACK_LABELS[track] || track;
}

export function difficultyLabel(n) {
  const d = Number(n) || 1;
  return `难度${d}`;
}

/**
 * 四档成绩：不合格 / 合格 / 优秀 / 卓越
 * <80 不合格 · 80–90 合格 · 91–95 优秀 · >95 卓越
 */
export function scoreGrade(score) {
  if (score == null || Number.isNaN(Number(score))) return null;
  const n = Number(score);
  if (n < 80) return '不合格';
  if (n <= 90) return '合格';
  if (n <= 95) return '优秀';
  return '卓越';
}

/** 能力一行（分数，内部/兼容）：提问能力 54 · 倾听能力 70 */
export function formatSkillsLine(skills = {}) {
  return Object.entries(skills)
    .map(([k, v]) => `${skillLabel(k)} ${v}`)
    .join(' · ');
}

/** 能力一行（四档）：提问能力 合格 · 倾听能力 优秀 */
export function formatSkillsGradeLine(skills = {}) {
  return Object.entries(skills)
    .map(([k, v]) => `${skillLabel(k)} ${scoreGrade(v) || '—'}`)
    .join(' · ');
}

export function skillsGrades(skills = {}) {
  return Object.fromEntries(
    Object.entries(skills).map(([k, v]) => [k, scoreGrade(v)])
  );
}

export function localizeFocus(focus) {
  return principleLabel(focus) !== focus ? principleLabel(focus) : skillLabel(focus);
}

/** 把 source_label 里残留英文 scene key 换成中文 */
export function localizeSourceLabel(label = '') {
  let s = String(label || '');
  for (const [en, zh] of Object.entries(SCENE_LABELS)) {
    s = s.replace(new RegExp(`\\b${en}\\b`, 'g'), zh);
  }
  s = s.replace(/销冠话术/g, '销冠话术').replace(/金牌客服/g, '金牌客服');
  return s;
}
