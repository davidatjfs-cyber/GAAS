/**
 * information_schema column existence check (no DDL).
 */

export function createHasColumnHelpers({ pool }) {
  async function hasColumn(tableName, columnName) {
    const t = String(tableName || '').trim();
    const c = String(columnName || '').trim();
    if (!t || !c) return false;
    const r = await pool.query(
      `select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = $1
         and column_name = $2
       limit 1`,
      [t, c]
    );
    return (r.rows || []).length > 0;
  }

  return { hasColumn };
}
