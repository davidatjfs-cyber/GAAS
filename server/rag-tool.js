// RAG 多维知识库工具
import { pool as getPool } from './utils/database.js';
import {
  classifyProductQuery,
  PRODUCT_KNOWLEDGE_VERSION,
  PRODUCT_MODULES,
  searchProductKnowledge,
} from './services/sales/sales-product-knowledge.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'rag-tool' });
function pool() { return getPool(); }

export const KB_SCOPES = { PUBLIC: 'public', BUSINESS: 'business', SENSITIVE: 'sensitive' };

const AGENT_SCOPE_ACCESS = {
  master_agent: ['public','business','sensitive'], hr_agent: ['public','business','sensitive'],
  ref_agent: ['public','business','sensitive'], appeal_agent: ['public','business','sensitive'],
  chief_evaluator: ['public','business','sensitive'],
  bi_agent: ['public','business'], data_auditor: ['public','business'],
  op_agent: ['public','business'], ops_agent: ['public','business'],
  train_advisor: ['public','business'], sop_advisor: ['public','business']
};
const ROLE_SCOPE_ACCESS = {
  admin: ['public','business','sensitive'], hq_manager: ['public','business','sensitive'],
  hr_manager: ['public','business','sensitive'],
  store_manager: ['public','business'], store_production_manager: ['public','business'],
  store_staff: ['public']
};

function getAllowedScopes(agentName, userRole) {
  const a = AGENT_SCOPE_ACCESS[String(agentName||'').trim().toLowerCase()] || ['public'];
  const r = ROLE_SCOPE_ACCESS[String(userRole||'').trim().toLowerCase()] || ['public'];
  const x = a.filter(s => r.includes(s));
  return x.length ? x : ['public'];
}

export async function ensureRAGSchema() {
  const p = pool();
  try {
    await p.query(`DO $$ BEGIN ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS scope VARCHAR(20) DEFAULT 'public'; EXCEPTION WHEN others THEN NULL; END $$;`);
    await p.query(`DO $$ BEGIN ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS content_chunks JSONB DEFAULT '[]'::jsonb; EXCEPTION WHEN others THEN NULL; END $$;`);
    await p.query(`CREATE INDEX IF NOT EXISTS idx_kb_scope ON knowledge_base (scope);`);
    // 迁移: 敏感
    await p.query(`UPDATE knowledge_base SET scope='sensitive' WHERE (scope IS NULL OR scope='public') AND (category IN ('薪资','隐私','申诉','考核','绩效','评级') OR tags && ARRAY['hr','salary','appeal','sensitive']::text[])`);
    // 迁移: 业务
    await p.query(`UPDATE knowledge_base SET scope='business' WHERE (scope IS NULL OR scope='public') AND (category IN ('SOP','标准','流程','培训','操作手册') OR tags && ARRAY['sop','training','ops','train']::text[])`);
    await p.query(`UPDATE knowledge_base SET scope='public' WHERE scope IS NULL`);
    // B1: pg_trgm（与 migrations/011 一致；无权限时忽略）
    try {
      await p.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_kb_title_trgm ON knowledge_base USING gin (title gin_trgm_ops)`
      );
      await p.query(
        `CREATE INDEX IF NOT EXISTS idx_kb_content_trgm ON knowledge_base USING gin (content gin_trgm_ops)`
      );
      log.info({ msg: 'pg_trgm_ensured' });
    } catch (e2) {
      log.warn({ msg: 'pg_trgm_ensure_skipped', err: e2?.message });
    }
    log.info({ msg: 'rag_schema_ensured' });
  } catch (e) { log.error({ msg: 'ensure_rag_schema_failed', err: e?.message }); }
}

let trgmProbe = null;
async function kbHasTrgm() {
  if (trgmProbe !== null) return trgmProbe;
  try {
    const r = await pool().query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm' LIMIT 1`);
    trgmProbe = (r.rows || []).length > 0;
  } catch {
    trgmProbe = false;
  }
  return trgmProbe;
}

/** 与 HRMS GET /api/knowledge 一致：按 audience JSON 过滤，仅分发对象可见 */
function appendKnowledgeAudienceSql(conds, vals, idx, viewer, skip) {
  if (skip) return idx;
  const store = String(viewer?.userStore ?? viewer?.store ?? '').trim();
  const pos = String(viewer?.userPosition ?? viewer?.position ?? '').trim();
  const role = String(viewer?.userRole ?? viewer?.role ?? '').trim();
  conds.push(`(
    audience IS NULL
    OR (audience->>'type') IS NULL
    OR (audience->>'type') = 'all'
    OR (
      (audience->>'type') = 'store'
      AND (
        trim(coalesce(audience->>'store','')) = $${idx}
        OR (COALESCE(audience->'stores', '[]'::jsonb) @> jsonb_build_array($${idx}::text))
      )
    )
    OR (
      (audience->>'type') = 'position'
      AND (
        trim(coalesce(audience->>'position','')) = $${idx + 1}
        OR (COALESCE(audience->'positions', '[]'::jsonb) @> jsonb_build_array($${idx + 1}::text))
        OR (trim(coalesce(audience->>'position','')) = '系统管理员' AND $${idx + 2} = 'admin')
        OR (COALESCE(audience->'positions', '[]'::jsonb) @> '["系统管理员"]'::jsonb AND $${idx + 2} = 'admin')
      )
    )
  )`);
  vals.push(store, pos, role);
  return idx + 3;
}

export async function ragQuery(params = {}) {
  const {
    agentName,
    userRole,
    userStore,
    userPosition,
    query,
    scope,
    category,
    brandTag,
    limit = 5,
    skipKnowledgeAudienceFilter = true
  } = params;
  let allowed = getAllowedScopes(agentName, userRole);
  if (scope && allowed.includes(scope)) allowed = [scope];
  const conds = ['scope = ANY($1::text[])'], vals = [allowed];
  let idx = 2;
  idx = appendKnowledgeAudienceSql(
    conds,
    vals,
    idx,
    { userRole, userStore, userPosition },
    skipKnowledgeAudienceFilter
  );
  if (query) {
    const q = String(query || '').trim();
    const useTrgm = (await kbHasTrgm()) && q.length >= 2;
    if (useTrgm) {
      conds.push(
        `((content ILIKE $${idx} OR title ILIKE $${idx}) OR (word_similarity($${idx + 1}::text, title) > 0.17 OR word_similarity($${idx + 1}::text, COALESCE(content, '')) > 0.17))`
      );
      vals.push(`%${q}%`, q);
      idx += 2;
    } else {
      conds.push(`(content ILIKE $${idx} OR title ILIKE $${idx})`);
      vals.push(`%${q}%`);
      idx++;
    }
  }
  if (category) { conds.push(`category = $${idx}`); vals.push(category); idx++; }
  if (brandTag) { const t = brandTag.startsWith('brand:') ? brandTag : `brand:${brandTag}`; conds.push(`(tags @> ARRAY[$${idx}]::text[] OR tags @> ARRAY['brand:all']::text[])`); vals.push(t); idx++; }
  vals.push(Math.min(limit, 20));
  try {
    const r = await pool().query(
      `SELECT id,title,content,category,tags,scope,file_path,file_type,created_at,audience FROM knowledge_base WHERE ${conds.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx}`,
      vals
    );
    const databaseResults = (r.rows||[]).map(row => ({ id: row.id, title: row.title, content: String(row.content||'').slice(0,1000), category: row.category, scope: row.scope, tags: row.tags, hasFile: !!row.file_path, fileType: row.file_type }));
    const productIntent = classifyProductQuery(query);
    const includeProductManual = Boolean(query)
      && (!category || category === '系统使用手册')
      && (category === '系统使用手册' || Number(productIntent.matches[0]?.score || 0) >= 22);
    const productResults = includeProductManual
      ? searchProductKnowledge(query, { limit: Math.min(limit, 10) }).map((item) => ({
          id: `product:${item.id}`,
          title: item.title,
          content: [
            item.answer,
            item.steps.length ? `操作步骤：${item.steps.map((step, i) => `${i + 1}.${step}`).join('；')}` : '',
            `权限说明：${item.roles}`,
            item.limits ? `注意：${item.limits}` : '',
          ].filter(Boolean).join('\n'),
          category: '系统使用手册',
          scope: 'public',
          tags: ['system_manual', `module:${item.module}`, `version:${PRODUCT_KNOWLEDGE_VERSION}`],
          module: PRODUCT_MODULES[item.module],
          score: item.score,
          source: 'product_knowledge',
          hasFile: false,
          fileType: null,
        }))
      : [];
    const results = [...productResults, ...databaseResults]
      .filter((item, index, all) => all.findIndex((other) => String(other.id) === String(item.id)) === index)
      .slice(0, Math.min(limit, 20));
    return { success: true, results, accessScopes: allowed, productKnowledgeVersion: PRODUCT_KNOWLEDGE_VERSION };
  } catch (e) { log.error({ msg: 'rag_query_failed', err: e?.message }); return { success: false, results: [], error: e?.message }; }
}

export async function ragMultiQuery(params = {}) {
  const { queries = [], ...rest } = params;
  const all = [], seen = new Set();
  for (const q of queries.slice(0,5)) {
    const res = await ragQuery({ ...rest, query: q });
    if (res.success) for (const r of res.results) { if (!seen.has(r.id)) { seen.add(r.id); all.push(r); } }
  }
  return { success: true, results: all.slice(0, (rest.limit||5)*2), accessScopes: getAllowedScopes(rest.agentName, rest.userRole) };
}

export async function ragUpdateScope(id, newScope) {
  if (!Object.values(KB_SCOPES).includes(newScope)) return { success: false, error: 'invalid_scope' };
  try { await pool().query('UPDATE knowledge_base SET scope=$1,updated_at=NOW() WHERE id=$2', [newScope, id]); return { success: true }; }
  catch (e) { return { success: false, error: e?.message }; }
}

export async function ragStats() {
  try {
    const r = await pool().query(`SELECT scope,COUNT(*)::int as count FROM knowledge_base GROUP BY scope`);
    return { success: true, stats: r.rows };
  } catch (e) { return { success: false, error: e?.message }; }
}

export const RAG_TOOL_DEFINITION = {
  name: 'query_knowledge_base',
  description: '查询多维知识库。公共库含品牌愿景/通用规章；业务库含SOP/技术手册；敏感库含薪资/隐私。系统根据角色自动过滤权限。',
  parameters: { type: 'object', properties: {
    query: { type: 'string', description: '搜索关键词' },
    scope: { type: 'string', enum: ['public','business','sensitive'], description: '可选：指定范围' },
    category: { type: 'string', description: '可选：按分类过滤' }
  }, required: ['query'] }
};
