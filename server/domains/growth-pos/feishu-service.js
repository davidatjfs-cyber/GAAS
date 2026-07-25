/**
 * 飞书多维表格 POS 同步配置与拉取逻辑。
 */
import axios from 'axios';
import { getBrandForStoreSync } from '../../utils/brand-config-loader.js';
import { maybeNotifyRegularCustomerFromPosOrder } from '../../pos-regular-arrival-feishu.js';
import { childLogger } from '../../utils/logger.js';
import { cleanText } from '../growth-phase-auth.js';
import { linkPosOrdersToCustomers, refreshSalesGrowthSnapshot } from './ingest.js';
import { cnDate, parseKeruyunDateTime, parseKeruyunPhone, parseNum } from './keruyun.js';

const log = childLogger({ domain: 'growth-pos', handler: 'feishu-service' });

const ORDERS_FIELD_MAP = {
  编号: 'seq_no',
  订单号: 'order_no',
  订单来源: 'order_source',
  营业日: 'biz_date',
  下单时间: 'order_time',
  结账时间: 'checkout_time',
  订单状态: 'order_status',
  折前金额: 'amount_before_discount',
  总优惠金额: 'total_discount',
  折后金额: 'amount_after_discount',
  支付方式: 'payment_method',
  支付笔数: 'payment_count',
  会员姓名: 'member_name',
  会员手机号: 'phone',
  订单类型: 'order_type',
  桌台: 'table_no',
  就餐人数: 'diners',
  就餐时长: 'duration',
  '就餐时长(分钟）': 'duration',
  门店名称: 'store_name',
};

const ITEMS_FIELD_MAP = {
  营业日期: 'biz_date',
  营业日: 'biz_date',
  门店名称: 'store_name',
  菜品名称: 'dish_name',
  出品部门: 'department',
  桌台名称: 'table_name',
  桌台区域: 'table_area',
  销售类型: 'sale_type',
  菜品编码: 'sku',
  大类名称: 'category',
  中类名称: 'category_mid',
  规格: 'spec',
  单位: 'unit',
  订单号: 'order_no',
  订单类型: 'order_type',
  订单来源: 'order_source',
  销售数量: 'qty',
  折前金额: 'amount_before_discount',
  优惠金额: 'discount',
  服务费分摊收入: 'service_fee',
  折后金额: 'amount_after_discount',
  下单时间: 'order_time',
  结账时间: 'checkout_time',
};

function bitableFieldValue(val) {
  if (val == null) return val;
  return typeof val === 'object' ? val.text || val.link || val.name || JSON.stringify(val) : val;
}

function resolveOrderStoreId(o, configStoreId, tenantId) {
  const sn = cleanText(o.store_name || '', 200);
  const sid = configStoreId || cleanText(o.store_id || '', 128);
  const dbId = getBrandForStoreSync(sn, tenantId)?.storeId;
  if (dbId) return dbId;
  if (sn && sn.includes('洪潮')) return '64822111';
  if (sn && sn.includes('马己仙')) return '51866138';
  return sid;
}

function resolveItemStoreCode(it, tenantId) {
  const sn = cleanText(it.store_name || '', 200);
  const dbId = getBrandForStoreSync(sn, tenantId)?.storeId;
  if (dbId) return dbId;
  if (sn && sn.includes('洪潮')) return '64822111';
  if (sn && sn.includes('马己仙')) return '51866138';
  return cleanText(it.store_code || '', 64);
}

export function buildPosFeishuConfig(body = {}) {
  return {
    orders_app_token: cleanText(body.orders_app_token || '', 200),
    orders_table_id: cleanText(body.orders_table_id || '', 200),
    items_app_token: cleanText(body.items_app_token || '', 200),
    items_table_id: cleanText(body.items_table_id || '', 200),
    store_id: cleanText(body.store_id || '', 128),
    app_id: cleanText(body.app_id || '', 80),
    app_secret: cleanText(body.app_secret || '', 200),
  };
}

export async function getPosFeishuConfig(pool) {
  const r = await pool.query(`SELECT data FROM hrms_state WHERE key = 'pos_feishu_config' LIMIT 1`);
  return r.rows?.[0]?.data || null;
}

export async function savePosFeishuConfig(pool, body = {}) {
  const config = buildPosFeishuConfig(body);
  if (!config.orders_app_token || !config.orders_table_id) {
    const err = new Error('missing orders_app_token or orders_table_id');
    err.code = 'bad_request';
    throw err;
  }
  await pool.query(
    `INSERT INTO hrms_state (key, data, updated_at) VALUES ('pos_feishu_config', $1::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify(config)]
  );
  return config;
}

async function fetchFeishuTenantToken(config) {
  const appId =
    config.app_id ||
    process.env.BITABLE_TASK_RESP_APP_ID ||
    process.env.LARK_APP_ID ||
    process.env.FEISHU_APP_ID ||
    '';
  const appSecret =
    config.app_secret ||
    process.env.BITABLE_TASK_RESP_APP_SECRET ||
    process.env.LARK_APP_SECRET ||
    process.env.FEISHU_APP_SECRET ||
    '';
  if (!appId || !appSecret) {
    const err = new Error('no Feishu app credentials configured');
    err.code = 'no_credentials';
    throw err;
  }
  let tenantToken = '';
  try {
    const tr = await axios.post(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      { app_id: appId, app_secret: appSecret },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    tenantToken = tr.data?.tenant_access_token || '';
  } catch (e) {
    const err = new Error(e.message || 'lark_token_failed');
    err.code = 'lark_token_failed';
    throw err;
  }
  if (!tenantToken) {
    const err = new Error('lark_token_empty');
    err.code = 'lark_token_empty';
    throw err;
  }
  return tenantToken;
}

async function fetchBitableRecords(appToken, tableId, tenantToken, timeout = 10000) {
  const records = [];
  let pageToken = '';
  do {
    const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`;
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${tenantToken}` },
      timeout,
    });
    const rd = resp.data;
    if (rd.code !== 0) {
      const err = new Error(rd.msg || 'bitable_error');
      err.code = 'bitable_error';
      err.detail = rd.msg;
      throw err;
    }
    records.push(...(rd.data?.items || []));
    pageToken = rd.data?.has_more && rd.data?.page_token ? rd.data.page_token : '';
  } while (pageToken);
  return records;
}

function mapBitableRows(records, fieldMap, baseRow = {}) {
  const rows = [];
  for (const rec of records) {
    const f = rec.fields || {};
    const row = { ...baseRow };
    for (const [cn, en] of Object.entries(fieldMap)) {
      const val = f[cn];
      if (val != null) row[en] = bitableFieldValue(val);
    }
    if (row.order_no) rows.push(row);
  }
  return rows;
}

/**
 * @returns {Promise<{ orders_synced: number, items_synced: number, customers_linked: number, snapshot_rows: number }>}
 */
export async function syncPosFromFeishu(pool, tenantId, { config: override = null } = {}) {
  let config = override;
  if (!config) {
    config = await getPosFeishuConfig(pool);
  }
  if (!config) {
    const err = new Error('no pos_feishu_config found, POST /api/growth/pos-feishu-config first');
    err.code = 'no_config';
    throw err;
  }

  const tenantToken = await fetchFeishuTenantToken(config);
  const storeId = config.store_id || '';
  let totalOrders = 0;
  let totalItems = 0;

  if (config.orders_app_token && config.orders_table_id) {
    const records = await fetchBitableRecords(config.orders_app_token, config.orders_table_id, tenantToken);
    const ordersBatch = mapBitableRows(records, ORDERS_FIELD_MAP, { store_id: storeId });

    for (const o of ordersBatch) {
      const phone = parseKeruyunPhone(o.phone || o.member_phone || '');
      const bizDate = cnDate(o.biz_date);
      const resolvedStoreId = resolveOrderStoreId(o, storeId, tenantId);
      try {
        await pool.query(
          `
          INSERT INTO pos_orders(seq_no,order_no,order_source,biz_date,order_time,checkout_time,order_status,amount_before_discount,total_discount,amount_after_discount,payment_method,payment_count,member_name,phone,order_type,table_no,diners,duration,store_name,store_id,tenant_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          ON CONFLICT(order_no, tenant_id) DO UPDATE SET
            order_source=EXCLUDED.order_source,
            checkout_time=COALESCE(EXCLUDED.checkout_time,pos_orders.checkout_time),
            order_status=COALESCE(EXCLUDED.order_status,pos_orders.order_status),
            amount_before_discount=EXCLUDED.amount_before_discount,total_discount=EXCLUDED.total_discount,
            amount_after_discount=EXCLUDED.amount_after_discount,
            payment_method=COALESCE(EXCLUDED.payment_method,pos_orders.payment_method),
            payment_count=EXCLUDED.payment_count,
            phone=COALESCE(NULLIF(EXCLUDED.phone,''),pos_orders.phone),
            member_name=COALESCE(NULLIF(EXCLUDED.member_name,'-'),NULLIF(EXCLUDED.member_name,''),pos_orders.member_name),
            table_no=COALESCE(NULLIF(EXCLUDED.table_no,''),pos_orders.table_no),
            diners=COALESCE(EXCLUDED.diners,pos_orders.diners),
            duration=COALESCE(NULLIF(EXCLUDED.duration,''),pos_orders.duration),
            store_name=COALESCE(NULLIF(EXCLUDED.store_name,''),pos_orders.store_name),
            seq_no=COALESCE(NULLIF(EXCLUDED.seq_no,''),pos_orders.seq_no),
            synced_at=NOW()
        `,
          [
            cleanText(o.seq_no || '', 32),
            cleanText(o.order_no || '', 64),
            cleanText(o.order_source || '', 80),
            bizDate || null,
            parseKeruyunDateTime(o.order_time),
            parseKeruyunDateTime(o.checkout_time),
            cleanText(o.order_status || '', 40),
            parseNum(o.amount_before_discount),
            parseNum(o.total_discount),
            parseNum(o.amount_after_discount),
            cleanText(o.payment_method || '', 80),
            Number(o.payment_count) || 0,
            cleanText(o.member_name || '', 100),
            phone,
            cleanText(o.order_type || '', 40),
            cleanText(o.table_no || '', 40),
            Number(o.diners) || null,
            cleanText(o.duration || '', 40),
            cleanText(o.store_name || '', 200),
            resolvedStoreId,
            tenantId,
          ]
        );
        totalOrders++;
        if (phone) {
          maybeNotifyRegularCustomerFromPosOrder(pool, {
            tenantId,
            storeId: resolvedStoreId,
            storeName: cleanText(o.store_name || '', 200),
            phone,
            orderNo: cleanText(o.order_no || '', 64),
            tableNo: cleanText(o.table_no || '', 40),
            bizDate: bizDate || '',
            checkoutTime: parseKeruyunDateTime(o.checkout_time),
          }).catch((e) => log.warn({ msg: 'pos_regular_arrival_notify_failed', err: e?.message || String(e) }));
        }
      } catch (e) {
        log.error({ msg: 'pos_feishu_order_upsert_failed', err: e?.message || String(e), order_no: o.order_no });
      }
    }
  }

  if (config.items_app_token && config.items_table_id) {
    let itemsPageCount = 0;
    let pageToken = '';
    do {
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${config.items_app_token}/tables/${config.items_table_id}/records?page_size=500${pageToken ? `&page_token=${pageToken}` : ''}`;
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${tenantToken}` },
        timeout: 15000,
      });
      const rd = resp.data;
      if (rd.code !== 0) {
        const err = new Error(rd.msg || 'items_bitable_error');
        err.code = 'items_bitable_error';
        err.detail = rd.msg;
        throw err;
      }
      const records = rd.data?.items || [];
      itemsPageCount++;
      log.info({
        msg: 'pos_feishu_items_page',
        page: itemsPageCount,
        records: records.length,
        has_more: !!rd.data?.has_more,
        total: rd.data?.total ?? null,
      });

      for (const rec of records) {
        const f = rec.fields || {};
        const it = {};
        for (const [cn, en] of Object.entries(ITEMS_FIELD_MAP)) {
          const val = f[cn];
          if (val != null) it[en] = bitableFieldValue(val);
        }
        if (!it.order_no) continue;

        const itemBizDate = cnDate(it.biz_date);
        try {
          await pool.query(
            `
            INSERT INTO pos_order_items(biz_date,store_name,store_code,order_no,sku,dish_name,department,table_name,table_area,sale_type,category_mid,category,spec,unit,order_type,order_source,qty,amount_before_discount,discount,service_fee,amount_after_discount,order_time,checkout_time,tenant_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
            ON CONFLICT DO NOTHING
          `,
            [
              itemBizDate || null,
              cleanText(it.store_name || '', 200),
              resolveItemStoreCode(it, tenantId),
              cleanText(it.order_no || '', 128),
              cleanText(it.sku || '', 64),
              cleanText(it.dish_name || '', 300),
              cleanText(it.department || '', 100),
              cleanText(it.table_name || '', 100),
              cleanText(it.table_area || '', 100),
              cleanText(it.sale_type || '', 40),
              cleanText(it.category_mid || '', 100),
              cleanText(it.category || '', 100),
              cleanText(it.spec || '', 100),
              cleanText(it.unit || '', 20),
              cleanText(it.order_type || '', 40),
              cleanText(it.order_source || '', 200),
              parseNum(it.qty),
              parseNum(it.amount_before_discount),
              parseNum(it.discount),
              parseNum(it.service_fee),
              parseNum(it.amount_after_discount),
              parseKeruyunDateTime(it.order_time),
              parseKeruyunDateTime(it.checkout_time),
              tenantId,
            ]
          );
          totalItems++;
        } catch (e) {
          log.error({ msg: 'pos_feishu_item_upsert_failed', err: e?.message || String(e), order_no: it.order_no });
        }
      }
      pageToken = rd.data?.has_more && rd.data?.page_token ? rd.data.page_token : '';
    } while (pageToken);
  }

  const totalLinked = await linkPosOrdersToCustomers(pool);
  const snapshotRows = await refreshSalesGrowthSnapshot(pool, 7).catch((e) => {
    log.error({ msg: 'pos_feishu_snapshot_refresh_failed', err: e?.message || String(e) });
    return 0;
  });

  return {
    orders_synced: totalOrders,
    items_synced: totalItems,
    customers_linked: totalLinked,
    snapshot_rows: snapshotRows,
  };
}

export function mapFeishuSyncError(err) {
  const code = err?.code || 'server_error';
  if (code === 'bad_request') return { status: 400, body: { ok: false, error: err.message } };
  if (code === 'no_config') return { status: 400, body: { ok: false, error: err.message } };
  if (code === 'no_credentials') return { status: 503, body: { ok: false, error: err.message } };
  if (code === 'lark_token_failed') return { status: 502, body: { ok: false, error: 'lark_token_failed', detail: err.message } };
  if (code === 'lark_token_empty') return { status: 502, body: { ok: false, error: 'lark_token_empty' } };
  if (code === 'bitable_error') return { status: 502, body: { ok: false, error: 'orders_bitable_error', detail: err.detail || err.message } };
  if (code === 'items_bitable_error') return { status: 502, body: { ok: false, error: 'items_bitable_error', detail: err.detail || err.message } };
  return { status: 500, body: { ok: false, error: 'server_error' } };
}
