/**
 * Stored-value + campaign routes — thin handlers over service.js.
 * Signature preserved: registerGrowthStoredValueRoutes(app, pool).
 */
import { sendAliyunSms } from '../../sms.js';
import { tenantContext, resolveTenantIdDefault } from '../../utils/database.js';
import {
  requireGrowthAuth,
  getGrowthTenantId,
  resolveTenantIdForStore,
  CAMPAIGN_TYPES,
  freqDaysEnv,
  globalSmsCapped,
  isPhoneSuppressed,
  handleSmsFailure,
  upsertCustomer,
  upsertDeliveryLog,
  insertGrowthEvent,
  pickCampaignTemplate,
  pickCampaignSmsSign,
  formatSmsValidDate,
  pickBalanceTemplateByStore,
  buildCampaignTargetQuery,
  buildRemindTargetsQuery,
  mapStoreNameToId,
  bitText,
  bitNum,
  bitDateMs,
  bitPhone,
  readStoredValueBitableRecords,
  ABC_ROTATION_ORDER,
  ABC_STEP_DEFS,
  deriveAbcStep,
  pickAbcTemplate,
  countCampaignSent,
  campaignTouchCapped,
  marketingFatigueCapped,
} from '../../growth-api.js';
import {
  syncStoredValueMembers,
  listStoredValueTargets,
  previewCampaign,
  launchCampaign,
  sendCampaignSms,
  previewRemind,
  launchRemind,
  campaignFunnel,
} from './service.js';

function buildCtx(pool) {
  return {
    pool,
    sendAliyunSms,
    tenantContext,
    resolveTenantIdDefault,
    resolveTenantIdForStore,
    CAMPAIGN_TYPES,
    freqDaysEnv,
    globalSmsCapped,
    isPhoneSuppressed,
    handleSmsFailure,
    upsertCustomer,
    upsertDeliveryLog,
    insertGrowthEvent,
    pickCampaignTemplate,
    pickCampaignSmsSign,
    formatSmsValidDate,
    pickBalanceTemplateByStore,
    buildCampaignTargetQuery,
    buildRemindTargetsQuery,
    mapStoreNameToId,
    bitText,
    bitNum,
    bitDateMs,
    bitPhone,
    readStoredValueBitableRecords,
    ABC_ROTATION_ORDER,
    ABC_STEP_DEFS,
    deriveAbcStep,
    pickAbcTemplate,
    countCampaignSent,
    campaignTouchCapped,
    marketingFatigueCapped,
  };
}

function send(res, result) {
  return res.status(result.status).json(result.body);
}

export function registerGrowthStoredValueRoutes(app, pool) {
  const ctx = buildCtx(pool);

  app.post('/api/growth/stored-value/sync', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await syncStoredValueMembers(ctx, getGrowthTenantId(req)));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/growth/stored-value/targets', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await listStoredValueTargets(ctx, getGrowthTenantId(req), req.query || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/campaign/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await previewCampaign(ctx, getGrowthTenantId(req), req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/campaign/launch', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await launchCampaign(ctx, getGrowthTenantId(req), req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/campaign/send-sms', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await sendCampaignSms(ctx, req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/stored-value/remind/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await previewRemind(ctx, getGrowthTenantId(req), req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/stored-value/remind/launch', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      return send(res, await launchRemind(ctx, getGrowthTenantId(req), req.body || {}));
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/growth/campaigns/:campaignId/funnel', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    return send(res, await campaignFunnel(ctx, getGrowthTenantId(req), req.params.campaignId));
  });
}
