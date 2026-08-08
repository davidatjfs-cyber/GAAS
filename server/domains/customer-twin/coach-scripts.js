/**
 * AI 顾客技能剧本调度（v2）
 * 场景内容在 coach-scenes.js（14 技能 × 普通/高级/金牌 × 每级 2 套场景）。
 * 每场训练随机选场景、随机开场、随机打乱追问顺序，并避开上次用过的场景。
 */

import { SKILL_SCENES } from './coach-scenes.js';

export const COACH_CRITICAL_PRINCIPLES = [
  { id: 'soothe_first', label: '异议/客诉先安抚', fix: '先道歉/表达理解再处理，不与客人争辩', standard: '非常抱歉让您久等了，我马上帮您查，您先喝口茶。', anti: /(这跟我们没关系|不关我事|你去找|随便你|那是你的事)/ },
  { id: 'need_first', label: '先了解需求再推荐', fix: '推荐前先问清人数/口味/场合/预算', standard: '好的，请问今天几位用餐？有没有忌口？我再给您推荐合适的。', anti: /(不用问|直接给你|我说了算)/ },
  { id: 'own_exception', label: '异常先揽责', fix: '用"我来处理/我们负责"承接，再找原因', standard: '实在抱歉，这是我们没做好，我马上帮您处理。', anti: /(不是我的错|找我们经理|我不知道|别问我)/ },
  { id: 'promise_keep', label: '承诺要兑现', fix: '给具体时间/数字并保证做到，不模糊承诺', standard: '这道菜大约 8 分钟给您上，我帮您盯着。', anti: /(应该可以吧|到时候再说|下次再说)/ },
  { id: 'allergy_confirm', label: '过敏/忌口必须确认', fix: '主动问过敏/忌口并落实到单，不抱侥幸', standard: '请问有没有过敏或忌口？我帮您备注到后厨，确保不混用。', anti: /(过敏没事的|一点点没事|不用管)/ },
  { id: 'no_fabricate', label: '不确定先核实，不编造', fix: '不确定的内容先查证或请示，不说"大概/应该"', standard: '这个我需要和后厨确认一下，马上给您准确答复。', anti: /(好像是|应该是|可能是吧|说不准|记不清|大概吧)/ },
];

export const COACH_DIMENSIONS = [
  { key: 'professional', label: '专业度', fix: '回答不够专业：用知识库准确回答，菜品/规则先掌握再开口', standard: '这道菜是豆酱焗清远鸡，用的是广东清远走地鸡，腌制后砂锅焗制，肉嫩是腌制和火候控制的。' },
  { key: 'tone', label: '语气', fix: '语气不够自然/礼貌：多用"您/请/我帮您"，避免生硬冷淡', standard: '您好，不好意思让您久等了，我马上帮您处理。' },
  { key: 'response', label: '应对', fix: '应对不够得体：先接住客人情绪再给方案，被追问不慌乱', standard: '您先别着急，我理解您的感受，我先查一下单，马上给您答复。' },
  { key: 'completeness', label: '完整性', fix: '回答不完整：把关键信息（规则/时限/补偿/替代方案）说全', standard: '充值 500 送 100，金额次日到账，全场通用，有效期一年，我可以把细则发您确认。' },
  { key: 'knowledge_accuracy', label: '知识准确性', fix: '知识有误：核对知识库，不确定先查证再回答', standard: '我们用的是清远鸡，具体供应商我可以查证后给您准确答复。' },
  { key: 'initiative', label: '主动性', fix: '不够主动：主动确认需求、主动告知时间、主动补位', standard: '请问需要帮您安排座位吗？您的菜大约 10 分钟上，我先帮您催一下。' },
  { key: 'sales_conversion', label: '销售转化', skills: ['selling'], fix: '推销未促成：合适时机给出明确建议并邀请行动', standard: '按您的用餐频率，充 500 最划算，两个月刚好用完，我现在帮您办一个？' },
];

export function scriptFor(skillKey, level = 'normal') {
  const def = SKILL_SCENES[skillKey];
  if (!def) return null;
  const lv = def.levels[level] || def.levels.normal;
  return {
    skill_key: skillKey,
    level,
    knowledge_hints: def.knowledge_hints || [],
    min_deep_turns: 6,
    min_challenge_turns: 3,
    scenes: lv.scenes,
    closing_satisfied: lv.closing_satisfied,
    closing_unsatisfied: lv.closing_unsatisfied,
  };
}

export function pickScene(script, { avoidKey = '', rnd = Math.random } = {}) {
  const pool = Array.isArray(script?.scenes) ? script.scenes : [];
  if (!pool.length) return null;
  const candidates = pool.filter((s) => s.key !== avoidKey);
  const source = candidates.length ? candidates : pool;
  return source[Math.floor(Math.max(0, Math.min(0.999999, rnd())) * source.length)] || source[0];
}

export function shuffledIndices(len, rnd = Math.random) {
  const arr = Array.from({ length: Math.max(0, Number(len) || 0) }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.max(0, Math.min(0.999999, rnd())) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function dimensionFix(key) {
  return COACH_DIMENSIONS.find((d) => d.key === key)?.fix || '';
}

export function principleFix(id) {
  return COACH_CRITICAL_PRINCIPLES.find((p) => p.id === id)?.fix || '';
}
