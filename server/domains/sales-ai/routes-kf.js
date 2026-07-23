import { handleInboundMessage } from '../../services/sales/sales-session.js';
import {
  kfConfigured,
  kfEnv,
  verifyKfSignature,
  decryptKfEcho,
  decryptKfMessage,
  processKfCallbackEvent,
} from '../../services/sales/sales-kf.js';

/** @param {{ app: any, pool: any, sendOpsAlert?: Function }} ctx */
export function registerSalesAiKfRoutes(ctx) {
  const { app, pool, sendOpsAlert } = ctx;

  app.get('/api/wecom/kf/callback', (req, res) => {
    const env = kfEnv();
    const { msg_signature, timestamp, nonce, echostr } = req.query || {};
    if (env.token && env.aesKey && msg_signature && echostr) {
      try {
        const expect = verifyKfSignature(env.token, timestamp, nonce, echostr);
        if (expect !== String(msg_signature)) return res.status(401).send('invalid signature');
        return res.send(decryptKfEcho(String(echostr), env.aesKey));
      } catch (e) {
        return res.status(400).send('decrypt failed');
      }
    }
    if (echostr) return res.send(String(echostr));
    return res.send('ok');
  });

  app.post('/api/wecom/kf/callback', async (req, res) => {
    res.send('success');
    try {
      if (!kfConfigured()) {
        console.warn('[sales-kf] callback received but KF not configured');
        return;
      }
      const env = kfEnv();
      let token = '';
      let openKfid = env.openKfid;
      const encrypt = req.body?.Encrypt || req.body?.encrypt;
      const { msg_signature, timestamp, nonce } = req.query || {};
      if (env.token && encrypt && msg_signature) {
        const expect = verifyKfSignature(env.token, timestamp, nonce, encrypt);
        if (expect !== String(msg_signature)) {
          console.warn('[sales-kf] callback signature mismatch, ignoring');
          return;
        }
      }
      if (encrypt && env.aesKey) {
        try {
          const plain = decryptKfMessage(String(encrypt), env.aesKey);
          // 企微自建应用一个回调地址会推送多种事件类型；"外部联系人变更回调"和"微信客服
          // 消息和事件"共用同一个URL/Token/EncodingAESKey，这里先分流给客户联系事件处理，
          // 命中就直接返回，不再走下面 KF 消息同步的逻辑。
          const { handleExternalContactChangeEvent } = await import('./services/sales/wecom-contact-events.js');
          if (await handleExternalContactChangeEvent(pool, plain)) return;
          const tokenM = plain.match(/<Token><!\[CDATA\[(.*?)\]\]><\/Token>/) || plain.match(/"Token"\s*:\s*"([^"]+)"/);
          const kfM = plain.match(/<OpenKfId><!\[CDATA\[(.*?)\]\]><\/OpenKfId>/) || plain.match(/"OpenKfId"\s*:\s*"([^"]+)"/);
          if (tokenM) token = tokenM[1];
          if (kfM) openKfid = kfM[1];
        } catch (e) {
          console.error('[sales-kf] decrypt body failed', e?.message || e);
        }
      }
      token = token || String(req.body?.Token || req.query?.token || '');
      await processKfCallbackEvent(pool, { token, openKfid }, (payload) => handleInboundMessage(pool, payload), { notify: sendOpsAlert });
    } catch (e) {
      console.error('[sales-kf] callback handle failed', e?.message || e);
    }
  });
}
