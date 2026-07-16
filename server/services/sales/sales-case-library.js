/**
 * 销售案例素材库
 */
import { ensureSalesTables } from './sales-store.js';

let caseEnsurePromise = null;

async function ensureCaseTables(pool) {
  if (caseEnsurePromise) return caseEnsurePromise;
  caseEnsurePromise = (async () => {
    await ensureSalesTables(pool);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_case_assets (
        id BIGSERIAL PRIMARY KEY,
        case_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        theme TEXT NOT NULL,
        pain_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        summary TEXT,
        body TEXT NOT NULL,
        suggested_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'active',
        sort_order INT NOT NULL DEFAULT 100,
        external_approved BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`ALTER TABLE sales_case_assets ADD COLUMN IF NOT EXISTS external_approved BOOLEAN NOT NULL DEFAULT true`);
  })().catch((e) => { caseEnsurePromise = null; throw e; });
  return caseEnsurePromise;
}

export async function listCaseAssets(pool, { theme, pain, limit = 50, externalOnly = false } = {}) {
  await ensureCaseTables(pool);
  let sql = `SELECT * FROM sales_case_assets WHERE status='active'`;
  const params = [];
  // external_use_allowed/anonymized 默认false，需要人工逐条标记才会被客户AI推荐——这是本批
  // 明确要求的行为变化："旧数据默认不得自动视为允许外部展示"，即便此前external_approved
  // 字段默认true、案例已经在正常展示，这里也不做兼容回退，宁可客户AI暂时没有案例可引用。
  if (externalOnly) sql += ` AND external_use_allowed = true AND anonymized = true`;
  if (theme) {
    params.push(`%${theme}%`);
    sql += ` AND (theme ILIKE $${params.length} OR title ILIKE $${params.length})`;
  }
  if (pain) {
    params.push(pain);
    sql += ` AND pain_tags ? $${params.length}`;
  }
  params.push(limit);
  sql += ` ORDER BY sort_order ASC, id ASC LIMIT $${params.length}`;
  const r = await pool.query(sql, params);
  return r.rows || [];
}

export async function getCaseAsset(pool, caseKey) {
  await ensureCaseTables(pool);
  const r = await pool.query(`SELECT * FROM sales_case_assets WHERE case_key=$1 LIMIT 1`, [caseKey]);
  return r.rows?.[0] || null;
}

export async function matchCasesForLead(lead = {}) {
  const pain = String(lead.extracted?.pain_point || (lead.pain_points || [])[0] || '').trim();
  const tags = [];
  if (/复购|老客|流失|回店/.test(pain)) tags.push('复购', '老客', '流失');
  if (/执行|店长|督导/.test(pain)) tags.push('执行', '店长');
  if (/营业额|下降|归因/.test(pain)) tags.push('营业额', '下降');
  return { pain, tags };
}

/** 只推荐已标记"允许对外使用"的案例——这些结果会被客户AI/销售提案直接展示给潜在客户 */
export async function recommendCasesForLead(pool, lead = {}) {
  const { pain, tags } = await matchCasesForLead(lead);
  const all = await listCaseAssets(pool, { limit: 30, externalOnly: true });
  const scored = all.map((c) => {
    const pt = Array.isArray(c.pain_tags) ? c.pain_tags : JSON.parse(c.pain_tags || '[]');
    let score = 0;
    for (const t of tags) if (pt.some((p) => String(p).includes(t) || String(t).includes(p))) score += 2;
    if (pain && (c.theme.includes(pain) || c.title.includes(pain))) score += 3;
    return { ...c, _score: score };
  });
  return scored.sort((a, b) => b._score - a._score).slice(0, 5);
}

export function formatCaseForSend(caseRow) {
  if (!caseRow) return '';
  return `【${caseRow.title}】\n${caseRow.summary || ''}\n\n${caseRow.body || ''}`.trim();
}

/** 客户AI对话内嵌用的一句话案例佐证，控制在40字内避免把诊断话术挤爆 */
export function formatCaseBlurb(caseRow) {
  if (!caseRow) return '';
  const gist = String(caseRow.summary || caseRow.title || '').trim();
  return gist.length > 36 ? `${gist.slice(0, 36)}…` : gist;
}
