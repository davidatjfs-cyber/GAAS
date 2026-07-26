/**
 * Unified table-visit row loaders (P2 peel from agents.js).
 */
import { feishuStoreSearchPatterns, feishuTableRowMatches } from '../../v2-store-alignment.js';
import {
  extractTableVisitDishes,
  extractTableVisitSatisfactionFromFields,
  tableVisitRowIsDissatisfied,
} from './table-visit-metrics-pure.js';

export async function loadUnifiedTableVisitRowsByStore(deps, store, startDate, endDate) {
  const {
    pool,
    bitableConfigs,
    normalizeBitableDateValue,
    extractDissatisfactionDishFromFields,
    extractDissatisfactionReasonFromFields,
    extractBitableFieldText,
    inDateRangeInclusive,
  } = deps;

  if (!String(store || '').trim()) return [];
  const pats = feishuStoreSearchPatterns(store);

  // 1) Structured table first（门店过滤与 agents-service-v2 的 ILIKE ANY 口径一致）
  let structured = [];
  try {
    let r;
    try {
      r = await pool().query(
        `SELECT date::text AS date, store, dissatisfaction_dish, unsatisfied_items,
                COALESCE(satisfaction_level::text, '') AS satisfaction_level
         FROM table_visit_records
         WHERE date >= $1::date
           AND date <= $2::date
           AND store ILIKE ANY($3::text[])
         ORDER BY date DESC
         LIMIT 5000`,
        [startDate, endDate, pats]
      );
    } catch (_colErr) {
      r = await pool().query(
        `SELECT date::text AS date, store, dissatisfaction_dish, unsatisfied_items, ''::text AS satisfaction_level
         FROM table_visit_records
         WHERE date >= $1::date
           AND date <= $2::date
         ORDER BY date DESC
         LIMIT 5000`,
        [startDate, endDate]
      );
    }
    const candidates = Array.isArray(r.rows) ? r.rows : [];
    structured = candidates.filter((row) => feishuTableRowMatches(store, row?.store));
  } catch (e) {
    structured = [];
  }
  if (structured.length) return structured;

  // 2) Fallback to generic sync cache（与 V2 一致的门店匹配，不再混用 isLikely 宽松规则）
  try {
    const tableId = String(bitableConfigs?.table_visit?.tableId || '').trim();
    if (!tableId) return [];

    const g = await pool().query(
      `SELECT record_id, fields, created_at
       FROM feishu_generic_records
       WHERE table_id = $1
       ORDER BY updated_at DESC
       LIMIT 2000`,
      [tableId]
    );

    const seenRecordIds = new Set();
    const out = [];
    for (const row of (g.rows || [])) {
      const recordId = String(row?.record_id || '').trim();
      if (!recordId || seenRecordIds.has(recordId)) continue;
      seenRecordIds.add(recordId);
      const fields = row?.fields && typeof row.fields === 'object' ? row.fields : {};
      const rowStore = String(fields['所属门店'] || fields['门店'] || '').trim();
      if (!feishuTableRowMatches(store, rowStore)) continue;
      const date = normalizeBitableDateValue(
        fields['记录日期'] || fields['提交时间'] || fields['日期'] || fields['营业日期'],
        row?.created_at
      );
      if (!inDateRangeInclusive(date, startDate, endDate)) continue;
      out.push({
        date,
        dissatisfaction_dish: extractDissatisfactionDishFromFields(fields),
        unsatisfied_items: extractDissatisfactionReasonFromFields(fields),
        satisfaction_level: extractTableVisitSatisfactionFromFields(fields, extractBitableFieldText)
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

export async function loadTableVisitMetricsByStore(deps, store, startDate, endDate) {
  const {
    normalizeStoreKey,
    normProductKey,
    loadUnifiedTableVisitRowsByStore: loadUnified,
  } = deps;

  const out = {
    countByDate: new Map(),
    dissatisfiedProducts: new Map(),
    dissatisfiedByDate: new Map(),
    productLabelByKey: new Map()
  };
  try {
    const normalizedStore = normalizeStoreKey(store);
    if (!normalizedStore) return out;

    const rows = await loadUnified(store, startDate, endDate);
    for (const row of rows) {
      const d = String(row?.date || '').slice(0, 10);
      if (!d) continue;
      out.countByDate.set(d, (out.countByDate.get(d) || 0) + 1);

      if (!tableVisitRowIsDissatisfied(row)) continue;
      extractTableVisitDishes(row).forEach((product) => {
        if (/卤鹅/.test(String(product || ''))) return;
        const productKey = normProductKey(product);
        if (!productKey) return;
        const key = `${normalizedStore}||${productKey}`;
        out.dissatisfiedProducts.set(key, (out.dissatisfiedProducts.get(key) || 0) + 1);
        if (!out.productLabelByKey.has(productKey)) out.productLabelByKey.set(productKey, product);
        const dateSet = out.dissatisfiedByDate.get(d) || new Set();
        dateSet.add(productKey);
        out.dissatisfiedByDate.set(d, dateSet);
      });
    }
  } catch (e) {
    // table may not exist in some envs; keep auditor running
  }
  return out;
}

