/**
 * SMS template CRUD routes — thin handlers.
 * Signature preserved: registerSmsTemplateRoutes(app, pool).
 */
import {
  requireGrowthAuth,
  requireGrowthAdminRole,
  getGrowthOperator,
} from '../../growth-api.js';
import { listSmsTemplates, upsertSmsTemplate, SMS_CHAR_LIMIT } from '../../sms-templates.js';
import { cleanText } from './helpers.js';

export function registerSmsTemplateRoutes(app, pool) {
  app.get('/api/growth/sms-templates', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const tenantId = cleanText(req.query.tenant_id, 128) || 'default';
    try {
      const rows = await listSmsTemplates(pool, { tenantId });
      return res.json({ ok: true, rows, char_limit: SMS_CHAR_LIMIT });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/sms-templates', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    if (!requireGrowthAdminRole(req, res)) return;
    const b = req.body || {};
    try {
      const row = await upsertSmsTemplate(pool, {
        tenant_id: cleanText(b.tenant_id, 128) || 'default',
        brand_suffix: cleanText(b.brand_suffix, 40),
        slot: cleanText(b.slot, 60),
        template_code: cleanText(b.template_code, 64),
        sign_name: cleanText(b.sign_name, 40),
        content: String(b.content || '').slice(0, 500),
        vars: Array.isArray(b.vars) ? b.vars : [],
        sample_values: b.sample_values && typeof b.sample_values === 'object' ? b.sample_values : {},
        updated_by: getGrowthOperator(req).username,
      });
      return res.json({ ok: true, row });
    } catch (e) {
      if (e.message === 'sms_template_too_long') {
        return res
          .status(422)
          .json({ ok: false, error: 'sms_template_too_long', char_len: e.char_len, limit: e.limit });
      }
      if (e.message === 'missing_brand_suffix_or_slot') {
        return res.status(400).json({ ok: false, error: e.message });
      }
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
