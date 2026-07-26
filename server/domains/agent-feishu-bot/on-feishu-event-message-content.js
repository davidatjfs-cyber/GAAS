import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-feishu-bot', handler: 'on-feishu-event-message-content' });

/**
 * @param {object} deps
 * @param {{ msg: object, msgType: string, messageId: string, openId: string }} ctx
 * @returns {Promise<{ text: string, imageUrls: string[], earlyReturn?: object }>}
 */
export async function extractFeishuMessageContent(deps, { msg, msgType, messageId, openId }) {
  const { sendLarkMessage, getLarkImageUrl, recognizeLarkAudio } = deps;
  let text = '';
  let imageUrls = [];

  if (msgType === 'text') {
    try {
      text = String(JSON.parse(msg?.content || '{}').text || '').trim();
    } catch {
      text = String(msg?.content || '').trim();
    }
    if (msg?.mentions?.length) {
      for (const m of msg.mentions) {
        text = text.replace(new RegExp(`@${m.name || ''}`, 'g'), '').trim();
      }
    }
  } else if (msgType === 'image') {
    try {
      const content = JSON.parse(msg?.content || '{}');
      const imageKey = content?.image_key || '';
      if (imageKey && messageId) {
        log.info({ msg: 'downloading_image', image_key: imageKey });
        const imgUrl = await getLarkImageUrl(messageId, imageKey);
        if (imgUrl) imageUrls.push(imgUrl);
      }
    } catch (e) {
      log.error({ msg: 'parse_image_failed', err: String(e?.message || e) });
    }
  } else if (msgType === 'audio') {
    try {
      const content = JSON.parse(msg?.content || '{}');
      const fileKey = content?.file_key || '';
      if (fileKey && messageId) {
        const recognized = await recognizeLarkAudio(messageId, fileKey);
        if (recognized) {
          text = recognized;
          log.info({ msg: 'voice_to_text', preview: text.slice(0, 60) });
        } else {
          await sendLarkMessage(openId, '🎙️ 语音识别未成功，请再试一次或用文字描述。', {
            skipDedup: true,
          });
          return { text: '', imageUrls: [], earlyReturn: { ok: true, skipped: 'asr_empty' } };
        }
      } else {
        await sendLarkMessage(openId, '🎙️ 语音消息格式异常，请用文字描述你的问题。', {
          skipDedup: true,
        });
        return { text: '', imageUrls: [], earlyReturn: { ok: true, skipped: 'audio_no_filekey' } };
      }
    } catch (e) {
      log.error({ msg: 'audio_parse_failed', err: String(e?.message || e) });
      await sendLarkMessage(openId, '🎙️ 语音识别服务暂时不可用，请用文字描述。', {
        skipDedup: true,
      });
      return { text: '', imageUrls: [], earlyReturn: { ok: true, skipped: 'asr_error' } };
    }
  } else {
    await sendLarkMessage(
      openId,
      `收到${msgType}消息。目前支持文字和图片，请用文字描述或发送照片。`
    );
    return { text: '', imageUrls: [], earlyReturn: { ok: true, skipped: 'unsupported_type' } };
  }

  return { text, imageUrls };
}
