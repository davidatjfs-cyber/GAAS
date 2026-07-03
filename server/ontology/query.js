/**
 * Ontology Query — 基于 objects.js 注册表的统一只读查询
 *
 * 安全边界：table/keyField 只能来自 OBJECT_REGISTRY（硬编码白名单），
 * 绝不拼接请求里的字段名，杜绝 SQL 注入。租户隔离交给 pool 本身
 * （utils/database.js#wrapPoolForTenantContext 已按会话自动 SET app.tenant_id）。
 */

import { getObject } from './objects.js';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

/**
 * 构造安全的 SELECT 语句，不做任何字符串拼接以外的输入直接进 SQL。
 * filters 的 key 必须在 def.filterableFields 白名单里，否则直接抛错——
 * 绝不把调用方传来的字段名直接拼进 SQL。
 */
export function buildObjectQuery(type, { id, limit, filters, sinceDays } = {}) {
  const def = getObject(type); // 未知 type 直接抛错，白名单校验
  const safeLimit = clampLimit(limit);

  if (id !== undefined && id !== null && id !== '') {
    return {
      sql: `SELECT * FROM ${def.table} WHERE ${def.keyField} = $1 LIMIT $2`,
      params: [id, safeLimit],
    };
  }

  const where = [];
  const params = [];
  for (const [field, value] of Object.entries(filters || {})) {
    if (!(def.filterableFields || []).includes(field)) {
      throw new Error(`ontology: "${field}" is not a filterable field on object type "${type}"`);
    }
    params.push(value);
    where.push(`${field} = $${params.length}`);
  }
  if (sinceDays !== undefined && sinceDays !== null) {
    if (!def.dateField) {
      throw new Error(`ontology: object type "${type}" has no dateField configured for sinceDays filtering`);
    }
    params.push(Math.max(1, Math.floor(Number(sinceDays) || 0)));
    where.push(`${def.dateField} > NOW() - ($${params.length}::int * INTERVAL '1 day')`);
  }

  params.push(safeLimit);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')} ` : '';
  const orderSql = def.dateField ? `ORDER BY ${def.dateField} DESC ` : '';
  return {
    sql: `SELECT * FROM ${def.table} ${whereSql}${orderSql}LIMIT $${params.length}`,
    params,
  };
}

export async function queryObject(pool, type, options = {}) {
  const { sql, params } = buildObjectQuery(type, options);
  const result = await pool.query(sql, params);
  return result.rows;
}
