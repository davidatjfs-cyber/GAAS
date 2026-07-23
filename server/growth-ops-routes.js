/**
 * Contextual triggers + ops tools routes (extracted from growth-api.js — monolith split, last of 10).
 * registerGrowthOpsRoutes(app, pool) — behavior-preserving move.
 */
import { tenantContext } from './utils/database.js';
import {
  requireGrowthAuth,
  getGrowthTenantId,
  cleanText,
  fmtYmd,
  buildGrowthDailyReport,
  getSendGrowthAlert,
} from './growth-api.js';

export function registerGrowthOpsRoutes(app, pool) {
  // ── Phase 6: Weather context + China holidays ──
  const CHINA_HOLIDAYS = {
    '2026-01-01':'元旦','2026-01-28':'小年','2026-02-12':'除夕','2026-02-13':'春节','2026-02-14':'初二','2026-02-15':'初三','2026-02-16':'初四','2026-02-17':'初五',
    '2026-02-18':'初六','2026-03-01':'元宵节','2026-04-04':'清明节','2026-04-05':'清明','2026-04-06':'清明假期','2026-05-01':'劳动节','2026-05-02':'劳动节','2026-05-03':'劳动节',
    '2026-06-20':'端午节','2026-06-21':'端午','2026-06-22':'端午假期','2026-08-28':'七夕','2026-09-17':'中秋节','2026-09-18':'中秋','2026-09-19':'中秋假期',
    '2026-10-01':'国庆节','2026-10-02':'国庆','2026-10-03':'国庆','2026-10-04':'国庆','2026-10-05':'国庆','2026-10-06':'国庆','2026-10-07':'国庆',
    '2026-12-25':'圣诞节'
  };
  let weatherCache = { data: null, at: 0 };
  app.get('/api/growth/weather-context', async (req, res) => {
    const city = cleanText(req.query.city || '上海', 80);
    const today = new Date().toISOString().slice(0, 10);
    const holiday = CHINA_HOLIDAYS[today] || null;
    const month = new Date().getMonth() + 1;
    const _day = new Date().getDate();
    const season = month >= 3 && month <= 5 ? '春季' : month >= 6 && month <= 8 ? '夏季' : month >= 9 && month <= 11 ? '秋季' : '冬季';
    const isWeekend = [0, 6].includes(new Date().getDay());
    const dateKey = today;
    let temperature = null, condition = null;
    // Try cache first (5 min TTL)
    if (weatherCache.data && Date.now() - weatherCache.at < 300000 && weatherCache.data.dateKey === dateKey) {
      temperature = weatherCache.data.temperature;
      condition = weatherCache.data.condition;
    } else {
      // Try open-meteo (more reliable than wttr.in)
      try {
        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 4000);
        // Use lat/lon for Shanghai area
        const coords = { '上海': '31.23,121.47', '北京': '39.90,116.40', '广州': '23.13,113.26', '深圳': '22.54,114.06' };
        const latlon = coords[city] || '31.23,121.47';
        const [lat, lon] = latlon.split(',');
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`, { signal: ctrl.signal });
        if (resp.ok) {
          const d = await resp.json();
          const current = d?.current;
          if (current) {
            temperature = current.temperature_2m != null ? current.temperature_2m + '°C' : null;
            const codes = {0:'晴',1:'多云',2:'多云',3:'多云',45:'雾',48:'雾',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'阵雨',81:'阵雨',82:'阵雨',95:'雷阵雨'};
            condition = codes[current.weather_code || 0] || '未知';
          }
        }
      } catch (e) { /* fallback to seasonal */ }
      weatherCache = { data: { dateKey, temperature, condition }, at: Date.now() };
    }
    // Build context with guaranteed fallback values
    const context = { date: today, season, is_weekend: isWeekend, holiday, temperature: temperature || '未知', condition: condition || '未知', city };
    const tips = [];
    if (holiday) tips.push(`今天是${holiday}`);
    if (isWeekend) tips.push('周末');
    if (condition === '雨' || condition?.includes('雨')) tips.push('雨天，适合推送温暖主题');
    if (condition === '雪' || condition?.includes('雪')) tips.push('雪天，适合推送火锅/热饮');
    if (temperature && parseInt(temperature) > 30) tips.push('高温，适合推送冰饮/凉菜');
    if (temperature && parseInt(temperature) < 5) tips.push('寒冷，适合推送热汤/暖锅');
    tips.push(`${season}主题${isWeekend ? '·周末' : '·工作日'}${holiday ? '·' + holiday : ''}`);
    context.tips = tips;
    context.ok = true;
    return res.json(context);
  });

  // ── Phase 6: Active time window prediction ──
  app.get('/api/growth/active-window', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const [timePatterns, profileSegments, repurchaseRisk, valueTierSeg] = await tenantContext.run(getGrowthTenantId(req), () => Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int as event_count,
           CASE
             WHEN EXTRACT(HOUR FROM occurred_at) BETWEEN 6 AND 10 THEN '早餐(6-10点)'
             WHEN EXTRACT(HOUR FROM occurred_at) BETWEEN 10 AND 14 THEN '午市(10-14点)'
             WHEN EXTRACT(HOUR FROM occurred_at) BETWEEN 14 AND 17 THEN '下午茶(14-17点)'
             WHEN EXTRACT(HOUR FROM occurred_at) BETWEEN 17 AND 21 THEN '晚市(17-21点)'
             ELSE '夜间(21-6点)'
           END AS time_segment,
           EXTRACT(DOW FROM occurred_at)::int AS weekday,
           CASE WHEN EXTRACT(DOW FROM occurred_at) IN (0,6) THEN '周末' ELSE '工作日' END AS day_type,
           COUNT(*) FILTER (WHERE event_type IN ('payment_success','coupon_redeemed'))::int AS conversion_count
         FROM growth_events
         WHERE ($1='' OR store_id=$1) AND occurred_at >= CURRENT_DATE - 90
         GROUP BY 2, 3, 4
         ORDER BY event_count DESC
         LIMIT 10`,
        [storeId]
      ),
      pool.query(
        `SELECT lifecycle_stage, COUNT(*)::int as cnt,
                MODE() WITHIN GROUP (ORDER BY best_contact_window) AS top_window,
                ROUND(AVG(price_sensitivity)::numeric, 2) AS avg_price_sens,
                ROUND(AVG(response_to_discount)::numeric, 2) AS avg_discount_resp
         FROM growth_customer_profiles
         WHERE ($1='' OR store_id=$1) GROUP BY lifecycle_stage ORDER BY cnt DESC`,
         [storeId]
       ),
      pool.query(
        `SELECT COUNT(*)::int as at_risk_count, store_id
         FROM growth_customer_profiles
         WHERE lifecycle_stage IN ('at_risk','dormant','churned')
           AND ($1='' OR store_id=$1)
         GROUP BY store_id`,
        [storeId]
      ),
      // 价值分级分布 + VIP沉睡客（最值得优先召回）+ 客户流失率，喂给AI策略推荐
      pool.query(
        `SELECT value_tier, COUNT(*)::int AS cnt,
                COUNT(*) FILTER (WHERE lifecycle_stage = 'dormant')::int AS dormant_cnt
         FROM growth_customer_profiles
         WHERE ($1='' OR store_id=$1) AND COALESCE(pos_total_spend,0) > 0
         GROUP BY value_tier`,
        [storeId]
      )
    ]));
    const vipRow = valueTierSeg.rows.find(r => r.value_tier === 'vip') || { cnt: 0, dormant_cnt: 0 };
    const engagedTotal = valueTierSeg.rows.reduce((s, r) => s + Number(r.cnt || 0), 0);
    const lostTotal = profileSegments.rows
      .filter(r => ['dormant', 'churned'].includes(r.lifecycle_stage))
      .reduce((s, r) => s + Number(r.cnt || 0), 0);
    const churnRatePct = engagedTotal ? Math.round((lostTotal / engagedTotal) * 1000) / 10 : 0;
    const topPattern = timePatterns.rows[0];
    const prediction = topPattern ? `${topPattern.day_type} ${topPattern.time_segment}（基于${topPattern.event_count}次历史事件，其中成交${topPattern.conversion_count}次）` : '数据不足';
    return res.json({
      ok: true,
      predicted_window: prediction,
      time_patterns: timePatterns.rows.slice(0, 5),
      segments: profileSegments.rows,
      profile_segments: profileSegments.rows,
      value_tier_segments: valueTierSeg.rows,
      churn_rate: churnRatePct,
      repurchase_risk: repurchaseRisk.rows,
      recommendations: [
        prediction !== '数据不足' ? `📅 预测最佳触达: ${prediction}` : '',
        repurchaseRisk.rows.length ? `⏰ ${repurchaseRisk.rows[0].at_risk_count || 0}位客户处于临界/沉睡/流失，建议尽快触达` : '',
        Number(vipRow.dormant_cnt) > 0 ? `👑 ${vipRow.dormant_cnt}位VIP高价值客已沉睡，优先用招牌菜/专属券召回（勿用小券）` : '',
        Number(vipRow.cnt) > 0 ? `💎 当前VIP客群${vipRow.cnt}人，建议走专属感运营（新品预告/留位），避免打折掉价` : '',
        churnRatePct > 0 ? `📉 客户流失率 ${churnRatePct}%（沉睡+流失占曾消费客户比例）` : '',
        ...profileSegments.rows.filter(r => r.cnt > 0).map(r =>
          `📊 ${r.lifecycle_stage}客群(${r.cnt}人) 最佳触达:${r.top_window || '未设定'} 价格敏感度:${r.avg_price_sens||'N/A'} 折扣响应:${r.avg_discount_resp||'N/A'}`
        )
      ].filter(Boolean)
    });
  });

  // ── Phase 6: Repurchase critical period auto-trigger ──
  app.post('/api/growth/repurchase-trigger', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.body.store_id || '', 128);
    const repurchaseTenantId = getGrowthTenantId(req);
    const created = await tenantContext.run(repurchaseTenantId, async () => {
      const r = await pool.query(
        `SELECT cp.customer_id, cp.phone, cp.store_id, cp.lifecycle_stage, cp.next_visit_probability,
                cp.best_contact_window, cp.response_to_discount, cp.price_sensitivity
         FROM growth_customer_profiles cp
         WHERE ($1='' OR cp.store_id=$1) AND cp.lifecycle_stage IN ('at_risk','churned')
           AND cp.phone IS NOT NULL
         LIMIT 50`,
        [storeId]
      );
      let createdCount = 0;
      for (const row of r.rows) {
        const actionKey = `repurchase:${row.customer_id}:${Date.now()}`;
        const useCoupon = Number(row.response_to_discount) > 0.4;
        await pool.query(
          `INSERT INTO growth_actions (action_key, action_type, status, store_id, title, detail, payload, created_by, tenant_id)
           VALUES ($1,'send_voucher','proposed',NULLIF($2,''),$3,$4,$5::jsonb,'agent_v2',$6)
           ON CONFLICT (action_key, tenant_id) DO NOTHING`,
          [actionKey, row.store_id,
           `复购唤醒-客户#${row.customer_id}`,
           `客户${row.phone}已${row.lifecycle_stage === 'churned' ? '流失' : '临近复购临界期'}，${useCoupon ? '建议发送优惠券' : '建议内容触达'}。最佳触达时间:${row.best_contact_window || '未设定'}`,
           JSON.stringify({ customer_id: row.customer_id, phone: row.phone, use_coupon: useCoupon, channel: 'wecom', strategy_key: 'repurchase_auto' }),
           repurchaseTenantId
          ]
        );
        createdCount++;
      }
      return { createdCount, total: r.rows.length };
    });
    return res.json({ ok: true, triggered: created.createdCount, total_at_risk: created.total });
  });

  // ── Phase 6: User clustering (simplified, indexed) ──
  app.get('/api/growth/user-clusters', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      `SELECT lifecycle_stage,
         ROUND(AVG(price_sensitivity)::numeric, 2) AS avg_price_sens,
         ROUND(AVG(response_to_discount)::numeric, 2) AS avg_discount_resp,
         ROUND(AVG(adventurous_score)::numeric, 2) AS avg_adventurous,
         COUNT(*)::int AS user_count,
         COALESCE(MODE() WITHIN GROUP (ORDER BY preferred_visit_time), '') AS common_visit_time
       FROM growth_customer_profiles
       WHERE ($1='' OR store_id=$1)
       GROUP BY lifecycle_stage
       ORDER BY user_count DESC
       LIMIT 20`,
      [storeId]
    ));
    return res.json({ ok: true, clusters: r.rows, total: r.rows.reduce((s, r) => s + Number(r.user_count), 0) });
  });

  app.post('/api/growth/generate-selling-point', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const agentsInternal = String(process.env.AGENTS_INTERNAL_SECRET || process.env.MINIPROGRAM_SYNC_SECRET || process.env.JWT_SECRET || '').trim();
      const agentResp = await fetch((process.env.AGENTS_SERVICE_URL || 'http://127.0.0.1:3101') + '/api/growth/generate-selling-point', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(agentsInternal ? { 'X-Internal-Secret': agentsInternal, 'Authorization': 'Bearer ' + agentsInternal } : {})
        },
        body: JSON.stringify({ title: req.body?.title || '', offer: req.body?.offer || '', store: req.body?.store || '' })
      });
      const data = await agentResp.json();
      return res.json({ ok: true, selling_point: data?.selling_point || '限时优惠，到店即享' });
    } catch (e) {
      return res.json({ ok: true, selling_point: '限时优惠，到店即享' });
    }
  });

  // 手动触发日报（POST /api/growth/daily-report/send）
  app.post('/api/growth/daily-report/send', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const targetDate = cleanText(req.body?.date || '', 20) || null;
      const msg = await tenantContext.run(getGrowthTenantId(req), () => buildGrowthDailyReport(pool, targetDate));
      const sendGrowthAlert = getSendGrowthAlert();
      if (sendGrowthAlert) {
        const result = await sendGrowthAlert(msg, 'growth_daily_report');
        return res.json({ ok: true, report: msg, feishu: result });
      }
      return res.json({ ok: true, report: msg, feishu: null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 预览日报不发送（GET /api/growth/daily-report/preview）
  app.get('/api/growth/daily-report/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const targetDate = cleanText(req.query?.date || '', 20) || null;
      const msg = await tenantContext.run(getGrowthTenantId(req), () => buildGrowthDailyReport(pool, targetDate));
      return res.json({ ok: true, report: msg });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // content_performance CRUD
  app.get('/api/growth/content-performance', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const storeId = cleanText(req.query.store_id || '', 128);
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const r = await pool.query(
      `SELECT * FROM content_performance
       WHERE ($1='' OR store_code=$1 OR store_id=$1)
         AND content_date >= CURRENT_DATE - ($2 || ' days')::interval
       ORDER BY content_date DESC, id DESC LIMIT 200`,
      [storeId, days]
    );
    return res.json({ ok: true, records: r.rows });
  });

  app.post('/api/growth/content-performance', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const storeCode = cleanText(b.store_id || b.store_code || '', 128);
    const channel = cleanText(b.channel || '', 64);
    const platform = cleanText(b.platform || b.content_type || '', 64);
    const contentTitle = cleanText(b.content_title || b.dish_name || '', 255);
    const contentDate = cleanText(b.record_date || b.content_date || fmtYmd(new Date()), 32);
    const toInt = (v) => Math.max(0, Math.floor(Number(v) || 0));
    if (!channel) return res.status(400).json({ ok: false, error: 'channel required' });
    const r = await pool.query(
      `INSERT INTO content_performance
         (content_date, channel, store_code, store_id, platform, content_type, content_title, dish_name,
          impressions, clicks, likes, saves, comments, shares, new_followers, orders, notes, created_by)
       VALUES ($1,$2,$3,$3,$4,$4,$5,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [contentDate, channel, storeCode, platform, contentTitle,
       toInt(b.impressions), toInt(b.clicks), toInt(b.likes),
       toInt(b.comments), toInt(b.shares), toInt(b.new_followers), toInt(b.conversions),
       cleanText(b.notes || '', 500), cleanText(b.operator_username || 'manual', 64)]
    );
    return res.json({ ok: true, record: r.rows[0] });
  });

  app.delete('/api/growth/content-performance/:id', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ ok: false, error: 'invalid id' });
    await pool.query(`DELETE FROM content_performance WHERE id=$1`, [id]);
    return res.json({ ok: true });
  });
}
