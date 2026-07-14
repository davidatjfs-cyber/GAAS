/**
 * 企业微信「微信客服」API 薄封装
 * 环境变量：
 *   WECOM_KF_CORP_ID / WECOM_KF_SECRET（或回退全局企微配置）
 *   WECOM_KF_OPEN_KFID
 *   WECOM_KF_TOKEN / WECOM_KF_AES_KEY（可与 WECOM_CALLBACK_* 相同）
 */
import { createHash, createDecipheriv, createCipheriv, randomBytes } from 'crypto';

const tokenCache = { token: '', expireAt: 0 };

export function kfEnv() {
  return {
    corpId: String(process.env.WECOM_KF_CORP_ID || process.env.WECOM_CORP_ID || '').trim(),
    secret: String(process.env.WECOM_KF_SECRET || process.env.WECOM_SECRET || '').trim(),
    openKfid: String(process.env.WECOM_KF_OPEN_KFID || '').trim(),
    token: String(process.env.WECOM_KF_TOKEN || process.env.WECOM_CALLBACK_TOKEN || '').trim(),
    aesKey: String(process.env.WECOM_KF_AES_KEY || process.env.WECOM_CALLBACK_AES_KEY || '').trim(),
  };
}

export function kfConfigured() {
  const e = kfEnv();
  return !!(e.corpId && e.secret && e.openKfid);
}

export function verifyKfSignature(token, timestamp, nonce, encrypt) {
  const arr = [token, String(timestamp || ''), String(nonce || ''), String(encrypt || '')].sort();
  return createHash('sha1').update(arr.join('')).digest('hex');
}

export function decryptKfEcho(encryptB64, encodingAesKey) {
  const aesKey = Buffer.from(encodingAesKey + '=', 'base64');
  const iv = aesKey.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  let decrypted = Buffer.concat([decipher.update(Buffer.from(encryptB64, 'base64')), decipher.final()]);
  const pad = decrypted[decrypted.length - 1];
  decrypted = decrypted.subarray(0, decrypted.length - pad);
  const content = decrypted.subarray(16);
  const msgLen = content.readUInt32BE(0);
  return content.subarray(4, 4 + msgLen).toString('utf8');
}

export function decryptKfMessage(encryptB64, encodingAesKey) {
  return decryptKfEcho(encryptB64, encodingAesKey);
}

async function getAccessToken() {
  const { corpId, secret } = kfEnv();
  if (!corpId || !secret) throw new Error('kf_credentials_missing');
  if (tokenCache.token && Date.now() < tokenCache.expireAt) return tokenCache.token;
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (!resp.ok || Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'kf_token_failed');
  tokenCache.token = String(data.access_token);
  tokenCache.expireAt = Date.now() + Math.max(60, Number(data.expires_in || 7200) - 120) * 1000;
  return tokenCache.token;
}

export async function syncKfMessages({ token, cursor, openKfid, limit = 1000 } = {}) {
  const accessToken = await getAccessToken();
  const body = {
    token: token || undefined,
    cursor: cursor || '',
    limit,
    voice_format: 0,
  };
  if (openKfid) body.open_kfid = openKfid;
  const resp = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${encodeURIComponent(accessToken)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await resp.json();
  if (Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'kf_sync_failed');
  return data;
}

export async function sendKfText({ openKfid, externalUserid, content }) {
  const accessToken = await getAccessToken();
  const resp = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: externalUserid,
        open_kfid: openKfid,
        msgtype: 'text',
        text: { content },
      }),
    }
  );
  const data = await resp.json();
  if (Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'kf_send_failed');
  return data;
}

export async function sendKfConsultantCard({ openKfid, externalUserid, consultantName, qrUrl }) {
  const name = String(consultantName || '专属顾问').trim();
  const url = String(qrUrl || '').trim();
  if (!url) return { ok: false, error: 'consultant_qr_not_configured' };
  const content = `为了方便发送Demo资料和后续跟进，请添加${name}：${url}`;
  const result = await sendKfText({ openKfid, externalUserid, content });
  return { ok: true, channel: 'wecom_kf_text_qr', content, result };
}

/**
 * 处理 kf 回调：拉消息 → 交给 session → 自动回复
 */
export async function processKfCallbackEvent(pool, { token, openKfid }, handleInbound) {
  const env = kfEnv();
  const kfId = openKfid || env.openKfid;
  let cursor = '';
  const state = await pool.query(
    `SELECT cursor FROM sales_conversations WHERE open_kfid=$1 AND cursor IS NOT NULL ORDER BY updated_at DESC LIMIT 1`,
    [kfId]
  ).catch(() => ({ rows: [] }));
  cursor = state.rows?.[0]?.cursor || '';

  const synced = await syncKfMessages({ token, cursor, openKfid: kfId });
  const nextCursor = synced.next_cursor || cursor;
  const msgs = Array.isArray(synced.msg_list) ? synced.msg_list : [];
  const results = [];

  for (const m of msgs) {
    if (String(m.msgtype) !== 'text') continue;
    const text = String(m?.text?.content || '').trim();
    if (!text) continue;
    const externalUserid = String(m.external_userid || '').trim();
    const msgId = String(m.msgid || '').trim() || null;
    const turn = await handleInbound({
      text,
      openKfid: String(m.open_kfid || kfId),
      externalUserid,
      msgId,
      sourceChannel: 'wecom_kf',
    });
    if (turn?.replied && turn.reply && externalUserid) {
      try {
        await sendKfText({
          openKfid: String(m.open_kfid || kfId),
          externalUserid,
          content: turn.reply,
        });
      } catch (e) {
        turn.send_error = e?.message || String(e);
      }
    }
    results.push(turn);
  }

  if (nextCursor) {
    await pool.query(
      `UPDATE sales_conversations SET cursor=$2, updated_at=NOW() WHERE open_kfid=$1`,
      [kfId, nextCursor]
    ).catch(() => null);
  }

  return { ok: true, pulled: msgs.length, handled: results.length, next_cursor: nextCursor, results };
}
