/**
 * 菜品-客群匹配器（阶段 1）
 * 原理：菜品属性向量 × 客群人格偏好向量，四层匹配（口味/价格/场景/风险）。
 * 只输出"哪类客群适合/不适合 + 原因 + 建议定价区间"，不做销量预测。
 */

import { PERSONA_ARCHETYPES, PERSONA_KEYS } from './persona-schema.js';

const SPICE_LEVEL = { 不辣: 1, 微辣: 2, 中辣: 3, 重辣: 4, 变态辣: 5 };

// 每类客群的口味/场景/价格偏好参数（专家先验，阶段 3 用真实回流校准）
const TASTE_PROFILE = {
  family_dinner: { spicyMax: 2, health: 0.5, portion: 0.8, rawOk: false, scene: '家庭聚餐' },
  couple_date: { spicyMax: 3, health: 0.4, portion: 0.4, rawOk: true, scene: '情侣约会' },
  business_banquet: { spicyMax: 3, health: 0.3, portion: 0.5, rawOk: true, scene: '商务宴请' },
  repeat_member: { spicyMax: 3, health: 0.5, portion: 0.5, rawOk: true, scene: '朋友聚会' },
  price_sensitive: { spicyMax: 3, health: 0.4, portion: 0.8, rawOk: false, scene: '工作餐' },
  quality_focused: { spicyMax: 3, health: 0.7, portion: 0.5, rawOk: true, scene: '商务宴请' },
};

const INGREDIENT_AFFINITY = {
  family_dinner: { 猪肉: 0.8, 鸡肉: 0.8, 牛肉: 0.7, 海鲜: 0.6, 河鲜: 0.7, 蔬菜: 0.8, 豆制品: 0.7, 其他: 0.5, 主食: 0.7 },
  couple_date: { 海鲜: 0.8, 河鲜: 0.7, 猪肉: 0.6, 鸡肉: 0.6, 牛肉: 0.6, 蔬菜: 0.6, 其他: 0.5, 主食: 0.5, 豆制品: 0.5 },
  business_banquet: { 海鲜: 0.9, 河鲜: 0.9, 牛肉: 0.8, 猪肉: 0.7, 鸡肉: 0.7, 蔬菜: 0.6, 其他: 0.5, 主食: 0.5, 豆制品: 0.5 },
  repeat_member: { 猪肉: 0.8, 鸡肉: 0.8, 牛肉: 0.7, 海鲜: 0.7, 河鲜: 0.7, 蔬菜: 0.7, 其他: 0.5, 主食: 0.6, 豆制品: 0.6 },
  price_sensitive: { 猪肉: 0.9, 鸡肉: 0.9, 蔬菜: 0.8, 豆制品: 0.8, 牛肉: 0.6, 海鲜: 0.5, 河鲜: 0.5, 其他: 0.5, 主食: 0.9 },
  quality_focused: { 海鲜: 0.95, 河鲜: 0.9, 牛肉: 0.8, 鸡肉: 0.7, 猪肉: 0.6, 蔬菜: 0.7, 其他: 0.5, 主食: 0.5, 豆制品: 0.5 },
};

const FRIED_WORDS = ['炸', '烤', '油'];
const RAW_WORDS = ['生腌', '刺身', '生食'];

export function normalizeDish(dish) {
  return {
    name: String(dish.name || dish.dish_name || '').trim(),
    price: Number(dish.price ?? dish.dish_price ?? 0),
    spicy: String(dish.spicy ?? dish.spicy_level ?? '').trim(),
    ingredients: Array.isArray(dish.ingredients)
      ? dish.ingredients
      : String(dish.main_ingredient || '').split('、').map((s) => s.trim()).filter(Boolean),
    methods: Array.isArray(dish.methods)
      ? dish.methods
      : String(dish.cooking_method || '').split('、').map((s) => s.trim()).filter(Boolean),
    taste: String(dish.taste ?? dish.taste_type ?? '').trim(),
    signature: dish.signature != null ? !!dish.signature : String(dish.is_signature || '否').trim() === '是',
    isNew: dish.isNew != null ? !!dish.isNew : String(dish.is_new || '否').trim() === '是',
    portion: String(dish.portion ?? dish.portion_size ?? '').trim(),
    scenes: Array.isArray(dish.scenes)
      ? dish.scenes
      : String(dish.suitable_scenes || '').split('、').map((s) => s.trim()).filter(Boolean),
  };
}

function scoreTaste(personaKey, d) {
  const p = TASTE_PROFILE[personaKey];
  let score = 70;
  const reasons = [];
  const spice = SPICE_LEVEL[d.spicy] || 1;
  if (spice > p.spicyMax) {
    score -= (spice - p.spicyMax) * 18;
    reasons.push(`辣度（${d.spicy || '不辣'}）超过该客群耐受`);
  }
  const fried = d.methods.some((m) => FRIED_WORDS.some((w) => m.includes(w)));
  if (fried && p.health >= 0.5) {
    score -= 12;
    reasons.push('做法偏油炸/烧烤，健康感不足');
  }
  const raw = d.methods.some((m) => RAW_WORDS.some((w) => m.includes(w)));
  if (raw && !p.rawOk) {
    score -= 20;
    reasons.push('生食类做法，老人/孩子接受度低');
  }
  if (d.ingredients.length) {
    const aff = INGREDIENT_AFFINITY[personaKey] || {};
    const best = Math.max(...d.ingredients.map((i) => aff[i] ?? 0.5));
    score = Math.round(score * (0.4 + best * 0.6));
  }
  return { score: Math.max(10, Math.min(100, score)), reasons };
}

function scorePrice(personaKey, d, avgPrice) {
  const persona = PERSONA_ARCHETYPES[personaKey];
  const budget = persona.price_mind?.budget_limit || 'flexible';
  const ratio = avgPrice > 0 ? d.price / avgPrice : 1;
  let score;
  if (budget === 'strict') score = ratio <= 0.95 ? 90 : ratio <= 1.1 ? 68 : ratio <= 1.3 ? 45 : 18;
  else if (budget === 'unlimited') score = ratio <= 1.6 ? 90 : 72;
  else score = ratio <= 1.15 ? 90 : ratio <= 1.4 ? 70 : 42;
  const reasons = [];
  if (d.signature && (personaKey === 'business_banquet' || personaKey === 'repeat_member')) {
    score += 8;
    reasons.push('招牌菜提升该客群的价值感');
  }
  if (score < 60) reasons.push(`价格 ${d.price} 元超出该客群预算接受度`);
  return { score: Math.max(10, Math.min(100, score)), reasons };
}

function scoreScene(personaKey, d) {
  const want = TASTE_PROFILE[personaKey].scene;
  if (!d.scenes.length) return { score: 65, reasons: [] };
  const hit = d.scenes.includes(want);
  return hit
    ? { score: 90, reasons: [] }
    : { score: 40, reasons: [`适合场景不含「${want}」，该客群可能不会点`] };
}

/**
 * 匹配一道菜与 6 类客群。
 * @param {{dish: object, avgPrice: number}} param
 */
export function matchDishToPersonas({ dish, avgPrice = 60 }) {
  const d = normalizeDish(dish);
  const rows = [];
  for (const key of PERSONA_KEYS) {
    const taste = scoreTaste(key, d);
    const price = scorePrice(key, d, avgPrice);
    const scene = scoreScene(key, d);
    const total = Math.round(0.35 * taste.score + 0.35 * price.score + 0.3 * scene.score);
    const reasons = [...taste.reasons, ...price.reasons, ...scene.reasons];
    rows.push({
      persona_key: key,
      label: PERSONA_ARCHETYPES[key].label,
      fit: total >= 75 ? '适合' : total >= 55 ? '一般' : '不适合',
      score: total,
      reasons: reasons.slice(0, 4),
    });
  }
  const mainSegments = rows.filter((r) => r.fit === '适合').map((r) => r.label);
  const riskSegments = rows.filter((r) => r.fit === '不适合').map((r) => ({ label: r.label, reasons: r.reasons }));
  const suggested = suggestPrice(d, rows, avgPrice);
  return {
    dish: d,
    personas: rows,
    main_segments: mainSegments,
    risk_segments: riskSegments,
    suggested_price: suggested,
  };
}

function suggestPrice(d, rows, avgPrice) {
  const good = rows.filter((r) => r.fit !== '不适合');
  const base = good.length >= 3 ? avgPrice : d.price;
  return {
    low: Math.max(10, Math.round(base * 0.85)),
    high: Math.max(10, Math.round(base * 1.35)),
    basis: '模型推断',
  };
}
