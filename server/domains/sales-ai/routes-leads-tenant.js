import { ensureSalesTables, listLeads, getLead, upsertTask, transitionLeadStage } from '../../services/sales/sales-store.js';
import {
  handleInboundMessage,
  takeoverConversation,
  releaseToAi,
  getLeadDetail,
  recordSalesReply,
  detectOvercommitment,
} from '../../services/sales/sales-session.js';
import { draftCustomerReply, draftStandardResponse, draftQuickReplyByScenario } from '../../services/sales/sales-reply-draft.js';
import { checkPricePermission } from '../../services/sales/sales-price-policy.js';
import { buildLeadSummary, calculateSla } from '../../services/sales/sales-collaboration-service.js';
import { getUnifiedCustomerTimeline } from '../../services/sales/sales-timeline.js';
import { buildTenantMonthlyValueReport } from '../../services/sales/tenant-value-report.js';
import { getOnboardingChecklist } from '../../services/sales/tenant-onboarding.js';
import { computeRenewalHealth, listRenewalRisks, listReferralCandidates } from '../../services/sales/tenant-renewal-service.js';
import { maskLeadContact, maskLeadListContact, canViewFullContact } from '../../services/sales/sales-privacy.js';
import { sensitiveRateLimit } from '../../services/sales/sales-rate-limit.js';
import { leadScopeSql, canAccessLead, canAccessTenant } from '../../services/sales/sales-permissions.js';
import { kfConfigured } from '../../services/sales/sales-kf.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-leads' });


/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object }} ctx */

/** @param { app: any, pool: any, platformAdminRequired: Function, gates: object } ctx */
export function registerSalesAiLeadsTenantRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates } = ctx;
  const { contractPriceGate } = gates;

  app.post('/api/internal/sales/tenant-onboarding-checklist', async (req, res) => {
    try {
      const secret = String(req.headers['x-miniprogram-sync-secret'] || '');
      const expected = String(process.env.MINIPROGRAM_SYNC_SECRET || process.env.HRMS_GROWTH_EVENT_SECRET || '');
      if (!expected || secret !== expected) return res.status(401).json({ ok: false, error: 'unauthorized' });
      const data = await getOnboardingChecklist(pool, req.body?.tenant_id);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      log.error({ msg: 'sales_internal_onboarding_checklist', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 客户上线进度清单：新开通租户是否具备"数据条件+基础配置"就绪，复用已有巡检信号
  app.get('/api/admin/sales/tenants/:tenantId/onboarding', platformAdminRequired, sensitiveRateLimit('tenant_onboarding'), async (req, res) => {
    try {
      if (!(await canAccessTenant(pool, req.platformAdmin, req.params.tenantId))) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await getOnboardingChecklist(pool, req.params.tenantId);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      log.error({ msg: 'sales_onboarding_checklist', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 单租户续费健康度：透明加减分，续费风险/转介绍候选列表都是基于这个分数派生的
  app.get('/api/admin/sales/tenants/:tenantId/renewal-health', platformAdminRequired, sensitiveRateLimit('tenant_renewal_health'), async (req, res) => {
    try {
      if (!(await canAccessTenant(pool, req.platformAdmin, req.params.tenantId))) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await computeRenewalHealth(pool, req.params.tenantId);
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      log.error({ msg: 'sales_renewal_health', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 续费风险清单：分数<60或授权14天内到期的租户，按风险从高到低排；非manager只看自己范围内的租户
  app.get('/api/admin/sales/renewal-risks', platformAdminRequired, sensitiveRateLimit('renewal_risks'), async (req, res) => {
    try {
      const all = await listRenewalRisks(pool, { limit: Number(req.query.limit) || 50 });
      const items = [];
      for (const item of all) {
        if (await canAccessTenant(pool, req.platformAdmin, item.tenant_id)) items.push(item);
      }
      res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'sales_renewal_risks', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 转介绍候选：稳定使用满60天、健康分≥80、无逾期异常的客户；非manager只看自己范围内的租户
  app.get('/api/admin/sales/referral-candidates', platformAdminRequired, sensitiveRateLimit('referral_candidates'), async (req, res) => {
    try {
      const all = await listReferralCandidates(pool, { limit: Number(req.query.limit) || 50 });
      const items = [];
      for (const item of all) {
        if (await canAccessTenant(pool, req.platformAdmin, item.tenant_id)) items.push(item);
      }
      res.json({ ok: true, items });
    } catch (e) {
      log.error({ msg: 'sales_referral_candidates', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  // 月度客户价值报告：证明续费理由，供销售/客户成功在续费沟通前查看或发送给客户
  app.get('/api/admin/sales/tenants/:tenantId/value-report', platformAdminRequired, sensitiveRateLimit('tenant_value_report'), async (req, res) => {
    try {
      if (!(await canAccessTenant(pool, req.platformAdmin, req.params.tenantId))) return res.status(404).json({ ok: false, error: 'not_found' });
      const data = await buildTenantMonthlyValueReport(pool, req.params.tenantId, { month: req.query.month });
      res.status(data.ok ? 200 : 400).json(data);
    } catch (e) {
      log.error({ msg: 'sales_tenant_value_report', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
