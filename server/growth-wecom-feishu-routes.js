/**
 * WeCom + Feishu config routes (extracted from growth-api.js — monolith split).
 * registerGrowthWecomFeishuRoutes(app, pool) — behavior-preserving move.
 */
import { tenantContext } from './utils/database.js';
import {
  requireGrowthAuth,
  resolveTenantIdForStore,
  getWecomConfig,
  getStoreWecomConfig,
  getAllStoreWecomConfigs,
  getWecomAccessToken,
  resetGrowthWecomTokenCache,
  clearStoreWecomTokenCache,
  upsertDeliveryLog,
  insertGrowthEvent,
  setSyncWecomContactsForStore,
} from './growth-api.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// ── WeCom contact auto-sync from store configs ──
// export：仍被 growth-api.js 里的定时同步任务（__wecomContactSyncTimer）调用。
export async function syncWecomContactsForStore(pool, storeConfig) {
  try {
    const storeId = storeConfig.store_id;
    const token = await getWecomAccessToken(pool, storeId);
    const listResp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/externalcontact/list?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(storeConfig.sender_userid || '')}`, { method: 'GET' });
    const listData = await listResp.json();
    if (Number(listData?.errcode) !== 0 || !Array.isArray(listData?.external_userid)) {
      console.warn(`[wecom] list contacts failed for store=${storeId}:`, listData?.errmsg);
      return 0;
    }
    const eids = listData.external_userid.filter(Boolean);
    const tenantId = await resolveTenantIdForStore(pool, storeId);
    let synced = 0;
    await tenantContext.run(tenantId, async () => {
    for (const eid of eids) {
      const detailResp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/externalcontact/get?access_token=${encodeURIComponent(token)}&external_userid=${encodeURIComponent(eid)}`, { method: 'GET' });
      const detailData = await detailResp.json();
      if (Number(detailData?.errcode) !== 0 || !detailData?.external_contact) continue;
      const c = detailData.external_contact;
      const phone = (c.corpid || c.corp_name || ''); // fallback, try from other fields
      const externalUserid = cleanText(c.external_userid || eid, 128);
      const name = cleanText(c.name || '', 128);
      let contactPhone = '';
      if (Array.isArray(detailData.follow_info) && detailData.follow_info.length) {
        const fi = detailData.follow_info[0];
        if (fi.description) {
          const m = fi.description.match(/1[3-9]\d{9}/);
          if (m) contactPhone = m[0];
        }
        if (!contactPhone && fi.tag_id && Array.isArray(fi.tag_id)) {
        }
      }
      if (Array.isArray(detailData.wechat_channels)) {
        const wc = detailData.wechat_channels.find(ch => ch.phone);
        if (wc) contactPhone = wc.phone;
      }
      await pool.query(
        `INSERT INTO wechat_work_customers (external_userid, name, phone, store_id, bind_customer_id, tenant_id)
         VALUES ($1,$2,NULLIF($3,''),$4,NULL,$5)
         ON CONFLICT (external_userid, tenant_id) WHERE external_userid IS NOT NULL AND external_userid <> '' DO UPDATE SET
           name = COALESCE(NULLIF(EXCLUDED.name,''), wechat_work_customers.name),
           phone = COALESCE(NULLIF(EXCLUDED.phone,''), wechat_work_customers.phone),
           store_id = COALESCE(NULLIF(EXCLUDED.store_id,''), wechat_work_customers.store_id),
           updated_at = NOW()`,
        [externalUserid, name, contactPhone, storeId, tenantId]
      );
      if (contactPhone) {
        await pool.query(
          `UPDATE wechat_work_customers SET bind_customer_id = (
            SELECT id FROM growth_customers WHERE phone = $1 LIMIT 1
          ), updated_at = NOW()
          WHERE external_userid = $2 AND bind_customer_id IS NULL`,
          [contactPhone, externalUserid]
        );
      }
      synced++;
    }
    });
    return synced;
  } catch (e) {
    console.warn(`[wecom] sync contacts failed for store=${storeConfig.store_id}:`, e?.message);
    return 0;
  }
}

setSyncWecomContactsForStore(syncWecomContactsForStore);

export function registerGrowthWecomFeishuRoutes(app, pool) {
  app.get('/api/growth/wecom-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const config = await getWecomConfig(pool);
    return res.json({ ok: true, config });
  });

  app.post('/api/growth/wecom-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const corpId = cleanText(b.corp_id, 200);
    const corpSecret = cleanText(b.corp_secret, 500);
    const senderUserId = cleanText(b.sender_userid, 128);
    if (!corpId || !corpSecret || !senderUserId) return res.status(400).json({ ok: false, error: 'missing corp_id/corp_secret/sender_userid' });
    const config = {
      corp_id: corpId,
      corp_secret: corpSecret,
      sender_userid: senderUserId,
      agent_id: cleanText(b.agent_id, 64),
      callback_secret: cleanText(b.callback_secret, 500)
    };
    await pool.query(
      `INSERT INTO hrms_state (key, data, updated_at) VALUES ('growth_wecom_config', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify(config)]
    );
    resetGrowthWecomTokenCache();
    return res.json({ ok: true, config });
  });

  app.post('/api/growth/wecom/callback', async (req, res) => {
    const b = req.body || {};
    const providerMsgId = cleanText(b.provider_msg_id || b.msgid, 255);
    const eventType = cleanText(b.event_type || b.event || '', 80).toLowerCase();
    if (!providerMsgId || !eventType) return res.status(400).json({ ok: false, error: 'missing provider_msg_id or event_type' });
    const delivery = await pool.query(`SELECT * FROM growth_delivery_logs WHERE provider_msg_id = $1 ORDER BY created_at DESC LIMIT 1`, [providerMsgId]);
    const row = delivery.rows[0] || null;
    if (!row) return res.status(404).json({ ok: false, error: 'delivery_not_found' });

    // 先查这条投递记录归属的门店有没有自己的回调密钥，没有才回退全局密钥——
    // 跟发消息本身(store_wecom_configs按store_id/tenant_id隔离)保持一致，不再只认一把全局密钥。
    const storeConfig = row.store_id ? await getStoreWecomConfig(pool, row.store_id) : null;
    const globalConfig = await getWecomConfig(pool);
    const configuredSecret = cleanText(
      storeConfig?.callback_secret || globalConfig?.callback_secret || process.env.GROWTH_WECOM_CALLBACK_SECRET || '',
      500
    );
    const headerSecret = cleanText(req.headers['x-wecom-callback-secret'] || '', 500);
    if (configuredSecret && headerSecret !== configuredSecret) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const statusMap = { sent: 'sent', delivered: 'delivered', read: 'read', clicked: 'clicked', redeemed: 'redeemed' };
    const eventMap = {
      delivered: 'wecom_message_delivered',
      read: 'wecom_message_read',
      clicked: 'wecom_message_clicked',
      redeemed: 'wecom_coupon_redeemed'
    };
    const newStatus = statusMap[eventType] || 'received';
    const callbackTenantId = String(row.tenant_id || 'default').trim() || 'default';
    await tenantContext.run(callbackTenantId, async () => {
      await upsertDeliveryLog(pool, {
        delivery_key: row.delivery_key,
        action_key: row.action_key,
        rule_key: row.rule_key,
        customer_id: row.customer_id,
        store_id: row.store_id,
        channel: row.channel,
        external_userid: row.external_userid,
        provider_msg_id: providerMsgId,
        status: newStatus,
        payload: row.payload || {},
        result: Object.assign({}, row.result || {}, b)
      }, callbackTenantId);
      if (eventMap[eventType]) {
        await insertGrowthEvent(pool, {
          event_type: eventMap[eventType],
          customer_id: row.customer_id,
          external_userid: row.external_userid,
          store_id: row.store_id,
          channel: row.channel,
          campaign_id: cleanText((row.payload || {}).campaign_id, 128),
          coupon_id: cleanText((row.payload || {}).coupon_id, 128),
          idempotency_key: `${eventMap[eventType]}:${providerMsgId}`,
          metadata: { provider_msg_id: providerMsgId, action_key: row.action_key, callback: b }
        }, callbackTenantId);
      }
    });
    return res.json({ ok: true, status: newStatus });
  });

  // ── Store WeCom config CRUD ──
  app.get('/api/growth/store-wecom-configs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const configs = await getAllStoreWecomConfigs(pool);
    return res.json({ ok: true, configs });
  });

  app.post('/api/growth/store-wecom-configs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const storeId = cleanText(b.store_id, 128);
    const corpId = cleanText(b.corp_id, 200);
    const corpSecret = cleanText(b.corp_secret, 500);
    const agentId = cleanText(b.agent_id, 64);
    const senderUserId = cleanText(b.sender_userid, 128);
    // 送达状态回调(消息已读/点击/核销)的校验密钥，跟corp_id/corp_secret一样按门店独立配置；
    // 不填就沿用旧行为，/api/growth/wecom/callback 回退到全局 growth_wecom_config.callback_secret。
    const callbackSecret = cleanText(b.callback_secret, 500);
    if (!storeId || !corpId || !corpSecret) return res.status(400).json({ ok: false, error: 'missing store_id/corp_id/corp_secret' });
    const tenantId = await resolveTenantIdForStore(pool, storeId);
    await pool.query(
      `INSERT INTO store_wecom_configs (store_id, corp_id, corp_secret, agent_id, sender_userid, callback_secret, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (store_id, tenant_id) DO UPDATE SET
         corp_id = EXCLUDED.corp_id, corp_secret = EXCLUDED.corp_secret,
         agent_id = EXCLUDED.agent_id, sender_userid = EXCLUDED.sender_userid,
         callback_secret = COALESCE(NULLIF(EXCLUDED.callback_secret, ''), store_wecom_configs.callback_secret),
         updated_at = NOW()`,
      [storeId, corpId, corpSecret, agentId, senderUserId, callbackSecret, tenantId]
    );
    clearStoreWecomTokenCache(storeId);
    return res.json({ ok: true });
  });

  app.delete('/api/growth/store-wecom-configs/:storeId', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.params.storeId, 128);
    await pool.query('DELETE FROM store_wecom_configs WHERE store_id = $1', [storeId]);
    clearStoreWecomTokenCache(storeId);
    return res.json({ ok: true });
  });

  app.post('/api/growth/sync-wecom-contacts', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.body?.store_id, 128);
    let configs;
    if (storeId) {
      const cfg = await getStoreWecomConfig(pool, storeId);
      configs = cfg ? [cfg] : [];
    } else {
      configs = await getAllStoreWecomConfigs(pool);
    }
    const results = [];
    for (const cfg of configs) {
      const synced = await syncWecomContactsForStore(pool, cfg);
      results.push({ store_id: cfg.store_id, synced });
    }
    return res.json({ ok: true, results, total: results.reduce((s, r) => s + r.synced, 0) });
  });

  // ── Phase 2: Feishu config persistence for WeChat customer auto-sync ──
  app.get('/api/growth/feishu-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await pool.query(`SELECT data FROM hrms_state WHERE key = 'growth_feishu_config' LIMIT 1`);
    const config = r.rows?.[0]?.data || null;
    res.json({ ok: true, config });
  });

  app.post('/api/growth/feishu-config', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const appToken = cleanText(b.app_token, 200);
    const tableId = cleanText(b.table_id, 200);
    if (!appToken || !tableId) return res.status(400).json({ ok: false, error: 'missing app_token or table_id' });
    await pool.query(
      `INSERT INTO hrms_state (key, data, updated_at) VALUES ('growth_feishu_config', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
      [JSON.stringify({ app_token: appToken, table_id: tableId })]
    );
    res.json({ ok: true, config: { app_token: appToken, table_id: tableId } });
  });
}
