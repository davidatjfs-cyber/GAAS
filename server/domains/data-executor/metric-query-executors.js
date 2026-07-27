const SALES_RAW_COLUMN_ALIASES = {
  actual_revenue: 'revenue',
  expected_revenue: 'sales_amount',
  gross_revenue: 'sales_amount'
};

function normalizeStore(store) {
  return String(store || '').trim().toLowerCase().replace(/\s+/g, '');
}

function buildFeishuDateFilter(alias, startParamIdx = 2) {
  const fields = alias ? `${alias}.fields` : 'fields';
  const start = `$${startParamIdx}`;
  const end = `$${startParamIdx + 1}`;
  return `(
    to_timestamp((${fields}->>'日期')::bigint/1000)::date BETWEEN ${start}::date AND ${end}::date
    OR (${fields}->>'收货日期')::date BETWEEN ${start}::date AND ${end}::date
    OR (${fields}->>'创建日期')::date BETWEEN ${start}::date AND ${end}::date
    OR to_timestamp((${fields}->>'提交时间')::bigint/1000)::date BETWEEN ${start}::date AND ${end}::date
  )`;
}

function buildFeishuStoreFilter(paramIdx, alias) {
  const fields = alias ? `${alias}.fields` : 'fields';
  return `lower(regexp_replace(coalesce(${fields}->>'所属门店', ${fields}->>'门店', ''), '\\s+', '', 'g')) LIKE $${paramIdx}`;
}

function fixSalesRawColumnName(column) {
  return SALES_RAW_COLUMN_ALIASES[column] || column;
}

export function createMetricQueryExecutors(db) {
  const query = (...args) => db.query(...args);

  async function queryFeishuGenericRecords(def, start, end, store) {
    const formula = def.formula || '';
    const tableIdMatch = formula.match(/table_id\s*(?:=\s*'([^']+)'|IN\s*\(([^)]+)\))/);
    if (!tableIdMatch) return null;

    const tableIds = tableIdMatch[1]
      ? [tableIdMatch[1]]
      : tableIdMatch[2].split(',').map((id) => id.trim().replace(/'/g, ''));
    const tableIdPlaceholders = tableIds.map((_, index) => `$${index + 1}`).join(', ');
    const dateStartParamIdx = tableIds.length + 1;
    const storeParamIdx = tableIds.length + 3;

    if (/^COUNT\(\*\)/.test(formula.trim())) {
      const params = [...tableIds, start, end];
      let sql = `SELECT COUNT(*)::int AS val FROM feishu_generic_records
                 WHERE table_id IN (${tableIdPlaceholders})
                   AND ${buildFeishuDateFilter(null, dateStartParamIdx)}`;
      if (store) {
        sql += ` AND ${buildFeishuStoreFilter(storeParamIdx)}`;
        params.push(`%${normalizeStore(store)}%`);
      }
      if (formula.includes('异常原料名称')) {
        sql += ` AND fields->>'异常原料名称' IS NOT NULL AND fields->>'异常原料名称' != ''`;
      }
      const result = await query(sql, params);
      return Number(result.rows?.[0]?.val || 0);
    }

    if (/^AVG\(/.test(formula.trim())) {
      const fieldMatch = formula.match(/record_data->>'([^']+)'/) || formula.match(/fields->>'([^']+)'/);
      if (!fieldMatch) return null;
      const params = [...tableIds, start, end];
      let sql = `SELECT AVG(NULLIF(fields->>'${fieldMatch[1]}', '')::numeric)::numeric(8,2) AS val
                 FROM feishu_generic_records
                 WHERE table_id IN (${tableIdPlaceholders})
                   AND ${buildFeishuDateFilter(null, dateStartParamIdx)}
                   AND (fields->>'${fieldMatch[1]}') ~ '^[0-9.]+$'`;
      if (store) {
        sql += ` AND ${buildFeishuStoreFilter(storeParamIdx)}`;
        params.push(`%${normalizeStore(store)}%`);
      }
      const result = await query(sql, params);
      return result.rows?.[0]?.val !== null ? Number(result.rows[0].val) : null;
    }

    if (/COUNT\(CASE WHEN/.test(formula)) {
      const conditionMatch = formula.match(/(?:record_data|fields)->>'([^']+)'='([^']+)'/);
      if (!conditionMatch) return null;
      const [, field, value] = conditionMatch;
      const params = [...tableIds, start, end];
      let sql = `SELECT ROUND(
        COUNT(CASE WHEN fields->>'${field}' = '${value}' THEN 1 END)::numeric
        / NULLIF(COUNT(*), 0) * 100, 1
      ) AS val
      FROM feishu_generic_records
      WHERE table_id IN (${tableIdPlaceholders})
        AND ${buildFeishuDateFilter(null, dateStartParamIdx)}`;
      if (store) {
        sql += ` AND ${buildFeishuStoreFilter(storeParamIdx)}`;
        params.push(`%${normalizeStore(store)}%`);
      }
      const result = await query(sql, params);
      return result.rows?.[0]?.val !== null ? Number(result.rows[0].val) : null;
    }

    if (/^SUM\(COALESCE\(/.test(formula.trim())) {
      const params = [...tableIds, start, end];
      let sql = `SELECT SUM(
        COALESCE(
          NULLIF(regexp_replace(fields->>'就餐人数', '[^0-9]', '', 'g'), '')::int,
          NULLIF(regexp_replace(fields->>'人数', '[^0-9]', '', 'g'), '')::int,
          0
        )
      )::int AS val
      FROM feishu_generic_records
      WHERE table_id IN (${tableIdPlaceholders})
        AND ${buildFeishuDateFilter(null, dateStartParamIdx)}`;
      if (store) {
        sql += ` AND ${buildFeishuStoreFilter(storeParamIdx)}`;
        params.push(`%${normalizeStore(store)}%`);
      }
      const result = await query(sql, params);
      return Number(result.rows?.[0]?.val || 0);
    }

    return null;
  }

  async function querySalesRaw(def, start, end, store) {
    const formula = def.formula || '';
    const diffMatch = formula.match(/SUM\((\w+)\s*-\s*(\w+)\)/);
    if (diffMatch) {
      const params = [start, end];
      let sql = `SELECT COALESCE(SUM(${fixSalesRawColumnName(diffMatch[1])} - ${fixSalesRawColumnName(diffMatch[2])}), 0)::numeric(12,2) AS val FROM pos_sales_detail WHERE date BETWEEN $1 AND $2`;
      if (store) {
        sql += ` AND lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $3`;
        params.push(`%${normalizeStore(store)}%`);
      }
      const result = await query(sql, params);
      return Number(result.rows?.[0]?.val || 0);
    }

    const fieldMatch = formula.match(/SUM\((\w+)\)/);
    if (!fieldMatch) return null;
    const params = [start, end];
    let sql = `SELECT COALESCE(SUM(${fixSalesRawColumnName(fieldMatch[1])}), 0)::numeric(12,2) AS val FROM pos_sales_detail WHERE date BETWEEN $1 AND $2`;
    if (store) {
      sql += ` AND lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $3`;
      params.push(`%${normalizeStore(store)}%`);
    }
    const result = await query(sql, params);
    return Number(result.rows?.[0]?.val || 0);
  }

  async function queryDailyReports(def, start, end, store) {
    const formula = def.formula || '';
    const aggMatch = formula.match(/^(SUM|AVG|MAX)\((.+)\)$/i);
    if (!aggMatch) return null;

    const [, aggregate, expression] = aggMatch;
    const params = [start, end];
    let sql = `SELECT ${aggregate.toUpperCase()}(${expression})::numeric(12,2) AS val FROM daily_reports WHERE date BETWEEN $1::date AND $2::date`;
    if (store) {
      sql += ` AND lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $3`;
      params.push(`%${normalizeStore(store)}%`);
    }
    const result = await query(sql, params);
    const value = result.rows?.[0]?.val;
    return value !== null && value !== undefined ? Number(value) : null;
  }

  async function querySchedules(def, start, end, store) {
    const params = [start, end];
    let sql = `SELECT COUNT(DISTINCT employee_username)::int AS val FROM schedules WHERE shift_date BETWEEN $1 AND $2 AND status = 'present'`;
    if (store) {
      sql += ` AND lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $3`;
      params.push(`%${normalizeStore(store)}%`);
    }
    const result = await query(sql, params);
    return Number(result.rows?.[0]?.val || 0);
  }

  return {
    queryFeishuGenericRecords,
    querySalesRaw,
    queryDailyReports,
    querySchedules,
  };
}
