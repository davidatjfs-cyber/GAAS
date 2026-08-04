/**
 * Twin 引擎 v0：确定性决策器 + 表达器（验证版）
 * - 决策器：纯计算（人格 × 事件 → 情绪曲线/满意度/行为决策），不调 LLM
 * - 表达器：负反馈知识库匹配 + 可选 LLM 润色（失败回退模板）
 */

import { PERSONA_ARCHETYPES } from './persona-schema.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jitter(rand, value, spread = 0.15) {
  const delta = (rand() * 2 - 1) * spread;
  return Math.max(0, Math.min(1, value + delta));
}

export function samplePersonas({ seed = 20260804, count = 6, keys = null } = {}) {
  const rand = mulberry32(seed);
  const archetypes = keys && keys.length ? keys : Object.keys(PERSONA_ARCHETYPES);
  const personas = [];
  for (let i = 0; i < count; i += 1) {
    const key = archetypes[i % archetypes.length];
    const base = PERSONA_ARCHETYPES[key];
    const weights = { ...base.weights };
    for (const k of Object.keys(weights)) weights[k] = jitter(rand, weights[k]);
    const tolerance = {
      ...base.tolerance,
      wait_food: Math.round(base.tolerance.wait_food + (rand() * 2 - 1) * 5),
    };
    personas.push({
      persona_key: key,
      label: base.label,
      intent: base.intent,
      weights,
      price_mind: { ...base.price_mind },
      tolerance,
      mistake_tolerance: { ...base.mistake_tolerance },
      expression: base.expression,
      complaint: base.complaint,
      emotion: { ...base.emotion },
      hidden: { ...base.hidden },
    });
  }
  return personas;
}

const EVENT_DEFS = {
  wait_food: { corpusCategory: 'slow_service', basePenalty: 10, unit: 'minutes' },
  wrong_dish: { corpusCategory: 'wrong_dish', basePenalty: 20 },
  missing_dish: { corpusCategory: 'missing_dish', basePenalty: 18 },
  cold_food: { corpusCategory: 'dish_quality', basePenalty: 15 },
  quality_issue: { corpusCategory: 'dish_quality', basePenalty: 20 },
  attitude: { corpusCategory: 'service_attitude', basePenalty: 18 },
  queue: { corpusCategory: 'waiting', basePenalty: 8, unit: 'minutes' },
  checkout_slow: { corpusCategory: 'checkout', basePenalty: 8 },
  noise: { corpusCategory: 'environment', basePenalty: 8 },
  explain: { corpusCategory: null, recovery: 8 },
  manager_apology: { corpusCategory: null, recovery: 15 },
  dessert: { corpusCategory: null, recovery: 10 },
  rework: { corpusCategory: null, recovery: 18 },
  discount: { corpusCategory: null, recovery: 12 },
  dish_good: { corpusCategory: null, recovery: 15 },
};

export function computeEventPenalty(persona, event) {
  const def = EVENT_DEFS[event.type];
  if (!def) return 0;
  if (def.recovery) return -def.recovery;
  let penalty = def.basePenalty;
  if (def.unit === 'minutes') {
    const minutes = Number(event.minutes ?? event.value ?? 0);
    const tolerance = persona.tolerance.wait_food || 20;
    penalty = Math.max(0, (minutes - tolerance) * 1.5);
  }
  if (event.type === 'wrong_dish') {
    penalty = penalty * (1 + (1 - persona.mistake_tolerance.wrong_dish));
  }
  if (event.type === 'queue') {
    const minutes = Number(event.minutes ?? 0);
    const tolerance = persona.tolerance.queue || 10;
    penalty = Math.max(0, (minutes - tolerance) * 1.0);
  }
  if (event.type === 'noise' && persona.hidden.atmosphere) {
    penalty += 6;
  }
  return Math.round(penalty);
}

/**
 * 决策器：事件时间线 → 情绪曲线 + 满意度拆解 + 行为决策（确定性）
 * 铁律：恢复分不超过原始损失；情绪连续变化，不允许跳变。
 */
export function runSimulation({ persona, events = [], startEmotion = 80 } = {}) {
  const trace = [];
  let emotion = startEmotion;
  let totalLoss = 0;
  let totalRecovery = 0;
  const surprises = [];

  for (const event of events) {
    const delta = computeEventPenalty(persona, event);
    if (delta < 0) {
      const recover = Math.min(-delta, totalLoss - totalRecovery);
      totalRecovery += recover;
      emotion = Math.min(emotion + recover, startEmotion);
      surprises.push(event.type);
    } else if (delta > 0) {
      totalLoss += delta;
      emotion = Math.max(20, emotion - delta);
    }
    trace.push({
      step: trace.length + 1,
      event: event.type,
      detail: event.minutes ? `${event.minutes}分钟` : (event.action || ''),
      delta,
      emotion: Math.round(emotion),
    });
  }

  const finalSatisfaction = Math.max(0, Math.min(100, Math.round(emotion)));
  const breakdown = buildSatisfactionBreakdown(persona, events);
  const revisit = finalSatisfaction >= 70;
  const recommend = finalSatisfaction >= 85 && surprises.length > 0;
  const complain = finalSatisfaction < persona.emotion.anger_threshold && persona.complaint !== 'never';

  return {
    persona_key: persona.persona_key,
    label: persona.label,
    emotion_curve: trace,
    final_emotion: Math.round(emotion),
    satisfaction: {
      total: finalSatisfaction,
      breakdown,
    },
    decisions: {
      complain,
      complaint_channel: complain ? persona.complaint : null,
      revisit,
      recommend,
      surprises,
    },
    stats: { total_loss: totalLoss, total_recovery: totalRecovery },
  };
}

function buildSatisfactionBreakdown(persona, events) {
  const dims = { 菜: 0, 服务: 0, 环境: 0, 等待: 0, 价格: 0, 补偿: 0 };
  const lossByDim = { 菜: 0, 服务: 0, 环境: 0, 等待: 0, 价格: 0, 补偿: 0 };
  for (const event of events) {
    const penalty = computeEventPenalty(persona, event);
    if (penalty <= 0) {
      lossByDim.补偿 += -penalty;
      continue;
    }
    const map = {
      wait_food: '等待', queue: '等待', wrong_dish: '菜', missing_dish: '菜',
      cold_food: '菜', quality_issue: '菜', attitude: '服务', checkout_slow: '服务',
      noise: '环境',
    };
    const dim = map[event.type] || '服务';
    lossByDim[dim] += penalty;
  }
  const weightScale = {
    菜: persona.weights.taste, 服务: persona.weights.service,
    环境: persona.weights.environment, 等待: persona.weights.efficiency,
    价格: persona.weights.price, 补偿: persona.weights.emotion,
  };
  for (const dim of Object.keys(dims)) {
    const w = weightScale[dim] || 0.1;
    dims[dim] = Math.max(0, Math.round(100 - lossByDim[dim] * (w * 2)));
  }
  return { dims, loss: lossByDim };
}

export function corpusCategoryForEvent(type) {
  return EVENT_DEFS[type]?.corpusCategory || null;
}

const FALLBACK_UTTERANCES = {
  wait_food: ['不好意思，我们那个菜还没好吗？', '是不是漏掉了？我们等挺久了。'],
  wrong_dish: ['这个不是我们点的，是不是送错桌了？', '我们没点这个，麻烦确认一下。'],
  missing_dish: ['还有一个菜一直没上，是不是漏了一道？'],
  cold_food: ['这个菜有点凉了，能帮我们加热一下吗？'],
  quality_issue: ['这个今天发挥不太稳定，感觉没有上次好。'],
  attitude: ['叫了几次都没人回应，服务有点跟不上。'],
  queue: ['请问还要等多久？前面还有几桌？'],
  checkout_slow: ['可以结账了吗？已经等了一会儿了。'],
  noise: ['今天店里有点吵。'],
};

export function pickCorpus(entries, style, seedText) {
  const pool = entries.length
    ? entries
    : [];
  if (!pool.length) return null;
  const styled = pool.filter((e) => !style || e.expression_style === style || e.expression_style === 'direct');
  const list = styled.length ? styled : pool;
  const idx = Math.abs(String(seedText).length + (list[0]?.code || '').length) % list.length;
  return list[idx] || null;
}

export function expressUtterance({ persona, sim, corpusByCategory = null, seedText = '' } = {}) {
  const lastNegative = [...sim.emotion_curve].reverse().find((s) => s.delta > 0);
  const eventType = lastNegative?.event || 'wait_food';
  const category = corpusCategoryForEvent(eventType);
  const style = persona.expression;
  let entry = null;
  if (category && corpusByCategory) {
    entry = pickCorpus(corpusByCategory[category] || [], style, seedText);
  }
  if (entry) {
    return {
      text: entry.content,
      style,
      source: 'corpus',
      corpus_code: entry.code,
      event: eventType,
    };
  }
  const fallback = FALLBACK_UTTERANCES[eventType] || ['今天体验一般。'];
  return {
    text: fallback[Math.abs(String(seedText).length) % fallback.length],
    style,
    source: 'template',
    event: eventType,
  };
}
