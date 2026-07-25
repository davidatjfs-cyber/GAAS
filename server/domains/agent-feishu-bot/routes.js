/**
 * 飞书机器人事件订阅：/api/feishu/webhook[+/:tenantId]
 * （与 domains/feishu-webhook 的 /api/webhook/feishu 路径不同，并存。）
 */
import { isWebhookEnabled } from '../../safety.js';
import {
  requireWebhookSignatureEnabled,
  verifyFeishuWebhookRequest,
} from '../../utils/feishu-webhook-verify.js';
import { tenantContext } from '../../utils/database.js';
import { getTenantFeishuBotIntegration } from '../../tenant-integrations.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-feishu-bot', handler: 'routes' });


/**
 * @param {import('express').Express} app
 * @param {{
 *   pool: () => import('pg').Pool,
 *   onFeishuEvent: (parsed: object) => Promise<object>,
 * }} deps
 */
export function registerAgentFeishuBotRoutes(app, deps) {
  const { pool, onFeishuEvent } = deps;

  async function handleFeishuWebhookRequest(req, res, { encryptKey, verificationToken, tenantId }) {
    if (!isWebhookEnabled()) {
      return res.status(404).json({ ok: false, error: 'webhook_disabled' });
    }
    try {
      const body = req.body;
      const rawBuf = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body || {}), 'utf8');
      const parsed =
        body && typeof body === 'object' && !Buffer.isBuffer(body)
          ? body
          : (() => {
              try {
                return JSON.parse(rawBuf.toString('utf8'));
              } catch {
                return {};
              }
            })();
      const sigCheck = verifyFeishuWebhookRequest({
        headers: req.headers,
        rawBody: rawBuf,
        parsedBody: parsed,
        encryptKey,
        verificationToken,
        requireSignature: requireWebhookSignatureEnabled(),
      });
      if (!sigCheck.ok) {
        log.warn({ msg: 'feishu_webhook_rejected', detail: [sigCheck.reason] });
        return res.status(401).json({ ok: false, error: sigCheck.reason || 'unauthorized' });
      }
      const result = tenantId
        ? await tenantContext.run(tenantId, () => onFeishuEvent(parsed))
        : await onFeishuEvent(parsed);
      return res.json(result);
    } catch (e) {
      log.error({ msg: 'feishu_webhook_error', err: e?.message });
      return res.status(200).json({ ok: true, error: String(e?.message || e) });
    }
  }

  app.post('/api/feishu/webhook', async (req, res) => {
    const encryptKey = String(
      process.env.FEISHU_ENCRYPT_KEY || process.env.LARK_ENCRYPT_KEY || ''
    ).trim();
    const verificationToken = String(
      process.env.FEISHU_VERIFICATION_TOKEN || process.env.LARK_VERIFICATION_TOKEN || ''
    ).trim();
    return handleFeishuWebhookRequest(req, res, {
      encryptKey,
      verificationToken,
      tenantId: null,
    });
  });

  app.post('/api/feishu/webhook/:tenantId', async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ ok: false, error: 'missing_tenant_id' });
    const encKey = String(process.env.TENANT_INTEGRATION_ENCRYPTION_KEY || '').trim();
    let cfg = null;
    if (encKey) {
      cfg = await tenantContext
        .run(tenantId, () => getTenantFeishuBotIntegration(pool(), tenantId, encKey))
        .catch((e) => {
          log.warn({ msg: 'agent-feishu-bot_routes_warn', detail: [`[feishu webhook] tenant ${tenantId} feishu_bot config unusable:`,
            e?.message] });
          return null;
        });
    }
    const encryptKey =
      cfg?.encrypt_key ||
      String(process.env.FEISHU_ENCRYPT_KEY || process.env.LARK_ENCRYPT_KEY || '').trim();
    const verificationToken =
      cfg?.verification_token ||
      String(
        process.env.FEISHU_VERIFICATION_TOKEN || process.env.LARK_VERIFICATION_TOKEN || ''
      ).trim();
    return handleFeishuWebhookRequest(req, res, { encryptKey, verificationToken, tenantId });
  });
}
