/**
 * 菜品测试数据同步（飞书 → Postgres）：
 * 1) 堂食菜品库属性列 → dish_library_costs（价格/成本一并刷新）
 * 2) 新品研发记录表 → customer_twin_new_dish_records
 * 凭据：BITABLE_TASK_RESP（对该多维表格有完整权限），回退 FEISHU。
 */

import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'customer-twin', handler: 'feishu-dish-sync' });
const BASE = 'https://open.feishu.cn/open-apis';
const APP = 'PTWrbUdcbarCshst0QncMoY7nKe';
const DISH_TABLE = 'tbltSvY7SBTr3Sw8';
const NEW_DISH_TABLE = 'tblIhzv1kh3WrdoX';

function credentials() {
  return {
    appId: process.env.BITABLE_TASK_RESP_APP_ID || process.env.FEISHU_APP_ID || '',
    appSecret: process.env.BITABLE_TASK_RESP_APP_SECRET || process.env.FEISHU_APP_SECRET || '',
  };
}

export async function getFeishuAccessToken({ appId, appSecret } = credentials()) {
  if (!appId || !appSecret) throw new Error('missing_feishu_credentials');
  const r = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`feishu_token_failed: ${j.msg}`);
  return j.tenant_access_token;
}

export async function fetchAllRecords(token, tableId) {
  const items = [];
  let pageToken = '';
  do {
    const url = `${BASE}/bitable/v1/apps/${APP}/tables/${tableId}/records/search`;
    const body = { page_size: 200 };
    if (pageToken) body.page_token = pageToken;
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.code !== 0) throw new Error(`feishu_records_failed(${tableId}): ${j.msg}`);
    items.push(...(j.data?.items || []));
    pageToken = j.data?.page_token || '';
  } while (pageToken);
  return items;
}

export function textOf(fields, names) {
  for (const n of names) {
    const v = fields?.[n];
    if (v == null) continue;
    if (Array.isArray(v)) {
      const t = v.map((x) => (x && typeof x === 'object' ? x.text : x)).filter((x) => x != null).join('');
      if (t) return String(t).trim();
      continue;
    }
    if (typeof v === 'object') {
      const t = v.text || v.name || '';
      if (t) return String(t).trim();
      continue;
    }
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

export function multiOf(fields, names) {
  for (const n of names) {
    const v = fields?.[n];
    if (v == null) continue;
    const arr = Array.isArray(v) ? v : [v];
    const parts = arr
      .map((x) => (x && typeof x === 'object' ? x.text || x.name : x))
      .filter((x) => x != null && String(x).trim())
      .map((x) => String(x).trim());
    if (parts.length) return parts.join('、');
  }
  return '';
}

export function numOf(fields, names) {
  for (const n of names) {
    const v = fields?.[n];
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (typeof v[0] === 'object' && v[0] != null) {
        const t = Number(v[0].text);
        if (Number.isFinite(t)) return t;
      }
      const t = Number(v[0]);
      if (Number.isFinite(t)) return t;
      continue;
    }
    const t = Number(v);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

export function dateOf(fields, names) {
  for (const n of names) {
    const v = fields?.[n];
    if (v == null) continue;
    const raw = Array.isArray(v) ? (v[0] && v[0].text != null ? v[0].text : v[0]) : v;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

export function extractDishAttributes(fields) {
  return {
    spicy_level: textOf(fields, ['辣度']),
    main_ingredient: multiOf(fields, ['主食材']),
    cooking_method: multiOf(fields, ['做法']),
    taste_type: textOf(fields, ['口味类型']),
    is_signature: textOf(fields, ['是否招牌']),
    is_new: textOf(fields, ['是否新品']),
    portion_size: textOf(fields, ['分量感']),
    suitable_scenes: multiOf(fields, ['适合场景']),
  };
}

export function extractNewDishRecord(record) {
  const f = record.fields || {};
  return {
    record_id: record.record_id,
    dish_name: textOf(f, ['菜品名', '菜品名称']),
    brand: textOf(f, ['品牌']),
    dev_date: dateOf(f, ['研发日期']),
    dev_by: textOf(f, ['研发人']),
    cost: numOf(f, ['成本', '菜品成本']),
    planned_price: numOf(f, ['拟定售价']),
    status: textOf(f, ['状态']),
    linked_dish: multiOf(f, ['关联菜品库']),
    selling_points: textOf(f, ['卖点/备注', '卖点备注']),
    tasting_date: dateOf(f, ['试菜日期']),
    tasting_participants: multiOf(f, ['试菜参与角色']),
    boss_opinion: textOf(f, ['老板意见']),
    ops_opinion: textOf(f, ['营运意见']),
    manager_opinion: textOf(f, ['店长/出品经理意见', '店长意见']),
    tasting_conclusion: textOf(f, ['试菜结论']),
    adjustment: textOf(f, ['调整内容']),
    retest: textOf(f, ['是否复测']),
    launch_date: dateOf(f, ['上新日期']),
    launch_stores: multiOf(f, ['上新门店']),
    promo_channels: multiOf(f, ['推广渠道']),
    sales_30d: numOf(f, ['上新30天实际销量（份）', '上新30天销量（份）']),
    review_summary_30d: textOf(f, ['上新30天评价摘要']),
    remark: textOf(f, ['备注']),
  };
}

export async function syncDishData(pool) {
  const token = await getFeishuAccessToken();
  const [dishRecords, newDishRecords] = await Promise.all([
    fetchAllRecords(token, DISH_TABLE),
    fetchAllRecords(token, NEW_DISH_TABLE),
  ]);

  let dishUpserted = 0;
  for (const record of dishRecords) {
    const f = record.fields || {};
    const name = textOf(f, ['菜品名称', '菜品名']);
    if (!name) continue;
    const brand = textOf(f, ['品牌']) || '*';
    const price = numOf(f, ['堂食售价', '堂食价格']);
    const cost = numOf(f, ['菜品成本', '堂食成本']);
    if (price == null && cost == null) continue;
    const attrs = extractDishAttributes(f);
    await pool.query(
      `INSERT INTO dish_library_costs
         (store, brand, biz_type, dish_name, dish_price, unit_cost, source_data, source_record_id,
          spicy_level, main_ingredient, cooking_method, taste_type, is_signature, is_new,
          portion_size, suitable_scenes, enabled, updated_at, tenant_id)
       VALUES ('*',$1,'dinein',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,NOW(),'default')
       ON CONFLICT (brand, biz_type, dish_name, tenant_id)
       DO UPDATE SET
         dish_price = EXCLUDED.dish_price,
         unit_cost = EXCLUDED.unit_cost,
         source_data = EXCLUDED.source_data,
         source_record_id = EXCLUDED.source_record_id,
         spicy_level = EXCLUDED.spicy_level,
         main_ingredient = EXCLUDED.main_ingredient,
         cooking_method = EXCLUDED.cooking_method,
         taste_type = EXCLUDED.taste_type,
         is_signature = EXCLUDED.is_signature,
         is_new = EXCLUDED.is_new,
         portion_size = EXCLUDED.portion_size,
         suitable_scenes = EXCLUDED.suitable_scenes,
         enabled = TRUE,
         updated_at = NOW()`,
      [
        brand, name, price, cost, JSON.stringify(f), record.record_id,
        attrs.spicy_level, attrs.main_ingredient, attrs.cooking_method, attrs.taste_type,
        attrs.is_signature, attrs.is_new, attrs.portion_size, attrs.suitable_scenes,
      ]
    );
    dishUpserted += 1;
  }

  let newDishUpserted = 0;
  for (const record of newDishRecords) {
    const row = extractNewDishRecord(record);
    if (!row.dish_name && !row.status) continue;
    await pool.query(
      `INSERT INTO customer_twin_new_dish_records
         (record_id, dish_name, brand, dev_date, dev_by, cost, planned_price, status, linked_dish,
          selling_points, tasting_date, tasting_participants, boss_opinion, ops_opinion,
          manager_opinion, tasting_conclusion, adjustment, retest, launch_date, launch_stores,
          promo_channels, sales_30d, review_summary_30d, remark, synced_at, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),'default')
       ON CONFLICT (record_id) DO UPDATE SET
         dish_name=EXCLUDED.dish_name, brand=EXCLUDED.brand, dev_date=EXCLUDED.dev_date,
         dev_by=EXCLUDED.dev_by, cost=EXCLUDED.cost, planned_price=EXCLUDED.planned_price,
         status=EXCLUDED.status, linked_dish=EXCLUDED.linked_dish,
         selling_points=EXCLUDED.selling_points, tasting_date=EXCLUDED.tasting_date,
         tasting_participants=EXCLUDED.tasting_participants,
         boss_opinion=EXCLUDED.boss_opinion, ops_opinion=EXCLUDED.ops_opinion,
         manager_opinion=EXCLUDED.manager_opinion,
         tasting_conclusion=EXCLUDED.tasting_conclusion, adjustment=EXCLUDED.adjustment,
         retest=EXCLUDED.retest, launch_date=EXCLUDED.launch_date,
         launch_stores=EXCLUDED.launch_stores, promo_channels=EXCLUDED.promo_channels,
         sales_30d=EXCLUDED.sales_30d, review_summary_30d=EXCLUDED.review_summary_30d,
         remark=EXCLUDED.remark, synced_at=NOW()`,
      [
        row.record_id, row.dish_name, row.brand, row.dev_date, row.dev_by, row.cost,
        row.planned_price, row.status, row.linked_dish, row.selling_points, row.tasting_date,
        row.tasting_participants, row.boss_opinion, row.ops_opinion, row.manager_opinion,
        row.tasting_conclusion, row.adjustment, row.retest, row.launch_date, row.launch_stores,
        row.promo_channels, row.sales_30d, row.review_summary_30d, row.remark,
      ]
    );
    newDishUpserted += 1;
  }

  log.info({ msg: 'customer_twin_dish_sync_done', dishes: dishRecords.length, dish_upserted: dishUpserted, new_dish_records: newDishRecords.length, new_dish_upserted: newDishUpserted });
  return { ok: true, dishes: dishRecords.length, dish_upserted: dishUpserted, new_dish_records: newDishRecords.length, new_dish_upserted: newDishUpserted };
}
