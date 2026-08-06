/**
 * 风险预判器（阶段 1）：基于菜品属性规则 + 真实语料证据，输出"哪类客群最可能吐槽什么"。
 */

import { normalizeDish } from './dish-match.js';

const RAW_WORDS = ['生腌', '刺身', '生食'];
const FRIED_WORDS = ['炸', '烤'];
const SPICE_WORDS = ['中辣', '重辣', '变态辣'];
const PORTION_SMALL = ['小'];

const RISK_RULES = [
  {
    id: 'spicy_high',
    condition: (d) => SPICE_WORDS.includes(d.spicy),
    risk: '辣度过高',
    segment: '家庭聚餐/老人孩子',
    severity: '高',
    hint: '有老人孩子的家庭客群可能接受不了辣度，儿童友好度低',
  },
  {
    id: 'raw_dish',
    condition: (d) => d.methods.some((m) => RAW_WORDS.some((w) => m.includes(w))),
    risk: '生食接受度',
    segment: '家庭聚餐/健康意识客群',
    severity: '高',
    hint: '生腌/刺身类做法：老人、孩子、肠胃敏感客群顾虑大',
  },
  {
    id: 'oily_fried',
    condition: (d) => d.methods.some((m) => FRIED_WORDS.some((w) => m.includes(w))),
    risk: '油腻/健康感',
    segment: '品质型/健康意识客群',
    severity: '中',
    hint: '油炸/烧烤类做法，品质型客群可能吐槽"太油"',
  },
  {
    id: 'portion_small',
    condition: (d) => PORTION_SMALL.includes(d.portion),
    risk: '分量不足',
    segment: '家庭聚餐/价格敏感客群',
    severity: '中',
    hint: '分量感小，家庭与价格敏感客群容易觉得"不值"',
  },
  {
    id: 'price_high',
    condition: (d, ctx) => ctx.avgPrice > 0 && d.price > ctx.avgPrice * 1.35,
    risk: '价格偏高',
    segment: '价格敏感客群',
    severity: '高',
    hint: '价格明显高于店均水平，价格敏感客群可能吐槽"性价比低"',
  },
  {
    id: 'expensive_not_signature',
    condition: (d, ctx) => !d.signature && ctx.avgPrice > 0 && d.price > ctx.avgPrice * 1.5,
    risk: '高价非招牌',
    segment: '商务宴请客群',
    severity: '中',
    hint: '价格高但不是招牌菜，商务客群可能觉得"不够有面子"',
  },
  {
    id: 'new_dish_unknown',
    condition: (d) => d.isNew,
    risk: '新品不确定性',
    segment: '保守客群/老会员',
    severity: '低',
    hint: '新品对保守客群有试错顾虑，需要试菜验证口味稳定性',
  },
];

const EVIDENCE_KEYWORDS = [
  { kw: ['分量', '少'], risk: '分量不足' },
  { kw: ['咸'], risk: '口味偏咸' },
  { kw: ['油', '腻'], risk: '油腻' },
  { kw: ['贵', '不值', '性价比'], risk: '价格偏高' },
  { kw: ['腥', '不新鲜'], risk: '食材新鲜度' },
  { kw: ['辣'], risk: '辣度过高' },
];

const RISK_CORPUS_CATEGORY = {
  spicy_high: ['dish_quality'],
  raw_dish: ['dish_quality'],
  oily_fried: ['dish_quality'],
  portion_small: ['portion'],
  price_high: ['post_visit', 'dish_quality'],
  expensive_not_signature: ['post_visit'],
  new_dish_unknown: ['dish_quality'],
};

/**
 * @param {{dish: object, avgPrice: number, corpus: Array, realComplaints: Array}} param
 */
export function buildDishRisks({ dish, avgPrice = 60, corpus = [], realComplaints = [] }) {
  const normalized = normalizeDish(dish);
  const ctx = { avgPrice };
  const risks = [];
  for (const rule of RISK_RULES) {
    if (!rule.condition(normalized, ctx)) continue;
    const evidence = [];
    const wantCat = RISK_CORPUS_CATEGORY[rule.id] || [];
    const corpusHit = (corpus || []).find((c) => c && wantCat.includes(c.category));
    if (corpusHit) evidence.push({ source: '负反馈知识库', text: String(corpusHit.content || '').slice(0, 60), code: corpusHit.code || '' });
    const match = EVIDENCE_KEYWORDS.find((e) => rule.risk.includes(e.risk));
    if (match) {
      const real = (realComplaints || []).find((t) => match.kw.some((k) => String(t).includes(k)));
      if (real) evidence.push({ source: '真实差评', text: String(real).slice(0, 80) });
    }
    risks.push({
      risk: rule.risk,
      segment: rule.segment,
      severity: rule.severity,
      hint: rule.hint,
      evidence: evidence.slice(0, 2),
      source: evidence.length ? '数据统计' : '模型推断',
    });
  }
  return risks.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === '高' ? -1 : 1)).slice(0, 5);
}
