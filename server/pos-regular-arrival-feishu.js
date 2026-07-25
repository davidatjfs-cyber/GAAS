import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'pos-regular-arrival' });

/**
 * POS 订单入库后直连飞书「熟客到店」提醒。
 * HRMS pos_orders upsert 完成 → 手机号历史 ≥2 单 → 飞书群（HTTP 网关或 HRMS 直连）。
 */

const STORE_FEISHU_ARRIVAL_KEY = 'store_feishu_arrival_configs';
let feishuConfigCache = { loadedAt: 0, byStore: new Map() };

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

function beijingYmd(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function beijingDateTimeText(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);
  const pick = (type) => (parts.find((p) => p.type === type) || {}).value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

function formatLastVisitText(iso) {
  if (!iso) return '首次到店';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '首次到店';
  const today = beijingYmd(new Date());
  const visitDay = beijingYmd(new Date(t));
  if (today === visitDay) return `今天 ${beijingDateTimeText(new Date(t)).slice(11)}`;
  return visitDay;
}

function regularArrivalPushUrl() {
  return cleanText(process.env.HRMS_REGULAR_ARRIVAL_PUSH_URL || '', 500);
}

async function loadStoreFeishuConfigs(pool) {
  const now = Date.now();
  if (now - feishuConfigCache.loadedAt < 5 * 60 * 1000 && feishuConfigCache.byStore.size) {
    return feishuConfigCache.byStore;
  }
  const byStore = new Map();
  try {
    const r = await pool.query(`SELECT data FROM hrms_state WHERE key = $1 LIMIT 1`, [STORE_FEISHU_ARRIVAL_KEY]);
    const rows = Array.isArray(r.rows?.[0]?.data) ? r.rows[0].data : [];
    for (const row of rows) {
      const sid = cleanText(row.store_id, 128);
      if (!sid || !row.app_id || !row.app_secret || !row.chat_id) continue;
      byStore.set(sid, row);
    }
  } catch (e) {
    log.warn({ msg: 'load_feishu_configs_failed', err: e?.message || String(e) });
  }
  feishuConfigCache = { loadedAt: now, byStore };
  return byStore;
}

async function isRegularArrivalPushConfigured(pool) {
  if (regularArrivalPushUrl() && cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500)) {
    return true;
  }
  const configs = await loadStoreFeishuConfigs(pool);
  return configs.size > 0;
}

function shortField(label, value) {
  return { is_short: true, text: { tag: 'lark_md', content: `**${label}**\n${value || '—'}` } };
}

function buildFeishuCard(profile) {
  const fields = [
    shortField('顾客', profile.display_name),
    shortField('累计到店', `${profile.total_visits || 0} 次`),
    shortField('今天所在桌号', profile.table_id),
    shortField('今天到店时间', profile.arrival_time_text),
    shortField('最近到店日期', profile.last_visit_text)
  ];
  if (profile.last_order_dishes) fields.push(shortField('上次点的菜品', profile.last_order_dishes));
  if (profile.last_order_diners) fields.push(shortField('上次消费人数', `${profile.last_order_diners} 人`));
  if (profile.last_order_amount_yuan) fields.push(shortField('上次消费金额', `¥${profile.last_order_amount_yuan}`));
  return {
    config: { wide_screen_mode: true },
    header: { template: 'orange', title: { tag: 'plain_text', content: '🔔 熟客到店提醒' } },
    elements: [
      { tag: 'div', fields },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `门店：${profile.store_name || '—'}` }] }
    ]
  };
}

async function getFeishuTenantToken(appId, appSecret) {
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = await resp.json().catch(() => ({}));
  if (data && data.code === 0 && data.tenant_access_token) return data.tenant_access_token;
  throw new Error((data && data.msg) || 'feishu_token_failed');
}

async function sendFeishuCardDirect(config, card) {
  const token = await getFeishuTenantToken(config.app_id, config.app_secret);
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      receive_id: config.chat_id,
      msg_type: 'interactive',
      content: JSON.stringify(card)
    })
  });
  const data = await resp.json().catch(() => ({}));
  if (data && data.code === 0) return { ok: true };
  return { ok: false, error: (data && data.msg) || `feishu_http_${resp.status}` };
}

async function postRegularArrivalPush(body) {
  const url = regularArrivalPushUrl();
  const secret = cleanText(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '', 500);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Miniprogram-Sync-Secret': secret },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    let json = {};
    try { json = await resp.json(); } catch (e) { json = {}; }
    return { httpStatus: resp.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

export async function ensurePosRegularArrivalTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pos_regular_arrival_notifies (
      id BIGSERIAL PRIMARY KEY,
      tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
      store_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      visit_date DATE NOT NULL,
      order_no TEXT,
      notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      push_ok BOOLEAN NOT NULL DEFAULT FALSE,
      push_error TEXT
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_regular_arrival_dedup
      ON pos_regular_arrival_notifies (tenant_id, store_id, phone, visit_date)
  `);
}

function resolveStoreId(storeId, storeName) {
  const sid = cleanText(storeId, 128);
  if (sid === '51866138' || sid === '64822111') return sid;
  const sn = cleanText(storeName, 200);
  if (sn.includes('洪潮')) return '64822111';
  if (sn.includes('马己仙')) return '51866138';
  return sid;
}

function isRecentVisitDate(bizDate) {
  const ymd = cleanText(bizDate, 32).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const today = beijingYmd(new Date());
  const yesterday = beijingYmd(new Date(Date.now() - 86400000));
  return ymd === today || ymd === yesterday;
}

async function loadCustomerPosStats(pool, tenantId, phone) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS total_orders,
            MAX(checkout_time) AS last_checkout,
            (ARRAY_AGG(order_no ORDER BY checkout_time DESC NULLS LAST))[1] AS last_order_no
       FROM pos_orders
      WHERE tenant_id = $1 AND trim(phone) = $2 AND COALESCE(phone, '') <> ''
      GROUP BY trim(phone)`,
    [tenantId, phone]
  );
  return r.rows[0] || { total_orders: 0, last_checkout: null, last_order_no: '' };
}

async function loadLastOrderDetail(pool, tenantId, orderNo) {
  if (!orderNo) return { dishes: '', diners: 0, amount_fen: 0 };
  const r = await pool.query(
    `SELECT po.diners, po.amount_after_discount,
            COALESCE(STRING_AGG(DISTINCT oi.dish_name, '、' ORDER BY oi.dish_name)
              FILTER (WHERE oi.dish_name IS NOT NULL AND oi.dish_name <> ''), '') AS dishes
       FROM pos_orders po
       LEFT JOIN pos_order_items oi ON oi.order_no = po.order_no AND oi.tenant_id = po.tenant_id
      WHERE po.tenant_id = $1 AND po.order_no = $2
      GROUP BY po.diners, po.amount_after_discount
      LIMIT 1`,
    [tenantId, orderNo]
  );
  const row = r.rows[0] || {};
  return {
    dishes: row.dishes || '',
    diners: Number(row.diners) || 0,
    amount_fen: Math.round((Number(row.amount_after_discount) || 0) * 100)
  };
}

async function loadPreviousCheckout(pool, tenantId, phone, currentOrderNo) {
  const r = await pool.query(
    `SELECT MAX(checkout_time) AS prev_checkout
       FROM pos_orders
      WHERE tenant_id = $1 AND trim(phone) = $2 AND order_no <> $3`,
    [tenantId, phone, cleanText(currentOrderNo, 128)]
  );
  return r.rows[0]?.prev_checkout || null;
}

/**
 * POS 单条订单 upsert 后调用。满足：近 2 日营业日、有手机号、历史 ≥2 单、当日未推过 → 飞书。
 */
export async function maybeNotifyRegularCustomerFromPosOrder(pool, orderCtx = {}) {
  if (!(await isRegularArrivalPushConfigured(pool))) return { skipped: true, reason: 'push_not_configured' };

  const tenantId = cleanText(orderCtx.tenantId || 'default', 80) || 'default';
  const phone = cleanPhone(orderCtx.phone);
  if (!phone) return { skipped: true, reason: 'no_phone' };

  const storeId = resolveStoreId(orderCtx.storeId, orderCtx.storeName);
  if (!storeId) return { skipped: true, reason: 'no_store_id' };

  const bizDate = cleanText(orderCtx.bizDate, 32).slice(0, 10);
  if (!isRecentVisitDate(bizDate)) return { skipped: true, reason: 'biz_date_not_recent' };

  await ensurePosRegularArrivalTable(pool);

  const stats = await loadCustomerPosStats(pool, tenantId, phone);
  const totalOrders = Number(stats.total_orders) || 0;
  if (totalOrders < 2) return { skipped: true, reason: 'not_regular', total_orders: totalOrders };

  const visitDate = bizDate;
  const dedup = await pool.query(
    `INSERT INTO pos_regular_arrival_notifies (tenant_id, store_id, phone, visit_date, order_no, push_ok)
     VALUES ($1, $2, $3, $4::date, $5, FALSE)
     ON CONFLICT (tenant_id, store_id, phone, visit_date) DO NOTHING
     RETURNING id`,
    [tenantId, storeId, phone, visitDate, cleanText(orderCtx.orderNo, 128)]
  );
  if (!dedup.rows.length) return { skipped: true, reason: 'deduped', visit_date: visitDate };

  const notifyId = dedup.rows[0].id;
  const orderNo = cleanText(orderCtx.orderNo || stats.last_order_no, 128);
  const lastDetail = await loadLastOrderDetail(pool, tenantId, orderNo);
  const prevCheckout = await loadPreviousCheckout(pool, tenantId, phone, orderNo);
  const checkoutTime = orderCtx.checkoutTime || stats.last_checkout;
  const displayName = phone.length >= 4 ? `顾客${phone.slice(-4)}` : '顾客';

  const payload = {
    store_id: storeId,
    display_name: displayName,
    total_visits: totalOrders,
    table_id: cleanText(orderCtx.tableNo, 40),
    arrival_time_text: beijingDateTimeText(checkoutTime || new Date()),
    last_visit_text: formatLastVisitText(prevCheckout),
    last_order_dishes: lastDetail.dishes,
    last_order_diners: lastDetail.diners,
    last_order_amount_fen: lastDetail.amount_fen
  };

  let pushOk = false;
  let pushError = '';
  const pushUrl = regularArrivalPushUrl();
  if (pushUrl) {
    try {
      const pushResp = await postRegularArrivalPush(payload);
      pushOk = !!(pushResp.body && (pushResp.body.ok || pushResp.body.success || pushResp.body.detail?.success));
      if (!pushOk) {
        pushError = cleanText(
          (pushResp.body && (pushResp.body.error || pushResp.body.message || pushResp.body.detail?.message)) ||
          `http_${pushResp.httpStatus}`,
          500
        );
      }
    } catch (e) {
      pushError = cleanText(e?.message || String(e), 500);
    }
  }

  if (!pushOk) {
    const configs = await loadStoreFeishuConfigs(pool);
    const config = configs.get(storeId);
    if (config) {
      const cardProfile = {
        display_name: payload.display_name,
        total_visits: payload.total_visits,
        table_id: payload.table_id,
        arrival_time_text: payload.arrival_time_text,
        last_visit_text: payload.last_visit_text,
        last_order_dishes: payload.last_order_dishes,
        last_order_diners: payload.last_order_diners,
        last_order_amount_yuan: payload.last_order_amount_fen ? (payload.last_order_amount_fen / 100).toFixed(2) : '',
        store_name: config.store_name || ''
      };
      try {
        const direct = await sendFeishuCardDirect(config, buildFeishuCard(cardProfile));
        pushOk = !!direct.ok;
        if (!pushOk) pushError = cleanText(direct.error || 'direct_feishu_failed', 500);
      } catch (e) {
        pushError = cleanText(e?.message || String(e), 500);
      }
    } else if (!pushUrl) {
      pushError = pushError || 'missing_store_feishu_config';
    }
  }

  await pool.query(
    `UPDATE pos_regular_arrival_notifies SET push_ok = $2, push_error = NULLIF($3, ''), notified_at = NOW() WHERE id = $1`,
    [notifyId, pushOk, pushError]
  );

  if (!pushOk) {
    log.warn({ msg: 'push_failed', store_id: storeId, phone_tail: phone.slice(-4), err: pushError });
    return { skipped: false, notified: false, error: pushError, visit_date: visitDate };
  }

  return { skipped: false, notified: true, store_id: storeId, phone_tail: phone.slice(-4), total_orders: totalOrders };
}

export { regularArrivalPushUrl, isRegularArrivalPushConfigured };
