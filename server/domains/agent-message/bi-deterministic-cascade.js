/**
 * data_auditor 路径上的 BI 确定性级联编排（builder 本体仍在 agents.js，经 deps 注入）。
 */

import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-message', handler: 'bi-deterministic-cascade' });

const INVENTORY_SALES_DETAIL_RE =
  /(堂食|外卖|销售明细|时段.*销|销.*时段|午市|晚市|菜品.*销量|销量.*排|热销|畅销|备货|点单)/;

/**
 * @param {{
 *   text: string,
 *   resolvedStore: string,
 *   route: string,
 *   store: string,
 *   brand: string,
 *   brandId: string,
 *   brandConfig: unknown,
 * }} ctx
 * @param {{
 *   buildCoverage: (text: string) => Promise<string|null|undefined>,
 *   buildDailyReport: (store: string, text: string) => Promise<string|null|undefined>,
 *   buildTableVisit: (store: string, text: string) => Promise<string|null|undefined>,
 *   buildSalesRawTop: (store: string, text: string) => Promise<string|null|undefined>,
 *   buildBadReview: (store: string, text: string) => Promise<string|null|undefined>,
 *   buildClosing: (store: string, text: string) => Promise<string|null|undefined>,
 *   buildOpening: (store: string, text: string) => Promise<string|null|undefined>,
 *   buildMaterial: (store: string, text: string) => Promise<string|null|undefined>,
 *   buildMeeting: (store: string, text: string) => Promise<string|null|undefined>,
 *   buildOpsCount: (store: string, text: string) => Promise<string|null|undefined>,
 *   buildLoss: (store: string, text: string) => Promise<string|null|undefined>,
 *   getSharedState: () => Promise<any>,
 *   normalizeStoreKey: (v: any) => string,
 *   resolveDateRangeFromQuestion: (text: string, dd?: number) => { start: string, end: string, label: string },
 *   buildSalesReport: (rows: any[], store: string, period: any) => string|null|undefined,
 * }} deps
 * @returns {Promise<{ handled: true, response: string, agentData: object } | { handled: false }>}
 */
export async function tryBiDeterministicCascade(ctx, deps) {
  const text = String(ctx.text || '');
  const resolvedStore = ctx.resolvedStore;
  const baseAgent = {
    route: ctx.route,
    store: ctx.store,
    brand: ctx.brand,
    brandId: ctx.brandId,
    brandConfig: ctx.brandConfig,
    grounded: true,
    deterministic: true,
  };

  const hit = (response, source) => ({
    handled: true,
    response,
    agentData: { ...baseAgent, source },
  });

  const coverage = await deps.buildCoverage(text);
  if (coverage) return hit(coverage, 'bi_data_source_coverage');

  const daily = await deps.buildDailyReport(resolvedStore, text);
  if (daily) return hit(daily, 'daily_reports');

  const tableVisit = await deps.buildTableVisit(resolvedStore, text);
  if (tableVisit) return hit(tableVisit, 'table_visit');

  const salesRawTop = await deps.buildSalesRawTop(resolvedStore, text);
  if (salesRawTop) return hit(salesRawTop, 'pos_sales_detail');

  // 预测备货销售明细（堂食/外卖×时段销量占比）
  if (INVENTORY_SALES_DETAIL_RE.test(text)) {
    try {
      const st = await deps.getSharedState();
      const allH = Array.isArray(st?.inventoryForecastHistory) ? st.inventoryForecastHistory : [];
      const storeH = allH.filter(
        (x) => deps.normalizeStoreKey(x?.store) === deps.normalizeStoreKey(resolvedStore)
      );
      if (storeH.length) {
        const p = deps.resolveDateRangeFromQuestion(text, 7);
        const filt = storeH.filter((x) => {
          const d = String(x?.date || '');
          return d >= p.start && d <= p.end;
        });
        if (filt.length) {
          const rpt = deps.buildSalesReport(filt, ctx.store, p);
          if (rpt) return hit(rpt, 'inventory_forecast');
        } else {
          const dates = storeH.map((x) => x?.date).filter(Boolean).sort();
          return hit(
            `📦 ${p.label}暂无销售明细数据（${ctx.store}）。已有数据范围：${dates[0]} ~ ${dates[dates.length - 1]}`,
            'inventory_forecast'
          );
        }
      }
    } catch (e) {
      log.error({ msg: 'bi_sales_detail_error', err: e?.message });
    }
  }

  const badReview = await deps.buildBadReview(resolvedStore, text);
  if (badReview) return hit(badReview, 'bad_reviews');

  const closing = await deps.buildClosing(resolvedStore, text);
  if (closing) return hit(closing, 'closing_reports');

  const opening = await deps.buildOpening(resolvedStore, text);
  if (opening) return hit(opening, 'opening_reports');

  const material = await deps.buildMaterial(resolvedStore, text);
  if (material) return hit(material, 'material_reports');

  const meeting = await deps.buildMeeting(resolvedStore, text);
  if (meeting) return hit(meeting, 'meeting_reports');

  const opsCount = await deps.buildOpsCount(resolvedStore, text);
  if (opsCount) return hit(opsCount, 'ops_reports');

  const loss = await deps.buildLoss(resolvedStore, text);
  if (loss) return hit(loss, 'loss_reports');

  return { handled: false };
}
