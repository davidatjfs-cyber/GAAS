/**
 * 企业微信「微信客服」API 薄封装
 * 环境变量：
 *   WECOM_KF_CORP_ID / WECOM_KF_SECRET（或回退全局企微配置）
 *   WECOM_KF_OPEN_KFID
 *   WECOM_KF_TOKEN / WECOM_KF_AES_KEY（可与 WECOM_CALLBACK_* 相同）
 */
import { createHash, createDecipheriv } from 'crypto';
import { transcribeAmrVoice } from './sales-asr.js';
import { synthesizeSpeechAmr } from './sales-tts.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales', handler: 'sales-kf' });


const tokenCache = { token: '', expireAt: 0 };
let _fetch = (...args) => globalThis.fetch(...args);

export function setSalesKfFetch(fn) {
  _fetch = typeof fn === 'function' ? fn : (...args) => globalThis.fetch(...args);
  tokenCache.token = '';
  tokenCache.expireAt = 0;
}

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
  const resp = await _fetch(url);
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
  const resp = await _fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg?access_token=${encodeURIComponent(accessToken)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await resp.json();
  if (Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'kf_sync_failed');
  return data;
}

export async function getKfServiceState({ openKfid, externalUserid }) {
  const accessToken = await getAccessToken();
  const resp = await _fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/service_state/get?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open_kfid: openKfid, external_userid: externalUserid }),
    }
  );
  const data = await resp.json();
  if (Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'kf_service_state_get_failed');
  return Number(data.service_state);
}

/**
 * 只有未处理(0)可以由当前客户AI认领为智能助手接待(1)。待人工接入(2)、人工接待或
 * 已结束会话不能被AI强抢；遇到这些状态直接返回可审计错误，不再盲目调用send_msg制造95018。
 */
export async function claimKfServiceState({ openKfid, externalUserid }) {
  const state = await getKfServiceState({ openKfid, externalUserid });
  if (state === 1) return { errcode: 0, errmsg: 'ok', service_state: 1, already_claimed: true };
  if (state !== 0) {
    const error = new Error(`kf_session_not_ai_service_state_${state}`);
    error.serviceState = state;
    throw error;
  }
  const accessToken = await getAccessToken();
  const resp = await _fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/service_state/trans?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open_kfid: openKfid, external_userid: externalUserid, service_state: 1 }),
    }
  );
  const data = await resp.json();
  if (Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'kf_service_state_trans_failed');
  return data;
}

/** 获取客服账号下已配置的接待人员（用于判断转人工时是否真的有人可接） */
export async function listKfServicers({ openKfid } = {}) {
  const accessToken = await getAccessToken();
  const resp = await _fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/servicer/list?access_token=${encodeURIComponent(accessToken)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ open_kfid: openKfid }) }
  );
  const data = await resp.json();
  if (Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'kf_servicer_list_failed');
  return Array.isArray(data.servicer_list) ? data.servicer_list : [];
}

/**
 * 变更企微客服会话状态（状态流转只能由 API 驱动，见官方「分配客服会话」）。
 * serviceState: 2=待接入池排队等待真人接待；3=指定接待人员人工接待。
 * 官方约束：state=3 时 servicer_userid 必填，且接待人员必须已在企业微信激活（否则 95014）。
 */
export async function transKfServiceState({ openKfid, externalUserid, serviceState, servicerUserid } = {}) {
  const accessToken = await getAccessToken();
  const body = { open_kfid: openKfid, external_userid: externalUserid, service_state: Number(serviceState) };
  if (servicerUserid) body.servicer_userid = String(servicerUserid);
  const resp = await _fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/service_state/trans?access_token=${encodeURIComponent(accessToken)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await resp.json();
  if (Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'kf_service_state_trans_failed');
  return data;
}

/** 智能助手(1) → 待接入池(2)：会话进入人工队列，接待人员可在企微客户端接入 */
export async function handoffKfToHumanQueue({ openKfid, externalUserid } = {}) {
  return transKfServiceState({ openKfid, externalUserid, serviceState: 2 });
}

/** 智能助手(1) → 人工接待(3)：直接指定接待人员（须已激活且处于接待中） */
export async function handoffKfToServicer({ openKfid, externalUserid, servicerUserid } = {}) {
  return transKfServiceState({ openKfid, externalUserid, serviceState: 3, servicerUserid });
}

export async function sendKfText({ openKfid, externalUserid, content }) {
  await claimKfServiceState({ openKfid, externalUserid });
  const accessToken = await getAccessToken();
  const resp = await _fetch(
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

async function sendKfMediaMessage({ openKfid, externalUserid, msgtype, mediaId }) {
  if (!mediaId) throw new Error('media_id_required');
  await claimKfServiceState({ openKfid, externalUserid });
  const accessToken = await getAccessToken();
  const resp = await _fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touser: externalUserid, open_kfid: openKfid, msgtype, [msgtype]: { media_id: mediaId } }),
    }
  );
  const data = await resp.json();
  if (Number(data?.errcode) !== 0) throw new Error(data?.errmsg || `kf_send_${msgtype}_failed`);
  return data;
}

export async function sendKfImage({ openKfid, externalUserid, mediaId }) {
  return sendKfMediaMessage({ openKfid, externalUserid, msgtype: 'image', mediaId });
}

export async function sendKfFile({ openKfid, externalUserid, mediaId }) {
  return sendKfMediaMessage({ openKfid, externalUserid, msgtype: 'file', mediaId });
}

export async function sendKfVideo({ openKfid, externalUserid, mediaId }) {
  return sendKfMediaMessage({ openKfid, externalUserid, msgtype: 'video', mediaId });
}

export async function sendKfConsultantCard({ openKfid, externalUserid, consultantName, qrUrl }) {
  const name = String(consultantName || '专属顾问').trim();
  const url = String(qrUrl || '').trim();
  if (!url) return { ok: false, error: 'consultant_qr_not_configured' };
  const content = `为了方便发送Demo资料和后续跟进，请添加${name}：${url}`;
  const result = await sendKfText({ openKfid, externalUserid, content });
  return { ok: true, channel: 'wecom_kf_text_qr', content, result };
}

/** 下载客户发来的语音/图片等媒体文件，返回原始二进制Buffer；语音默认amr格式(voice_format=0，见sync_msg调用) */
export async function downloadKfMedia(mediaId) {
  const accessToken = await getAccessToken();
  const resp = await _fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${encodeURIComponent(accessToken)}&media_id=${encodeURIComponent(mediaId)}`
  );
  const contentType = resp.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await resp.json();
    throw new Error(data?.errmsg || 'kf_media_download_failed');
  }
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** 发送语音消息(AI回复用真人声音)；media_id 需先调"上传临时素材"接口拿到 */
export async function sendKfVoice({ openKfid, externalUserid, mediaId }) {
  await claimKfServiceState({ openKfid, externalUserid });
  const accessToken = await getAccessToken();
  const resp = await _fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touser: externalUserid, open_kfid: openKfid, msgtype: 'voice', voice: { media_id: mediaId } }),
    }
  );
  const data = await resp.json();
  if (Number(data?.errcode) !== 0) throw new Error(data?.errmsg || 'kf_send_voice_failed');
  return data;
}

/** 上传临时素材(语音amr/图片等)，供 sendKfVoice 使用；素材3天内有效，用完即传不做缓存 */
export async function uploadKfMedia(buffer, { type = 'voice', filename = 'voice.amr', mimeType } = {}) {
  const accessToken = await getAccessToken();
  const form = new FormData();
  const mime = mimeType || (type === 'voice' ? 'audio/amr' : 'application/octet-stream');
  form.append('media', new Blob([buffer], { type: mime }), filename);
  const resp = await _fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${encodeURIComponent(accessToken)}&type=${type}`,
    { method: 'POST', body: form }
  );
  const data = await resp.json();
  if (!data?.media_id) throw new Error(data?.errmsg || 'kf_media_upload_failed');
  return data.media_id;
}

export async function recordKfDelivery(pool, turn, { status, channel = 'text', result = null, error = null, meta = null } = {}) {
  const messageId = Number(turn?.outbound_message_id || 0);
  if (!messageId || !['sent', 'failed'].includes(status)) return { updated: false };
  const errorText = error ? String(error?.message || error).slice(0, 1000) : null;
  const patch = {
    ...(meta && typeof meta === 'object' ? meta : {}),
    delivery_status: status,
    delivery_channel: channel,
    delivery_updated_at: new Date().toISOString(),
    wecom_msg_id: String(result?.msgid || result?.msg_id || '') || null,
    send_error: errorText,
  };
  await pool.query(
    `UPDATE sales_messages SET meta=COALESCE(meta,'{}'::jsonb) || $2::jsonb WHERE id=$1`,
    [messageId, JSON.stringify(patch)]
  );
  if (status === 'failed' && turn?.lead_id) {
    await pool.query(
      `INSERT INTO sales_lead_events (lead_id,event_type,summary,evidence,priority,recommended_action,payload)
       VALUES ($1,'CUSTOMER_AI_DELIVERY_FAILED',$2,$3,'critical','restore_wecom_session',$4::jsonb)`,
      [turn.lead_id, '客户AI已生成回复，但企业微信发送失败', errorText, JSON.stringify({ message_id: messageId, channel, error: errorText })]
    );
  }
  turn.delivery_status = status;
  if (errorText) turn.send_error = errorText;
  return { updated: true, message_id: messageId, status };
}

/**
 * 处理 kf 回调：拉消息 → 交给 session → 自动回复
 */
export async function processKfCallbackEvent(pool, { token, openKfid }, handleInbound, { notify = null, handleAgentMessage = null } = {}) {
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
  const alertDeliveryFailure = async (turn, error) => {
    if (typeof notify !== 'function') return;
    await notify(
      ['【客户AI·企微发送失败】', `线索ID：${turn?.lead_id || '未知'}`, `消息ID：${turn?.outbound_message_id || '未知'}`, `原因：${String(error?.message || error).slice(0, 500)}`, '回复已标红并写入严重事件，请立即恢复企微会话或人工接管。'].join('\n'),
      { title: '客户AI回复未送达', audience: 'sales' }
    ).catch(() => null);
  };

  for (const m of msgs) {
    if (String(m.msgtype) === 'event') {
      const eventType = String(m.event?.event_type || '');
      if (eventType === 'enter_session') {
        const externalUserid = String(m.external_userid || m.event?.external_userid || '').trim();
        const turn = await handleInbound({
          welcome: true,
          openKfid: String(m.open_kfid || m.event?.open_kfid || kfId),
          externalUserid,
          sourceChannel: 'wecom_kf',
        });
        if (turn?.replied && turn.reply && externalUserid) {
          try {
            const sendResult = await sendKfText({ openKfid: String(m.open_kfid || m.event?.open_kfid || kfId), externalUserid, content: turn.reply });
            await recordKfDelivery(pool, turn, { status: 'sent', channel: 'text', result: sendResult });
            log.info({ msg: 'sales_kf_sendkftext_ok_welcome', detail: [JSON.stringify(sendResult)] });
          } catch (e) {
            await recordKfDelivery(pool, turn, { status: 'failed', channel: 'text', error: e }).catch(() => null);
            await alertDeliveryFailure(turn, e);
            turn.send_error = e?.message || String(e);
            log.error({ msg: 'sales_kf_sendkftext_failed_welcome', detail: [turn.send_error] });
          }
        }
        results.push(turn);
      } else if (eventType === 'session_status_change' && typeof handleAgentMessage === 'function') {
        // 接待人员在企业微信客户端操作触发：1=接入会话 2=转接 3=结束 4=重新接入。
        // 同步进 CRM，人工一旦在客户端回复/接入，GAAS 停止 AI 抢答并记录接管。
        const externalUserid = String(m.external_userid || m.event?.external_userid || '').trim();
        if (externalUserid) {
          await handleAgentMessage({
            eventType,
            openKfid: String(m.open_kfid || kfId),
            externalUserid,
            changeType: Number(m.event?.change_type || 0),
            servicerUserid: String(m.event?.new_servicer_userid || m.event?.old_servicer_userid || '').trim(),
          }).catch((e) => log.warn({ msg: 'sales_kf_session_status_sync_failed', err: e?.message || e }));
        }
      } else if (eventType === 'msg_send_fail' && typeof handleAgentMessage === 'function') {
        const externalUserid = String(m.external_userid || m.event?.external_userid || '').trim();
        if (externalUserid) {
          await handleAgentMessage({
            eventType,
            openKfid: String(m.open_kfid || kfId),
            externalUserid,
            failMsgId: String(m.event?.fail_msgid || ''),
            failType: Number(m.event?.fail_type || 0),
          }).catch(() => null);
        }
      }
      continue;
    }
    const origin = Number(m.origin || 0);
    // origin=5：接待人员在企业微信客户端发送的消息（API 发的消息不会被 sync_msg 回读，
    // 不需要担心和 GAAS 外发重复）。回传 CRM 留痕并自动识别人工接管，不触发 AI 回复。
    if (origin === 5 && typeof handleAgentMessage === 'function') {
      await handleAgentMessage({
        eventType: 'agent_message',
        openKfid: String(m.open_kfid || kfId),
        externalUserid: String(m.external_userid || '').trim(),
        msgId: String(m.msgid || '').trim() || null,
        text: String(m?.text?.content || '').trim(),
        msgtype: String(m.msgtype || ''),
        servicerUserid: String(m.servicer_userid || '').trim(),
      }).catch((e) => log.warn({ msg: 'sales_kf_agent_message_sync_failed', err: e?.message || e }));
      continue;
    }
    let text = '';
    let fromVoice = false;
    if (String(m.msgtype) === 'text') {
      text = String(m?.text?.content || '').trim();
    } else if (String(m.msgtype) === 'voice' && m?.voice?.media_id) {
      try {
        const amrBuffer = await downloadKfMedia(m.voice.media_id);
        const transcribed = await transcribeAmrVoice(amrBuffer);
        if (transcribed) { text = transcribed; fromVoice = true; }
        log.info({ msg: 'sales_kf_voice_transcribed', detail: [JSON.stringify({ media_id: m.voice.media_id, text: transcribed })] });
      } catch (e) {
        log.error({ msg: 'sales_kf_voice_handling_failed', err: e?.message || e });
      }
      if (!text) {
        // 识别失败：走一遍handleInbound只是为了让客户AI能自然地说"没听清"，不当成普通文本消息处理评分等副作用
        const externalUseridFail = String(m.external_userid || '').trim();
        if (externalUseridFail) {
          try {
            await sendKfText({ openKfid: String(m.open_kfid || kfId), externalUserid: externalUseridFail, content: '不好意思，刚才这条语音没听清，麻烦再说一遍，或者打字也行～' });
          } catch (_) { /* ignore */ }
        }
        continue;
      }
    } else {
      continue;
    }
    if (!text) continue;
    const externalUserid = String(m.external_userid || '').trim();
    const msgId = String(m.msgid || '').trim() || null;
    const turn = await handleInbound({
      text,
      openKfid: String(m.open_kfid || kfId),
      externalUserid,
      msgId,
      sourceChannel: 'wecom_kf',
      inputMode: fromVoice ? 'voice' : 'text',
    });
    if (turn?.replied && turn.reply && externalUserid) {
      const replyOpenKfid = String(m.open_kfid || kfId);
      let sentAsVoice = false;
      if (fromVoice) {
        // 客户发语音，镜像用语音回复；合成/上传任何一步失败都静默回退到文字，
        // 不能因为语音链路故障让客户完全收不到回复。
        try {
          const voiceReply = voiceReplyForTurn(turn);
          const { amr, meta: ttsMeta } = await synthesizeSpeechAmr(voiceReply, { rolloutKey: externalUserid });
          if (amr) {
            const mediaId = await uploadKfMedia(amr, { type: 'voice', filename: 'reply.amr' });
            const sendResult = await sendKfVoice({ openKfid: replyOpenKfid, externalUserid, mediaId });
            await recordKfDelivery(pool, turn, { status: 'sent', channel: 'voice', result: sendResult, meta: ttsMeta });
            log.info({ msg: 'sales_kf_sendkfvoice_ok', detail: [JSON.stringify({ ...sendResult, speech_chars: voiceReply.length, speech_mode: turn.speech_reply ? 'conversational' : 'original' })] });
            sentAsVoice = true;
          }
        } catch (e) {
          log.error({ msg: 'sales_kf_sendkfvoice_failed_falling_back_to_text', err: e?.message || e });
        }
      }
      if (!sentAsVoice) {
        try {
          const sendResult = await sendKfText({ openKfid: replyOpenKfid, externalUserid, content: turn.reply });
          await recordKfDelivery(pool, turn, { status: 'sent', channel: 'text', result: sendResult });
          log.info({ msg: 'sales_kf_sendkftext_ok', detail: [JSON.stringify(sendResult)] });
        } catch (e) {
          await recordKfDelivery(pool, turn, { status: 'failed', channel: 'text', error: e }).catch(() => null);
          await alertDeliveryFailure(turn, e);
          turn.send_error = e?.message || String(e);
          log.error({ msg: 'sales_kf_sendkftext_failed', detail: [turn.send_error] });
        }
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
export function voiceReplyForTurn(turn = {}) {
  return String(turn?.speech_reply || turn?.reply || '').trim();
}
