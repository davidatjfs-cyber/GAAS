/**
 * Business report — /api/reports/business
 */
import {
  pool,
  requireReportPerm,
} from './helpers.js';

export function registerReportsBusinessRoutes(app, deps) {
  const {
    authRequired,
    getSharedState,
    safeDateOnly,
    pickMyStoreFromState,
    inDateRange,
    clampNum,
  } = deps;

  app.get('/api/reports/business', authRequired, async (req, res) => {
    const username = String(req.user?.username || '').trim();
    const role = String(req.user?.role || '').trim();
    if (!username) return res.status(400).json({ error: 'missing_user' });
    const storeQBiz = String(req.query?.store || '').trim();
    if (!(await requireReportPerm(req, res, 'reports.business.view', storeQBiz))) return;

    const start = safeDateOnly(req.query?.start);
    const end = safeDateOnly(req.query?.end);
    if (!start || !end) return res.status(400).json({ error: 'missing_range' });
    const storeQ = String(req.query?.store || '').trim();

    try {
      const state0 = (await getSharedState()) || {};
      const myStore = pickMyStoreFromState(state0, username);
      const _allowedStores10245 = Array.isArray(req.user?.allowed_stores) ? req.user.allowed_stores : [];
      const _currentStore10245 = String(req.user?.current_store || '').trim();
      const store = role === 'store_manager'
        ? (storeQ && _allowedStores10245.includes(storeQ) ? storeQ : (_currentStore10245 || myStore))
        : storeQ;
      let items = Array.isArray(state0.dailyReports) ? state0.dailyReports.slice() : [];
      items = items.filter(r => inDateRange(String(r?.date || '').trim(), start, end));
      if (store) items = items.filter(r => String(r?.store || '').trim() === store);

      const emptyAgg = (st) => ({
        store: st, days: 0, budget: 0, gross: 0, actual: 0,
        discount: 0, discountDine: 0, discountDelivery: 0,
        rechargeCount: 0, rechargeAmount: 0,
        newWechatMembers: 0,
        dineRevenue: 0, dineOrders: 0, dineTraffic: 0,
        segNoon: 0, segAfternoon: 0, segNight: 0,
        catWaterAmt: 0, catWaterQty: 0, catSoupAmt: 0, catSoupQty: 0,
        catRoastAmt: 0, catRoastQty: 0, catWokAmt: 0, catWokQty: 0,
        elemeOrders: 0, elemeRevenue: 0, elemeActual: 0, elemeTarget: 0,
        meituanOrders: 0, meituanRevenue: 0, meituanActual: 0, meituanTarget: 0,
        badDianping: 0, badMeituan: 0, badEleme: 0,
        laborTotal: 0,
        dianpingRatingSum: 0,
        dianpingRatingCount: 0
      });

      const byStore = new Map();
      items.forEach(r => {
        const st = String(r?.store || '').trim();
        if (!st) return;
        const data = r?.data && typeof r.data === 'object' ? r.data : {};
        const prev = byStore.get(st) || emptyAgg(st);
        prev.days += 1;
        prev.budget += clampNum(data?.budget, 0);
        prev.gross += clampNum(data?.gross, 0);
        prev.actual += clampNum(data?.actual, 0);
        prev.discount += clampNum(data?.discount?.total, 0);
        prev.discountDine += clampNum(data?.discount?.dine, 0);
        prev.discountDelivery += clampNum(data?.discount?.delivery, 0);
        prev.rechargeCount += clampNum(data?.recharge?.count, 0);
        prev.rechargeAmount += clampNum(data?.recharge?.amount, 0);
        prev.newWechatMembers += clampNum(data?.new_wechat_members, 0);
        prev.dineRevenue += clampNum(data?.dine?.revenue, 0);
        prev.dineOrders += clampNum(data?.dine?.orders, 0);
        prev.dineTraffic += clampNum(data?.dine?.traffic, 0);
        prev.segNoon += clampNum(data?.segments?.noon, 0);
        prev.segAfternoon += clampNum(data?.segments?.afternoon, 0);
        prev.segNight += clampNum(data?.segments?.night, 0);
        prev.catWaterAmt += clampNum(data?.categories?.water?.amt, 0);
        prev.catWaterQty += clampNum(data?.categories?.water?.qty, 0);
        prev.catSoupAmt += clampNum(data?.categories?.soup?.amt, 0);
        prev.catSoupQty += clampNum(data?.categories?.soup?.qty, 0);
        prev.catRoastAmt += clampNum(data?.categories?.roast?.amt, 0);
        prev.catRoastQty += clampNum(data?.categories?.roast?.qty, 0);
        prev.catWokAmt += clampNum(data?.categories?.wok?.amt, 0);
        prev.catWokQty += clampNum(data?.categories?.wok?.qty, 0);
        prev.elemeOrders += clampNum(data?.delivery?.eleme?.orders, 0);
        prev.elemeRevenue += clampNum(data?.delivery?.eleme?.revenue, 0);
        prev.elemeActual += clampNum(data?.delivery?.eleme?.actual, 0);
        prev.elemeTarget += clampNum(data?.delivery?.eleme?.targetRevenue, 0);
        prev.meituanOrders += clampNum(data?.delivery?.meituan?.orders, 0);
        prev.meituanRevenue += clampNum(data?.delivery?.meituan?.revenue, 0);
        prev.meituanActual += clampNum(data?.delivery?.meituan?.actual, 0);
        prev.meituanTarget += clampNum(data?.delivery?.meituan?.targetRevenue, 0);
        prev.badDianping += clampNum(data?.badReviews?.dianping, 0);
        prev.badMeituan += clampNum(data?.badReviews?.meituan, 0);
        prev.badEleme += clampNum(data?.badReviews?.eleme, 0);
        prev.laborTotal += clampNum(data?.laborTotal, 0);
        const drStar = data?.dianping_rating;
        const drN = drStar != null && drStar !== '' ? Number(drStar) : NaN;
        if (Number.isFinite(drN)) {
          prev.dianpingRatingSum += drN;
          prev.dianpingRatingCount += 1;
        }
        byStore.set(st, prev);
      });

      const rows = Array.from(byStore.values()).sort((a, b) => String(a.store).localeCompare(String(b.store), 'zh-Hans-CN'));
      const computeDerived = (x) => {
        x.budgetRate = x.budget > 0 ? (x.gross / x.budget) : 0;
        x.efficiency = x.laborTotal > 0 ? (x.gross / x.laborTotal) : 0;
        x.dineAvgTable = x.dineOrders > 0 ? (x.dineRevenue / x.dineOrders) : 0;
        x.dineAvgPerson = x.dineTraffic > 0 ? (x.dineRevenue / x.dineTraffic) : 0;
        x.discountRate = x.gross > 0 ? (x.discount / x.gross) : 0;
        x.avgDianpingRating =
          x.dianpingRatingCount > 0 ? (x.dianpingRatingSum / x.dianpingRatingCount) : null;
      };
      rows.forEach(computeDerived);

      const sumKeys = ['days','budget','gross','actual','discount','discountDine','discountDelivery','rechargeCount','rechargeAmount','newWechatMembers','dineRevenue','dineOrders','dineTraffic','segNoon','segAfternoon','segNight','catWaterAmt','catWaterQty','catSoupAmt','catSoupQty','catRoastAmt','catRoastQty','catWokAmt','catWokQty','elemeOrders','elemeRevenue','elemeActual','elemeTarget','meituanOrders','meituanRevenue','meituanActual','meituanTarget','badDianping','badMeituan','badEleme','laborTotal','dianpingRatingSum','dianpingRatingCount'];
      const total = emptyAgg('合计');
      rows.forEach(x => { sumKeys.forEach(k => { total[k] += (x[k] || 0); }); });
      computeDerived(total);

      // monthly targets from state
      let monthlyTargets = null;
      try {
        const stSettings = state0.settings && typeof state0.settings === 'object' ? state0.settings : {};
        const mt = Array.isArray(stSettings.monthlyTargets) ? stSettings.monthlyTargets : (Array.isArray(state0.monthlyTargets) ? state0.monthlyTargets : []);
        const ym = start.slice(0, 7);
        const tgt = mt.find(t => {
          const tMonth = String(t?.ym || t?.month || '').trim();
          const tStore = String(t?.store || '').trim();
          return tMonth === ym && (!store || tStore === store);
        });
        if (tgt) monthlyTargets = tgt.targets || null;
      } catch (e) { /* ignore */ }

      // budget info from state
      let budgetInfo = null;
      try {
        const budgets = Array.isArray(state0.paymentBudgets) ? state0.paymentBudgets : [];
        const ym = start.slice(0, 7);
        const b = budgets.find(x => String(x?.month || '').trim() === ym && (!store || String(x?.store || '').trim() === store));
        if (b) budgetInfo = b;
      } catch (e) { /* ignore */ }

      // budget execution: all categories for this store/month with actual usage
      let budgetExecution = [];
      try {
        const budgets = Array.isArray(state0.paymentBudgets) ? state0.paymentBudgets : [];
        const ym = start.slice(0, 7);
        const matched = budgets.filter(x => String(x?.month || '').trim() === ym && (!store || String(x?.store || '').trim() === store));
        if (matched.length > 0) {
          // query actual usage from approval_requests for approved+paid payments
          const usageParams = store ? [store, ym] : [ym];
          const storeClause = store ? "(payload->>'store') = $1 AND" : '';
          const monthParam = store ? '$2' : '$1';
          usageParams.push(req.tenantId || req.user?.tenant_id || 'default');
          const tenantParam = `$${usageParams.length}`;
          const usageResult = await pool.query(
            `SELECT (payload->>'category') as category,
                    COALESCE(SUM(NULLIF(payload->>'amount','')::numeric), 0)::float as used
             FROM approval_requests
             WHERE type = 'payment'
               AND status IN ('approved','paid')
               AND ${storeClause}
               substring(payload->>'date', 1, 7) = ${monthParam}
               AND tenant_id = ${tenantParam}
             GROUP BY (payload->>'category')`,
            usageParams
          );
          const usageMap = {};
          for (const row of (usageResult.rows || [])) {
            usageMap[String(row.category || '').trim()] = Number(row.used || 0);
          }
          budgetExecution = matched.map(b => {
            const cat = String(b.category || '').trim();
            const budgetAmt = Number(b.amount || 0);
            const used = Number(usageMap[cat] || 0);
            const remaining = budgetAmt - used;
            const rate = budgetAmt > 0 ? (used / budgetAmt) : 0;
            return { category: cat, budget: budgetAmt, used, remaining, rate };
          });
        }
      } catch (e) { /* ignore */ }

      return res.json({ start, end, store: store || '', rows, total, monthlyTargets, budgetInfo, budgetExecution });
    } catch (e) {
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

}
