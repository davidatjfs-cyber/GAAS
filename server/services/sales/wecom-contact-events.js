/**
 * 企微「客户联系」实时事件回调(add_external_contact/del_external_contact)。
 * 与 growth-wecom-feishu-routes.js 里的 syncWecomContactsForStore 轮询是互补关系：
 * 轮询降级为低频兜底对账，这里才是主力实时数据源，避免加好友到系统感知之间的延迟，
 * 并且直接用 external_userid 强关联 sales_leads(已有唯一索引 idx_sales_leads_external_uid)，
 * 不再像轮询那样只能靠手机号做弱匹配。
 */
import express from 'express';
import { verifyKfSignature, decryptKfEcho, decryptKfMessage } from './sales-kf.js';
import { getAllStoreWecomConfigs, getWecomAccessToken, resolveTenantIdForStore } from '../../growth-api.js';
import { newLeadKey } from './sales-store.js';
import { tenantContext } from '../../utils/database.js';

// 「客户联系」事件回调走的是老式XML报文(<xml><Encrypt>...</Encrypt></xml>)，
// 不是"微信客服"KF回调那种JSON报文，全局 express.json() 解析不了，这里只在本路由
// 局部用 express.text 把原始报文当字符串接住，不影响其他路由的body解析方式。
const rawXmlBody = express.text({ type: () => true });

function contactEventEnv() {
  return {
    token: String(process.env.WECOM_CONTACT_TOKEN || process.env.WECOM_CALLBACK_TOKEN || '').trim(),
    aesKey: String(process.env.WECOM_CONTACT_AES_KEY || process.env.WECOM_CALLBACK_AES_KEY || '').trim(),
  };
}

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

export function registerWecomContactEventRoutes(app, pool) {
  // 企微后台校验URL用：GET请求原样解密echostr返回。
  app.get('/api/wecom/contact-events/callback', (req, res) => {
    const { msg_signature, timestamp, nonce, echostr } = req.query;
    const { token, aesKey } = contactEventEnv();
    if (!token || !aesKey) return res.status(500).send('not_configured');
    const sig = verifyKfSignature(token, timestamp, nonce, echostr);
    if (sig !== msg_signature) return res.status(401).send('invalid_signature');
    try {
      res.send(decryptKfEcho(String(echostr), aesKey));
    } catch (e) {
      res.status(400).send('decrypt_failed');
    }
  });

  app.post('/api/wecom/contact-events/callback', rawXmlBody, async (req, res) => {
    res.send('success'); // 企微要求尽快200响应，处理逻辑异步进行，失败不影响下次重试之外的行为
    try {
      const { msg_signature, timestamp, nonce } = req.query;
      const { token, aesKey } = contactEventEnv();
      if (!token || !aesKey) return;
      const encrypt = parseXmlTag(String(req.body || ''), 'Encrypt');
      if (!encrypt) return;
      const sig = verifyKfSignature(token, timestamp, nonce, encrypt);
      if (sig !== msg_signature) { console.warn('[wecom-contact-events] invalid signature'); return; }
      const xml = decryptKfMessage(encrypt, aesKey);
      const changeType = parseXmlTag(xml, 'ChangeType');
      const externalUserid = parseXmlTag(xml, 'ExternalUserID');
      const userId = parseXmlTag(xml, 'UserID');
      if (!externalUserid) return;
      if (changeType === 'del_external_contact' || changeType === 'del_follow_user') {
        await pool.query(`UPDATE wechat_work_customers SET updated_at=NOW(), note=COALESCE(note,'') || ' [已删除好友]' WHERE external_userid=$1`, [externalUserid]);
        return;
      }
      if (changeType !== 'add_external_contact') return;
      const storeId = await resolveStoreIdByUserId(pool, userId);
      if (!storeId) { console.warn('[wecom-contact-events] no store matched for userId:', userId); return; }
      const tenantId = await resolveTenantIdForStore(pool, storeId);
      await tenantContext.run(tenantId, () => upsertContactRealtime(pool, { storeId, externalUserid, tenantId }));
    } catch (e) {
      console.error('[wecom-contact-events] callback processing failed:', e?.message || e);
    }
  });
}
