/**
 * 短信模板/签名配置管理 API — sms_templates 表的读写入口。
 * registerSmsTemplateRoutes(app, pool)
 *
 * 取代直接改 .env + 重启进程的老流程：写入立即调用 invalidateSmsTemplatesCache()
 * 刷新内存缓存，下一条短信马上用新配置，不需要重启 hrms-service。
 * 写入时强制校验签名+正文+示例值替换后的字数（SMS_CHAR_LIMIT，见 sms-templates.js），
 * 超限直接拒绝保存，避免"改完模板忘记看字数、发出去才发现拆成多条/被拒收"。
 */
import { requireGrowthAuth, requireGrowthAdminRole, getGrowthOperator } from './growth-api.js';
import { listSmsTemplates, upsertSmsTemplate, SMS_CHAR_LIMIT } from './sms-templates.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

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
        updated_by: getGrowthOperator(req).username
      });
      return res.json({ ok: true, row });
    } catch (e) {
      if (e.message === 'sms_template_too_long') {
        return res.status(422).json({ ok: false, error: 'sms_template_too_long', char_len: e.char_len, limit: e.limit });
      }
      if (e.message === 'missing_brand_suffix_or_slot') {
        return res.status(400).json({ ok: false, error: e.message });
      }
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
