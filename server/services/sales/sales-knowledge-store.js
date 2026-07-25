/**
 * 客户AI知识库：数据库可编辑版本，供后台"知识库编辑"页维护。
 * DB为空或查询失败时，一律回退到 sales-knowledge.js 里的内置默认值，
 * 保证客户AI不会因为这张表的问题而失去知识内容。
 */
import { PUBLIC_KNOWLEDGE } from './sales-knowledge.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales', handler: 'knowledge-store' });

let ensured = false;
async function ensureTable(pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_knowledge_items (
      id BIGSERIAL PRIMARY KEY,
      item_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pain_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  ensured = true;
}

let cache = null;
let cacheAt = 0;
const CACHE_TTL_MS = 30_000;

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

/** 客户AI实际对话时用：带缓存，active条目按sort_order排序；DB为空/异常时回退内置默认值。 */
export async function loadKnowledgeItems(pool) {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  try {
    await ensureTable(pool);
    const r = await pool.query(
      `SELECT item_key AS id, title, body, pain_keys FROM sales_knowledge_items WHERE active=TRUE ORDER BY sort_order ASC, id ASC`
    );
    const rows = (r.rows || []).map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      pain_keys: Array.isArray(row.pain_keys) ? row.pain_keys : [],
    }));
    cache = rows.length ? rows : PUBLIC_KNOWLEDGE;
    cacheAt = Date.now();
    return cache;
  } catch (e) {
    log.warn({ msg: 'load_knowledge_items_failed_using_defaults', err: e?.message || String(e) });
    return PUBLIC_KNOWLEDGE;
  }
}

/** 后台编辑页用：列出全部条目(含未启用)，不走缓存。 */
export async function listKnowledgeItemsAdmin(pool) {
  await ensureTable(pool);
  const r = await pool.query(
    `SELECT id, item_key, title, body, pain_keys, active, sort_order, updated_at FROM sales_knowledge_items ORDER BY sort_order ASC, id ASC`
  );
  return r.rows || [];
}

export async function upsertKnowledgeItem(pool, { id, item_key, title, body, pain_keys, active, sort_order }) {
  await ensureTable(pool);
  const key = String(item_key || '').trim();
  if (!key) throw new Error('item_key_required');
  const painKeysJson = JSON.stringify(Array.isArray(pain_keys) ? pain_keys : []);
  let r;
  if (id) {
    r = await pool.query(
      `UPDATE sales_knowledge_items
          SET item_key=$2, title=$3, body=$4, pain_keys=$5::jsonb,
              active=COALESCE($6, active), sort_order=COALESCE($7, sort_order), updated_at=NOW()
        WHERE id=$1 RETURNING *`,
      [id, key, title, body, painKeysJson, active, sort_order]
    );
  } else {
    r = await pool.query(
      `INSERT INTO sales_knowledge_items (item_key, title, body, pain_keys, active, sort_order)
       VALUES ($1,$2,$3,$4::jsonb,COALESCE($5,TRUE),COALESCE($6,0))
       ON CONFLICT (item_key) DO UPDATE
         SET title=EXCLUDED.title, body=EXCLUDED.body, pain_keys=EXCLUDED.pain_keys,
             active=EXCLUDED.active, sort_order=EXCLUDED.sort_order, updated_at=NOW()
       RETURNING *`,
      [key, title, body, painKeysJson, active, sort_order]
    );
  }
  invalidateCache();
  return r.rows?.[0] || null;
}

export async function deleteKnowledgeItem(pool, id) {
  await ensureTable(pool);
  await pool.query(`DELETE FROM sales_knowledge_items WHERE id=$1`, [id]);
  invalidateCache();
}
