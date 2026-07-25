/**
 * Feishu webhook HTTP endpoint (Wave 4q — behavior-preserving extract from index.js ~8348–8459).
 */
import { childLogger } from '../../utils/logger.js';
import { processFeishuDataChange } from './process-data-change.js';

const log = childLogger({ domain: 'feishu-webhook', handler: 'routes' });

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerFeishuWebhookRoutes(app, deps) {
  const {
    express,
    pool,
    isWebhookEnabled,
    tryParseJson,
    verifyFeishuWebhookRequest,
    requireWebhookSignature,
    decryptFeishuEncryptPayload,
    resolveWebhookTenantId,
    tenantContext,
    randomUUID,
    safeErrMessage,
    notifyAdminsDualWriteFailure,
    onFeishuEvent,
    resolveTenantIdDefault,
    loadTenantFeishuBitableConfig,
    getFeishuTokenByConfig,
    getFeishuAccessToken,
    getFeishuBitableData,
    findConfigKeyByTableInfo,
    upsertFeishuGenericRecord,
    mapFeishuFieldToHrms,
    upsertTableVisitRecordFromMapped,
  } = deps;

  const dataChangeCtx = {
    pool,
    safeErrMessage,
    resolveTenantIdDefault,
    loadTenantFeishuBitableConfig,
    getFeishuTokenByConfig,
    getFeishuAccessToken,
    getFeishuBitableData,
    findConfigKeyByTableInfo,
    upsertFeishuGenericRecord,
    mapFeishuFieldToHrms,
    upsertTableVisitRecordFromMapped,
    notifyAdminsDualWriteFailure,
  };

  app.post('/api/webhook/feishu', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!isWebhookEnabled()) return res.status(404).send('Not found');
    log.info({
      msg: 'feishu_webhook_received',
      request_timestamp: req.headers['x-lark-request-timestamp'] || null,
    });

    try {
      const body = req.body;
      const rawBuf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body || {}), 'utf8');
      const rawText = rawBuf.toString('utf8');
      let data = tryParseJson(rawText) || (body && typeof body === 'object' ? body : null);
      if (!data) {
        return res.status(400).json({ code: 400, message: 'invalid_json' });
      }

      const encryptKey = String(process.env.FEISHU_ENCRYPT_KEY || process.env.LARK_ENCRYPT_KEY || '').trim();
      const verificationToken = String(process.env.FEISHU_VERIFICATION_TOKEN || process.env.LARK_VERIFICATION_TOKEN || '').trim();
      const sigCheck = verifyFeishuWebhookRequest({
        headers: req.headers,
        rawBody: rawBuf,
        parsedBody: data,
        encryptKey,
        verificationToken,
        requireSignature: requireWebhookSignature(),
      });
      if (!sigCheck.ok) {
        log.warn({ msg: 'feishu_webhook_sig_rejected', reason: sigCheck.reason || null });
        return res.status(401).json({ code: 401, message: sigCheck.reason || 'unauthorized' });
      }
      if (sigCheck.mode === 'skipped' && requireWebhookSignature() === false && (encryptKey || verificationToken)) {
        // 非强制模式：有密钥但未带签名时仅告警，保持现网兼容
        if (!req.headers['x-lark-signature']) {
          log.warn({ msg: 'feishu_webhook_sig_skipped' });
        }
      }

      // Decrypt encrypted payload if present
      if (data.encrypt) {
        try {
          const decrypted = decryptFeishuEncryptPayload(data.encrypt);
          const parsed = tryParseJson(decrypted);
          if (parsed) data = parsed;
        } catch (e) {
          log.error({ msg: 'feishu_webhook_decrypt_failed', err: e?.message || String(e) });
          return res.status(400).json({ code: 400, message: 'decrypt_failed' });
        }
      }

      // 解密后再校验 Verification Token（加密包场景）
      if (verificationToken && requireWebhookSignature()) {
        const tokenAfter = String(data?.token || data?.header?.token || '').trim();
        if (tokenAfter && tokenAfter !== verificationToken) {
          return res.status(401).json({ code: 401, message: 'bad_verification_token' });
        }
      }

      // URL验证模式（飞书首次配置webhook时）
      if (data.type === 'url_verification') {
        log.info({ msg: 'feishu_webhook_url_verification' });
        return res.json({ challenge: data.challenge });
      }

      // 处理业务数据变更事件
      if (data.header?.event_type === 'bitable.record.changed') {
        // webhook 无 JWT/ALS 租户上下文，通过 app_token 反查 tenant_id（5分钟缓存）。
        // 新租户只需在 tenant_integrations 配置 feishu_bitable，无需改代码。
        const event = data.event;
        const webhookTenantId = await resolveWebhookTenantId(event?.app_token).catch(() => 'default');
        return await tenantContext.run(webhookTenantId, async () => {
          const logId = randomUUID();

          // 记录同步日志
          await pool.query(
            `insert into feishu_sync_logs (id, event_type, table_id, record_id, data, sync_status, tenant_id)
         values ($1, $2, $3, $4, $5, 'pending', $6)`,
            [logId, data.header.event_type, event.app_token, event.record_id, event, webhookTenantId]
          );

          // 异步处理数据同步
          setImmediate(async () => {
            try {
              await processFeishuDataChange(event, logId, dataChangeCtx);
            } catch (error) {
              log.error({ msg: 'feishu_webhook_async_failed', err: safeErrMessage(error) });
              await pool.query(
                'update feishu_sync_logs set sync_status = $1, error_message = $2, processed_at = now() where id = $3',
                ['failed', safeErrMessage(error), logId]
              );
              void notifyAdminsDualWriteFailure('飞书 Webhook → DB（bitable.record.changed 异步处理失败）', error);
            }
          });

          return res.json({ code: 0, message: 'success' });
        });
      }

      // Forward all non-bitable events to agents handler (bot replies, card actions, etc.)
      try {
        const resp = await onFeishuEvent(data);
        return res.json(resp || { ok: true });
      } catch (e) {
        log.error({ msg: 'feishu_webhook_on_event_failed', err: e?.message || String(e) });
        return res.status(500).json({ code: 500, message: 'agent_error' });
      }

      // 其他事件类型（onFeishuEvent 正常返回后不可达；保留以防未来改动）
      log.info({ msg: 'feishu_webhook_unhandled_event', event_type: data.header?.event_type || null });
      return res.json({ code: 0, message: 'ignored' });
    } catch (error) {
      log.error({ msg: 'feishu_webhook_failed', err: error?.message || String(error) });
      return res.status(500).json({ code: 500, message: 'internal error' });
    }
  });
}
