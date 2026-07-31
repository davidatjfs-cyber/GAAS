/**
 * P3：经营数据真题人格 —— 用真实/半真实经营数字生成「必须会答」的客户。
 */

import { upsertBusinessPersona } from './personas.js';

export function buildBusinessPersonaSpec({
  brandName = '某品牌',
  city = '上海',
  cuisine = '粤菜',
  stores = 3,
  pos = '二维火',
  members = 12000,
  repurchaseRate = 0.18,
  dailyRevenue = 30000,
  pain = '复购偏弱',
  leadId = null,
} = {}) {
  const pct = Math.round(Number(repurchaseRate) * 1000) / 10;
  const key = `biz_${String(brandName).replace(/\W+/g, '_').slice(0, 24)}_${stores}s_${pct}r`;
  const opening = [
    `我是${brandName}，${city}${cuisine}，${stores}家店，POS是${pos}。`,
    `会员大约${members}人，复购率大概${pct}%。`,
    `你一直说AI增长——那你告诉我，针对我现在「${pain}」，你第一步准备怎么帮我？别讲功能清单。`,
  ].join('');

  return {
    persona_key: key.slice(0, 80),
    track: 'sales',
    title: `经营真题 · ${brandName}（复购${pct}%）`,
    difficulty: 6,
    audience: 'internal',
    source_type: 'business',
    opening_line: opening,
    profile: {
      brand_name: brandName,
      city,
      cuisine,
      stores: Number(stores) || 1,
      pos,
      members: Number(members) || 0,
      repurchase_rate: Number(repurchaseRate) || 0,
      daily_revenue: Number(dailyRevenue) || 0,
      pain,
      lead_id: leadId,
      traits: ['经营真题', '要数字方案', '不吃功能介绍'],
      objections: ['ask_features', 'ai_useless', 'too_expensive'],
      business_question: `${pain}；复购率${pct}%第一步怎么做`,
    },
  };
}

export async function createBusinessPersonaFromPayload(pool, body = {}) {
  const spec = buildBusinessPersonaSpec(body);
  const row = await upsertBusinessPersona(pool, spec);
  return { ok: true, persona: row };
}

/** 从销售线索档案生成真题人格（若字段齐全） */
export async function createBusinessPersonaFromLead(pool, leadId) {
  const r = await pool.query(`SELECT * FROM sales_leads WHERE id=$1`, [leadId]);
  const lead = r.rows?.[0];
  if (!lead) return { ok: false, error: 'lead_not_found' };

  const brands = Array.isArray(lead.customer_brands) ? lead.customer_brands : [];
  const brand0 = brands[0] || {};
  const dossier = lead.meta && typeof lead.meta === 'object' ? lead.meta : {};

  const spec = buildBusinessPersonaSpec({
    brandName: brand0.brand_name || lead.company || lead.name || '线索客户',
    city: brand0.city || lead.city || '未知城市',
    cuisine: lead.cuisine || dossier.cuisine || '餐饮',
    stores: brand0.store_count || lead.store_count || 1,
    pos: lead.pos_brand || '未知POS',
    members: Number(dossier.members || lead.member_estimate || 5000),
    repurchaseRate: Number(dossier.repurchase_rate || 0.15),
    dailyRevenue: Number(dossier.daily_revenue || 20000),
    pain: lead.pain_point || '复购与执行不稳定',
    leadId: lead.id,
  });

  const row = await upsertBusinessPersona(pool, spec);
  return { ok: true, persona: row, lead_id: lead.id };
}
