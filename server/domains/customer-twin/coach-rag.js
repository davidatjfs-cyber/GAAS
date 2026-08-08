/**
 * 教练知识检索：从 knowledge_base 按技能标签/分类/关键词取知识片段。
 */

export async function retrieveCoachKnowledge(pool, { skillLabel = '', brand = '', keywords = '', limit = 4 } = {}) {
  const r = await pool.query(
    `SELECT title, content, tags
       FROM knowledge_base
      WHERE enabled = TRUE
        AND (
          ($1::text <> '' AND (tags @> ARRAY[$1]::text[] OR category = $1))
          OR ($2::text <> '' AND tags @> ARRAY[$2]::text[])
          OR (category IN ('菜品知识', '岗位教练'))
        )
        AND ($3 = '' OR content ILIKE '%' || $3 || '%' OR title ILIKE '%' || $3 || '%')
      ORDER BY CASE WHEN tags @> ARRAY[$1]::text[] THEN 0 ELSE 1 END, created_at DESC
      LIMIT $4`,
    [String(skillLabel || ''), String(brand || ''), String(keywords || ''), Math.min(limit, 8)]
  );
  return (r.rows || []).map((row) => ({
    title: row.title,
    content: String(row.content || '').slice(0, 800),
    tags: row.tags || [],
  }));
}
