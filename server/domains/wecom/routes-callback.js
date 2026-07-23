import { verifyKfSignature, decryptKfEcho } from '../../services/sales/sales-kf.js';

/**
 * WeCom generic callback URL (Wave 4o — behavior-preserving extract from index.js, with KF crypto helpers).
 * @param {import('express').Express} app
 */
export function registerWecomCallbackRoutes(app) {
  app.get('/api/wecom/callback', (req, res) => {
    const token = String(process.env.WECOM_CALLBACK_TOKEN || '').trim();
    const aesKey = String(process.env.WECOM_CALLBACK_AES_KEY || '').trim();
    const { msg_signature, timestamp, nonce, echostr } = req.query || {};
    if (token && aesKey && msg_signature && echostr) {
      try {
        const expect = verifyKfSignature(token, timestamp, nonce, echostr);
        if (expect !== String(msg_signature)) return res.status(401).send('invalid signature');
        return res.send(decryptKfEcho(String(echostr), aesKey));
      } catch (e) {
        return res.status(400).send('decrypt failed');
      }
    }
    if (echostr) return res.send(String(echostr)); // 明文模式兜底
    return res.send('ok');
  });
  // 被动接收消息：仅回执，不处理（系统为单向群发）
  app.post('/api/wecom/callback', (req, res) => res.send(''));
}
