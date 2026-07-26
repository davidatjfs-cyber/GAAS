import { ensureSalesTables, listLeads } from '../../services/sales/sales-store.js';
import { getLeadDetail } from '../../services/sales/sales-session.js';
import {
  buildBossDailyReport,
  buildSalesTodoList,
  buildRiskCustomers,
  buildFunnelStats,
  buildTomorrowActions,
  buildTopHighLeads,
  buildDemoBrief,
} from '../../services/sales/sales-ops.js';

import { buildVoiceQualityReport } from '../../services/sales/sales-voice-quality.js';

import { leadScopeSql } from '../../services/sales/sales-permissions.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales-ai', handler: 'routes-ops' });

/** @param {{ app: any, pool: any, platformAdminRequired: Function, gates: object, sendOpsAlert?: Function }} ctx */
export function registerSalesAiOpsReportRoutes(ctx) {
  const { app, pool, platformAdminRequired, gates, sendOpsAlert } = ctx;
  const { managerGate: _managerGate } = gates;

  app.get('/api/admin/sales/daily-report', platformAdminRequired, async (_req, res) => {
    try {
      res.json(await buildBossDailyReport(pool));
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/admin/sales/daily-report/send', platformAdminRequired, async (_req, res) => {
    try {
      const report = await buildBossDailyReport(pool);
      if (typeof sendOpsAlert === 'function') await sendOpsAlert(report.text, { title: '销售AI日报', audience: 'sales' });
      res.json({ ok: true, report });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/voice-quality', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      res.json(await buildVoiceQualityReport(pool, { days: req.query?.days }));
    } catch (e) {
      log.error({ msg: 'sales_ai_voice_quality_report_failed', err: e?.message || e });
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/todo', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, todos: buildSalesTodoList(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/risks', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, risks: buildRiskCustomers(leads), tomorrow_actions: buildTomorrowActions(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/top5', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 300 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, top5: buildTopHighLeads(leads) });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/leads/:id/demo-brief', platformAdminRequired, async (req, res) => {
    try {
      const detail = await getLeadDetail(pool, Number(req.params.id));
      if (!detail.ok) return res.status(404).json(detail);
      const brief = buildDemoBrief(detail.lead, detail.funnel || {});
      res.json({ ok: true, brief, text: [
        `【会前简报】${brief.customer}`,
        `门店 ${brief.store_count}｜菜系 ${brief.cuisine}｜城市 ${brief.city}｜POS ${brief.pos}`,
        `主要问题：${(brief.main_problems || []).join('；')}`,
        `本次目标：${(brief.this_meeting_goal || []).join('、')}`,
        `建议展示：${(brief.suggested_pages || []).join('、')}`,
      ].join('\n') });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/admin/sales/funnel', platformAdminRequired, async (req, res) => {
    try {
      await ensureSalesTables(pool);
      const leads = await listLeads(pool, { limit: 500 }, leadScopeSql(req.platformAdmin, 4));
      res.json({ ok: true, funnel: buildFunnelStats(leads), count: leads.length });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });
}
