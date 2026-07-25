/**
 * 企微「客户联系」变更事件(add_external_contact/del_external_contact)处理。
 * 企业微信自建应用一个应用只有一个回调URL/Token/EncodingAESKey，"外部联系人变更回调"
 * 和"微信客服消息和事件"是同一个应用下勾选的两种事件类型，共用同一个回调地址——不是
 * 分开配置的两个URL。所以这里不注册新路由，而是被 /api/wecom/kf/callback 这个既有回调
 * 解密报文后，按 ChangeType 字段分流调用，复用同一份Token/EncodingAESKey。
 *
 * 与 growth-wecom-feishu-routes.js 里的 syncWecomContactsForStore 轮询是互补关系：
 * 轮询降级为低频兜底对账，这里才是主力实时数据源，避免加好友到系统感知之间的延迟，
 * 并且直接用 external_userid 强关联 sales_leads(已有唯一索引 idx_sales_leads_external_uid)，
 * 不再像轮询那样只能靠手机号做弱匹配。
 */
import { getAllStoreWecomConfigs, getWecomAccessToken, resolveTenantIdForStore } from '../../growth-api.js';
import { newLeadKey } from './sales-store.js';
import { tenantContext } from '../../utils/database.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales', handler: 'wecom-contact-events' });

function parseXmlTag(xml, tag) {
  const m = String(xml || '').match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`));
  return m ? m[1] : (String(xml || '').match(new RegExp(`<${tag}>(.*?)</${tag}>`)) || [])[1] || '';
}

async function resolveStoreIdByUserId(pool, userId) {
  const configs = await getAllStoreWecomConfigs(pool);
  const match = (configs || []).find((c) => c.sender_userid === userId);
  return match?.store_id || null;
}

async function ensureLeadForExternalContact(pool, { externalUserid, tenantId }) {
  const found = await pool.query(`SELECT id FROM sales_leads WHERE external_userid=$1 ORDER BY id DESC LIMIT 1`, [externalUserid]);
  if (found.rows?.[0]) return found.rows[0].id;
  const key = newLeadKey();
  const r = await pool.query(
    `INSERT INTO sales_leads (lead_key, external_userid, source_channel, stage, controller, tenant_id)
     VALUES ($1,$2,'wecom_contact','new','ai',$3)
     ON CONFLICT (external_userid) WHERE external_userid IS NOT NULL DO NOTHING
     RETURNING id`,
    [key, externalUserid, tenantId || null]
  );
  if (r.rows?.[0]) return r.rows[0].id;
  const existing = await pool.query(`SELECT id FROM sales_leads WHERE external_userid=$1 ORDER BY id DESC LIMIT 1`, [externalUserid]);
  return existing.rows?.[0]?.id || null;
}

async function upsertContactRealtime(pool, { storeId, externalUserid, tenantId }) {
  const token = await getWecomAccessToken(pool, storeId);
  const detailResp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/externalcontact/get?access_token=${encodeURIComponent(token)}&external_userid=${encodeURIComponent(externalUserid)}`, { method: 'GET' });
  const detailData = await detailResp.json();
  if (Number(detailData?.errcode) !== 0 || !detailData?.external_contact) return null;
  const c = detailData.external_contact;
  const name = String(c.name || '').trim().slice(0, 128);
  let phone = '';
  if (Array.isArray(detailData.wechat_channels)) {
    const wc = detailData.wechat_channels.find((ch) => ch.phone);
    if (wc) phone = wc.phone;
  }
  await pool.query(
    `INSERT INTO wechat_work_customers (external_userid, name, phone, store_id, tenant_id)
     VALUES ($1,$2,NULLIF($3,''),$4,$5)
     ON CONFLICT (external_userid, tenant_id) WHERE external_userid IS NOT NULL AND external_userid <> '' DO UPDATE SET
       name = COALESCE(NULLIF(EXCLUDED.name,''), wechat_work_customers.name),
       phone = COALESCE(NULLIF(EXCLUDED.phone,''), wechat_work_customers.phone),
       store_id = COALESCE(NULLIF(EXCLUDED.store_id,''), wechat_work_customers.store_id),
       updated_at = NOW()`,
    [externalUserid, name, phone, storeId, tenantId]
  );
  await ensureLeadForExternalContact(pool, { externalUserid, tenantId });
  return { name, phone };
}

/**
 * @param {string} decryptedXml 已用 decryptKfMessage 解开的明文XML(和KF共用同一份解密结果)
 * @returns {boolean} 是否是本模块认识并处理了的事件(ChangeType命中)；false表示上层应继续按其他事件类型处理(如KF消息)
 */
export async function handleExternalContactChangeEvent(pool, decryptedXml) {
  const changeType = parseXmlTag(decryptedXml, 'ChangeType');
  if (!['add_external_contact', 'del_external_contact', 'del_follow_user'].includes(changeType)) return false;
  const externalUserid = parseXmlTag(decryptedXml, 'ExternalUserID');
  const userId = parseXmlTag(decryptedXml, 'UserID');
  if (!externalUserid) return true;
  if (changeType === 'del_external_contact' || changeType === 'del_follow_user') {
    await pool.query(`UPDATE wechat_work_customers SET updated_at=NOW(), note=COALESCE(note,'') || ' [已删除好友]' WHERE external_userid=$1`, [externalUserid]).catch((e) => log.warn({ msg: 'del_update_failed', err: e?.message || String(e) }));
    return true;
  }
  const storeId = await resolveStoreIdByUserId(pool, userId);
  if (!storeId) { log.warn({ msg: 'no_store_matched_for_userid', user_id: userId }); return true; }
  const tenantId = await resolveTenantIdForStore(pool, storeId);
  await tenantContext.run(tenantId, () => upsertContactRealtime(pool, { storeId, externalUserid, tenantId }))
    .catch((e) => log.error({ msg: 'add_upsert_failed', err: e?.message || String(e) }));
  return true;
}
