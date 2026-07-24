/**
 * WeCom + Feishu growth config — pure logic (no req/res).
 */
import { SHARED_TABLES } from '@gaas/shared';
import {
  cleanText,
  WECOM_STATUS_MAP,
  WECOM_EVENT_MAP,
  extractWecomContactPhone,
  resolveCallbackSecret,
} from './helpers.js';

export async function syncWecomContactsForStore(ctx, pool, storeConfig) {
  try {
    const storeId = storeConfig.store_id;
    const token = await ctx.getWecomAccessToken(pool, storeId);
    const fetchFn = ctx.fetch || fetch;
    const listResp = await fetchFn(
      `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/list?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(storeConfig.sender_userid || '')}`,
      { method: 'GET' }
    );
    const listData = await listResp.json();
    if (Number(listData?.errcode) !== 0 || !Array.isArray(listData?.external_userid)) {
      console.warn(`[wecom] list contacts failed for store=${storeId}:`, listData?.errmsg);
      return 0;
    }
    const eids = listData.external_userid.filter(Boolean);
    const tenantId = await ctx.resolveTenantIdForStore(pool, storeId);
    let synced = 0;
    await ctx.tenantContext.run(tenantId, async () => {
      for (const eid of eids) {
        const detailResp = await fetchFn(
          `https://qyapi.weixin.qq.com/cgi-bin/externalcontact/get?access_token=${encodeURIComponent(token)}&external_userid=${encodeURIComponent(eid)}`,
          { method: 'GET' }
        );
        const detailData = await detailResp.json();
        if (Number(detailData?.errcode) !== 0 || !detailData?.external_contact) continue;
        const c = detailData.external_contact;
        const externalUserid = cleanText(c.external_userid || eid, 128);
        const name = cleanText(c.name || '', 128);
        const contactPhone = extractWecomContactPhone(detailData);
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

export async function getWecomConfigEndpoint(ctx, pool) {
  const config = await ctx.getWecomConfig(pool);
  return { status: 200, body: { ok: true, config } };
}

export async function saveWecomConfig(ctx, pool, body) {
  const b = body || {};
  const corpId = cleanText(b.corp_id, 200);
  const corpSecret = cleanText(b.corp_secret, 500);
  const senderUserId = cleanText(b.sender_userid, 128);
  if (!corpId || !corpSecret || !senderUserId) {
    return { status: 400, body: { ok: false, error: 'missing corp_id/corp_secret/sender_userid' } };
  }
  const config = {
    corp_id: corpId,
    corp_secret: corpSecret,
    sender_userid: senderUserId,
    agent_id: cleanText(b.agent_id, 64),
    callback_secret: cleanText(b.callback_secret, 500),
  };
  await pool.query(
    `INSERT INTO ${SHARED_TABLES.HRMS_STATE} (key, data, updated_at) VALUES ('growth_wecom_config', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify(config)]
  );
  ctx.resetGrowthWecomTokenCache();
  return { status: 200, body: { ok: true, config } };
}

export async function handleWecomCallback(ctx, pool, body, headers) {
  const b = body || {};
  const providerMsgId = cleanText(b.provider_msg_id || b.msgid, 255);
  const eventType = cleanText(b.event_type || b.event || '', 80).toLowerCase();
  if (!providerMsgId || !eventType) {
    return { status: 400, body: { ok: false, error: 'missing provider_msg_id or event_type' } };
  }
  const delivery = await pool.query(
    `SELECT * FROM growth_delivery_logs WHERE provider_msg_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [providerMsgId]
  );
  const row = delivery.rows[0] || null;
  if (!row) return { status: 404, body: { ok: false, error: 'delivery_not_found' } };

  const storeConfig = row.store_id ? await ctx.getStoreWecomConfig(pool, row.store_id) : null;
  const globalConfig = await ctx.getWecomConfig(pool);
  const configuredSecret = resolveCallbackSecret(
    storeConfig,
    globalConfig,
    process.env.GROWTH_WECOM_CALLBACK_SECRET
  );
  const headerSecret = cleanText(headers['x-wecom-callback-secret'] || '', 500);
  if (configuredSecret && headerSecret !== configuredSecret) {
    return { status: 401, body: { ok: false, error: 'unauthorized' } };
  }

  const newStatus = WECOM_STATUS_MAP[eventType] || 'received';
  const callbackTenantId = String(row.tenant_id || 'default').trim() || 'default';
  await ctx.tenantContext.run(callbackTenantId, async () => {
    await ctx.upsertDeliveryLog(
      pool,
      {
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
        result: Object.assign({}, row.result || {}, b),
      },
      callbackTenantId
    );
    if (WECOM_EVENT_MAP[eventType]) {
      await ctx.insertGrowthEvent(
        pool,
        {
          event_type: WECOM_EVENT_MAP[eventType],
          customer_id: row.customer_id,
          external_userid: row.external_userid,
          store_id: row.store_id,
          channel: row.channel,
          campaign_id: cleanText((row.payload || {}).campaign_id, 128),
          coupon_id: cleanText((row.payload || {}).coupon_id, 128),
          idempotency_key: `${WECOM_EVENT_MAP[eventType]}:${providerMsgId}`,
          metadata: {
            provider_msg_id: providerMsgId,
            action_key: row.action_key,
            callback: b,
          },
        },
        callbackTenantId
      );
    }
  });
  return { status: 200, body: { ok: true, status: newStatus } };
}

export async function listStoreWecomConfigs(ctx, pool) {
  const configs = await ctx.getAllStoreWecomConfigs(pool);
  return { status: 200, body: { ok: true, configs } };
}

export async function upsertStoreWecomConfig(ctx, pool, body) {
  const b = body || {};
  const storeId = cleanText(b.store_id, 128);
  const corpId = cleanText(b.corp_id, 200);
  const corpSecret = cleanText(b.corp_secret, 500);
  const agentId = cleanText(b.agent_id, 64);
  const senderUserId = cleanText(b.sender_userid, 128);
  const callbackSecret = cleanText(b.callback_secret, 500);
  if (!storeId || !corpId || !corpSecret) {
    return { status: 400, body: { ok: false, error: 'missing store_id/corp_id/corp_secret' } };
  }
  const tenantId = await ctx.resolveTenantIdForStore(pool, storeId);
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
  ctx.clearStoreWecomTokenCache(storeId);
  return { status: 200, body: { ok: true } };
}

export async function deleteStoreWecomConfig(ctx, pool, storeIdRaw) {
  const storeId = cleanText(storeIdRaw, 128);
  await pool.query('DELETE FROM store_wecom_configs WHERE store_id = $1', [storeId]);
  ctx.clearStoreWecomTokenCache(storeId);
  return { status: 200, body: { ok: true } };
}

export async function syncWecomContactsEndpoint(ctx, pool, body) {
  const storeId = cleanText(body?.store_id, 128);
  let configs;
  if (storeId) {
    const cfg = await ctx.getStoreWecomConfig(pool, storeId);
    configs = cfg ? [cfg] : [];
  } else {
    configs = await ctx.getAllStoreWecomConfigs(pool);
  }
  const results = [];
  for (const cfg of configs) {
    const synced = await syncWecomContactsForStore(ctx, pool, cfg);
    results.push({ store_id: cfg.store_id, synced });
  }
  return {
    status: 200,
    body: { ok: true, results, total: results.reduce((s, r) => s + r.synced, 0) },
  };
}

export async function getFeishuConfig(ctx, pool) {
  const r = await pool.query(
    `SELECT data FROM ${SHARED_TABLES.HRMS_STATE} WHERE key = 'growth_feishu_config' LIMIT 1`
  );
  const config = r.rows?.[0]?.data || null;
  return { status: 200, body: { ok: true, config } };
}

export async function saveFeishuConfig(ctx, pool, body) {
  const b = body || {};
  const appToken = cleanText(b.app_token, 200);
  const tableId = cleanText(b.table_id, 200);
  if (!appToken || !tableId) {
    return { status: 400, body: { ok: false, error: 'missing app_token or table_id' } };
  }
  await pool.query(
    `INSERT INTO ${SHARED_TABLES.HRMS_STATE} (key, data, updated_at) VALUES ('growth_feishu_config', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET data = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify({ app_token: appToken, table_id: tableId })]
  );
  return { status: 200, body: { ok: true, config: { app_token: appToken, table_id: tableId } } };
}
