/**
 * Winback + touch-rules routes — thin handlers over service.js.
 * Signature preserved: registerGrowthWinbackRoutes(app, pool).
 */
import { sendAliyunSms } from '../../sms.js';
import { tenantContext } from '../../utils/database.js';
import {
  requireGrowthAuth,
  getGrowthOperator,
  getGrowthTenantId,
  resolveTenantIdForStore,
  pickWinbackTemplateByStore,
  freqDaysEnv,
  globalSmsCapped,
  isPhoneSuppressed,
  upsertCustomer,
  upsertDeliveryLog,
  insertGrowthEvent,
  handleSmsFailure,
  inSmsQuietHours,
  CAMPAIGN_TYPES,
  getTouchRulesAudience,
} from '../../growth-api.js';
import {
  sendWinbackSms,
  previewWinback,
  launchWinback,
  listPendingJobs,
  reportJobResult,
  listJobs,
  listTouchRules,
  upsertTouchRule,
  approveTouchRule,
  unapproveTouchRule,
  touchRulesStats,
  touchRulesAudience,
} from './service.js';

function buildCtx(pool) {
  return {
    pool,
    sendAliyunSms,
    tenantContext,
    resolveTenantIdForStore,
    pickWinbackTemplateByStore,
    freqDaysEnv,
    globalSmsCapped,
    isPhoneSuppressed,
    upsertCustomer,
    upsertDeliveryLog,
    insertGrowthEvent,
    handleSmsFailure,
    inSmsQuietHours,
    CAMPAIGN_TYPES,
    getTouchRulesAudience,
  };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthWinbackRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.post('/api/growth/winback/send-sms', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await sendWinbackSms(ctx, req.body));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/growth/winback/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(
        res,
        await previewWinback(ctx, {
          store_id: req.query.store_id,
          dormant_days: req.query.dormant_days,
          min_balance_yuan: req.query.min_balance_yuan,
          freq_days: req.query.freq_days,
          tenantId: getGrowthTenantId(req),
        })
      );
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/winback/launch', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await launchWinback(ctx, req.body, getGrowthTenantId(req)));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/growth/winback/pending-jobs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await listPendingJobs(ctx, getGrowthTenantId(req)));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/winback/job-result', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await reportJobResult(ctx, req.body, getGrowthTenantId(req)));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/growth/winback/jobs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(
        res,
        await listJobs(ctx, { limit: req.query.limit, tenantId: getGrowthTenantId(req) })
      );
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/growth/touch-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await listTouchRules(ctx, getGrowthTenantId(req)));
  });

  app.post('/api/growth/touch-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await upsertTouchRule(ctx, req.body, getGrowthTenantId(req)));
  });

  app.post('/api/growth/touch-rules/:ruleKey/approve', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const operator = getGrowthOperator(req);
    return send(
      res,
      await approveTouchRule(ctx, {
        ruleKey: req.params.ruleKey,
        operatorUsername: operator.username || 'system',
        owner: req.body?.owner,
        tenantId: getGrowthTenantId(req),
      })
    );
  });

  app.post('/api/growth/touch-rules/:ruleKey/unapprove', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await unapproveTouchRule(ctx, {
        ruleKey: req.params.ruleKey,
        tenantId: getGrowthTenantId(req),
      })
    );
  });

  app.get('/api/growth/touch-rules/stats', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await touchRulesStats(ctx, { days: req.query.days, tenantId: getGrowthTenantId(req) })
    );
  });

  app.get('/api/growth/touch-rules/audience', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(
      res,
      await touchRulesAudience(ctx, {
        store_id: req.query.store_id,
        refresh: req.query.refresh,
        tenantId: getGrowthTenantId(req),
      })
    );
  });
}
