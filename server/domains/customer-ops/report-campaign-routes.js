/**
 * Customer-ops report + campaign mutation routes (P5.4 extract).
 */
import {
  buildCustomerAssetMetricsInput,
  buildOperationImprovementMetricsInput,
  buildTalentDevelopmentMetricsInput,
  enrichReportForBusinessOntology,
} from '../../ontology/report-metrics-adapters.js';
import { reviewOntologyTaskHistory } from '../../ontology/ontology-task-adapter.js';
import { buildExecutionLedger } from '../../services/execution-ledger-service.js';
import {
  cleanText,
  saveCampaignResultAsLearning,
} from './ops-helpers.js';
import {
  buildCustomerAssetReport,
  buildOpsRectificationReport,
  buildTalentGrowthReport,
} from './report-builders.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'customer-ops', handler: 'report-campaign-routes' });

export function registerCustomerOpsReportCampaignRoutes(app, {
  pool,
  authRequired,
  basePath,
  getTenantId,
  ensureCustomerOpsTables,
  buildAttributionReport,
  applyReportMetricFacts,
}) {
  // AI客户增长归因报表：用触达日志匹配POS回店订单，证明系统维护动作带来的可归因营业额。
  app.get(`${basePath}/attribution-report`, authRequired, async (req, res) => {
    try {
      const report = await buildAttributionReport(pool, getTenantId(req), {
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        storeId: req.query.store_id,
        windowDays: req.query.window_days,
      });
      res.json(report);
    } catch (e) {
      log.error({ msg: 'customer_ops_attribution_report_failed', err: e?.message || String(e) });
      res.status(500).json({ ok: false, error: e?.message || 'attribution_report_failed' });
    }
  });

  app.get(`${basePath}/reports/customer-assets`, authRequired, async (req, res) => {
    try {
      const report = await buildCustomerAssetReport(pool, getTenantId(req), {
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        storeId: req.query.store_id || req.query.storeId,
      });
      await applyReportMetricFacts(pool, getTenantId(req), report.report, 'customer_assets', req.query.store_id || req.query.storeId);
      const enriched = enrichReportForBusinessOntology(report.report, buildCustomerAssetMetricsInput);
      enriched.previousActionReview = await reviewOntologyTaskHistory(pool, { tenantId: getTenantId(req), storeId: req.query.store_id || req.query.storeId, reportType: 'customer_assets' }).catch(() => ({ resultReviewStatus: 'insufficient_data', tasksCreated: 0, tasksCompleted: 0, tasks: [], summary: '上期动作已有记录，但当前追踪数据不足，暂无法判断改善结果。' }));
      enriched.customerNonExecution = await buildExecutionLedger(pool, { tenantId: getTenantId(req), storeId: req.query.store_id || req.query.storeId, dateFrom: req.query.date_from, dateTo: req.query.date_to }).catch((e) => ({ ok: false, statement: e?.message || 'ledger_unavailable', items: [] }));
      res.json({ ...report, report: enriched });
    } catch (e) {
      log.error({ msg: 'customer_ops_customer_asset_report_failed', err: e?.message || String(e) });
      res.status(500).json({ ok: false, error: e?.message || 'customer_asset_report_failed' });
    }
  });

  app.get(`${basePath}/reports/ops-rectification`, authRequired, async (req, res) => {
    try {
      const report = await buildOpsRectificationReport(pool, getTenantId(req), {
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        storeId: req.query.store_id || req.query.storeId,
      });
      await applyReportMetricFacts(pool, getTenantId(req), report.report, 'ops_rectification', req.query.store_id || req.query.storeId);
      const enriched = enrichReportForBusinessOntology(report.report, buildOperationImprovementMetricsInput);
      enriched.previousActionReview = await reviewOntologyTaskHistory(pool, { tenantId: getTenantId(req), storeId: req.query.store_id || req.query.storeId, reportType: 'ops_rectification' }).catch(() => ({ resultReviewStatus: 'insufficient_data', tasksCreated: 0, tasksCompleted: 0, tasks: [], summary: '上期动作已有记录，但当前追踪数据不足，暂无法判断改善结果。' }));
      enriched.customerNonExecution = await buildExecutionLedger(pool, { tenantId: getTenantId(req), storeId: req.query.store_id || req.query.storeId, dateFrom: req.query.date_from, dateTo: req.query.date_to }).catch((e) => ({ ok: false, statement: e?.message || 'ledger_unavailable', items: [] }));
      res.json({ ...report, report: enriched });
    } catch (e) {
      log.error({ msg: 'customer_ops_ops_rectification_report_failed', err: e?.message || String(e) });
      res.status(500).json({ ok: false, error: e?.message || 'ops_rectification_report_failed' });
    }
  });

  app.get(`${basePath}/reports/talent-growth`, authRequired, async (req, res) => {
    try {
      const report = await buildTalentGrowthReport(pool, getTenantId(req), {
        dateFrom: req.query.date_from,
        dateTo: req.query.date_to,
        storeId: req.query.store_id || req.query.storeId,
      });
      await applyReportMetricFacts(pool, getTenantId(req), report.report, 'talent_growth', req.query.store_id || req.query.storeId);
      const enriched = enrichReportForBusinessOntology(report.report, buildTalentDevelopmentMetricsInput);
      enriched.previousActionReview = await reviewOntologyTaskHistory(pool, { tenantId: getTenantId(req), storeId: req.query.store_id || req.query.storeId, reportType: 'talent_growth' }).catch(() => ({ resultReviewStatus: 'insufficient_data', tasksCreated: 0, tasksCompleted: 0, tasks: [], summary: '上期动作已有记录，但当前追踪数据不足，暂无法判断改善结果。' }));
      enriched.customerNonExecution = await buildExecutionLedger(pool, { tenantId: getTenantId(req), storeId: req.query.store_id || req.query.storeId, dateFrom: req.query.date_from, dateTo: req.query.date_to }).catch((e) => ({ ok: false, statement: e?.message || 'ledger_unavailable', items: [] }));
      res.json({ ...report, report: enriched });
    } catch (e) {
      log.error({ msg: 'customer_ops_talent_growth_report_failed', err: e?.message || String(e) });
      res.status(500).json({ ok: false, error: e?.message || 'talent_growth_report_failed' });
    }
  });

  app.post(`${basePath}/campaigns`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const b = req.body || {};
      const title = cleanText(b.title || '', 200);
      if (!title) return res.status(400).json({ ok: false, error: 'title_required' });
      const r = await pool.query(
        `INSERT INTO marketing_campaigns (tenant_id, title, channel, campaign_type, status, planned_date, planned_end_date, store_ids, target_audience, target_count, content, goal, budget, reminder_date, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [tenantId, title, cleanText(b.channel || 'offline', 40), cleanText(b.campaign_type || '其他', 40), cleanText(b.status || 'planned', 20), b.planned_date || null, b.planned_end_date || null, JSON.stringify(b.store_ids || []), cleanText(b.target_audience || '', 500), Number(b.target_count || 0), cleanText(b.content || '', 2000), cleanText(b.goal || '', 500), Number(b.budget || 0), b.reminder_date || null, cleanText(b.source || 'manual', 40), req.user?.username || '']
      );
      res.json({ ok: true, campaign: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.put(`${basePath}/campaigns/:id`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const b = req.body || {};
      const r = await pool.query(
        `UPDATE marketing_campaigns SET title=$1, channel=$2, campaign_type=$3, status=$4, planned_date=$5, planned_end_date=$6, store_ids=$7::jsonb, target_audience=$8, target_count=$9, content=$10, goal=$11, budget=$12, reminder_date=$13, updated_at=NOW()
         WHERE id=$14 AND tenant_id=$15 RETURNING *`,
        [cleanText(b.title || '', 200), cleanText(b.channel || 'offline', 40), cleanText(b.campaign_type || '其他', 40), cleanText(b.status || 'planned', 20), b.planned_date || null, b.planned_end_date || null, JSON.stringify(b.store_ids || []), cleanText(b.target_audience || '', 500), Number(b.target_count || 0), cleanText(b.content || '', 2000), cleanText(b.goal || '', 500), Number(b.budget || 0), b.reminder_date || null, req.params.id, tenantId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, campaign: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.delete(`${basePath}/campaigns/:id`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      await pool.query(`DELETE FROM marketing_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, getTenantId(req)]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 门店复盘结果
  app.post(`${basePath}/campaigns/:id/results`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const b = req.body || {};
      const r = await pool.query(
        `INSERT INTO marketing_campaign_results (tenant_id, campaign_id, store_id, store_name, actual_send_count, actual_reach_count, actual_conversion_count, actual_revenue, actual_exposure_count, actual_redemption_count, actual_cost, effect_rating, result_note, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [tenantId, req.params.id, cleanText(b.store_id || '', 80), cleanText(b.store_name || '', 120), Number(b.actual_send_count || 0), Number(b.actual_reach_count || 0), Number(b.actual_conversion_count || 0), Number(b.actual_revenue || 0), Number(b.actual_exposure_count || 0), Number(b.actual_redemption_count || 0), Number(b.actual_cost || 0), cleanText(b.effect_rating || '', 20), cleanText(b.result_note || '', 2000), req.user?.username || '']
      );
      const campaignRow = await pool.query(`SELECT * FROM marketing_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, tenantId]);
      await saveCampaignResultAsLearning(pool, tenantId, campaignRow.rows[0], r.rows[0]);
      res.json({ ok: true, result: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.put(`${basePath}/campaigns/:id/results/:resultId`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const b = req.body || {};
      const r = await pool.query(
        `UPDATE marketing_campaign_results SET store_id=$1, store_name=$2, actual_send_count=$3, actual_reach_count=$4, actual_conversion_count=$5, actual_revenue=$6, actual_exposure_count=$7, actual_redemption_count=$8, actual_cost=$9, effect_rating=$10, result_note=$11, updated_at=NOW()
         WHERE id=$12 AND campaign_id=$13 AND tenant_id=$14 RETURNING *`,
        [cleanText(b.store_id || '', 80), cleanText(b.store_name || '', 120), Number(b.actual_send_count || 0), Number(b.actual_reach_count || 0), Number(b.actual_conversion_count || 0), Number(b.actual_revenue || 0), Number(b.actual_exposure_count || 0), Number(b.actual_redemption_count || 0), Number(b.actual_cost || 0), cleanText(b.effect_rating || '', 20), cleanText(b.result_note || '', 2000), req.params.resultId, req.params.id, tenantId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      const campaignRow = await pool.query(`SELECT * FROM marketing_campaigns WHERE id=$1 AND tenant_id=$2`, [req.params.id, tenantId]);
      await saveCampaignResultAsLearning(pool, tenantId, campaignRow.rows[0], r.rows[0]);
      res.json({ ok: true, result: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 自动营销发送汇总（从现有delivery_logs聚合）
  app.get(`${basePath}/auto-marketing-summary`, authRequired, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const dateFrom = cleanText(req.query.date_from || '', 20) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const dateTo = cleanText(req.query.date_to || '', 20) || new Date().toISOString().slice(0, 10);
      // 尝试从 growth_delivery_logs 聚合（表可能不存在，失败返回空）
      const r = await pool.query(
        `SELECT dl.rule_key, tr.name AS rule_name, COUNT(*) AS send_count, COUNT(DISTINCT dl.phone) AS unique_phones,
                MAX(dl.created_at)::date AS last_sent_date,
                MAX(dl.message_text) AS sample_message
           FROM growth_delivery_logs dl
           LEFT JOIN growth_touch_rules tr ON tr.rule_key = dl.rule_key AND tr.tenant_id = dl.tenant_id
          WHERE dl.tenant_id = $1 AND dl.status = 'sent'
            AND dl.created_at >= $2::date AND dl.created_at < ($3::date + INTERVAL '1 day')
          GROUP BY dl.rule_key, tr.name
          ORDER BY send_count DESC LIMIT 50`,
        [tenantId, dateFrom, dateTo]
      ).catch(() => ({ rows: [] }));
      res.json({ ok: true, date_from: dateFrom, date_to: dateTo, rules: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });
}

