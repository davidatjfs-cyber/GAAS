/**
 * Growth ops tools — weather / active-window / repurchase / content-performance.
 * Pure logic (no req/res).
 */
import {
  CHINA_HOLIDAYS,
  CITY_COORDS,
  WEATHER_CODES,
  seasonFromMonth,
  buildWeatherTips,
  assembleActiveWindow,
} from './helpers.js';

/** Module-level weather cache (same semantics as pre-peel closure). */
let weatherCache = { data: null, at: 0 };

/** Test hook — reset cache between tests. */
export function _resetWeatherCache() {
  weatherCache = { data: null, at: 0 };
}

export async function getWeatherContext(ctx, query) {
  const city = ctx.cleanText(query.city || '上海', 80);
  const now = ctx.now ? ctx.now() : new Date();
  const today = now.toISOString().slice(0, 10);
  const holiday = CHINA_HOLIDAYS[today] || null;
  const month = now.getMonth() + 1;
  const season = seasonFromMonth(month);
  const isWeekend = [0, 6].includes(now.getDay());
  const dateKey = today;
  let temperature = null;
  let condition = null;

  if (weatherCache.data && Date.now() - weatherCache.at < 300000 && weatherCache.data.dateKey === dateKey) {
    temperature = weatherCache.data.temperature;
    condition = weatherCache.data.condition;
  } else {
    try {
      const fetchFn = ctx.fetch || fetch;
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 4000);
      const latlon = CITY_COORDS[city] || '31.23,121.47';
      const [lat, lon] = latlon.split(',');
      const resp = await fetchFn(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`,
        { signal: ctrl.signal }
      );
      if (resp.ok) {
        const d = await resp.json();
        const current = d?.current;
        if (current) {
          temperature = current.temperature_2m != null ? current.temperature_2m + '°C' : null;
          condition = WEATHER_CODES[current.weather_code || 0] || '未知';
        }
      }
    } catch {
      /* fallback to seasonal */
    }
    weatherCache = { data: { dateKey, temperature, condition }, at: Date.now() };
  }

  const context = {
    date: today,
    season,
    is_weekend: isWeekend,
    holiday,
    temperature: temperature || '未知',
    condition: condition || '未知',
    city,
  };
  context.tips = buildWeatherTips({
    holiday,
    isWeekend,
    condition: context.condition,
    temperature: context.temperature,
    season,
  });
  context.ok = true;
  return { status: 200, body: context };
}

export async function getActiveWindow(ctx, tenantId, query) {
  const storeId = ctx.cleanText(query.store_id || '', 128);
  const [timePatterns, profileSegments, repurchaseRisk, valueTierSeg] =
    await ctx.tenantContext.run(tenantId, () =>
      Promise.all([
        ctx.pool.query(
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
        ctx.pool.query(
          `SELECT lifecycle_stage, COUNT(*)::int as cnt,
                MODE() WITHIN GROUP (ORDER BY best_contact_window) AS top_window,
                ROUND(AVG(price_sensitivity)::numeric, 2) AS avg_price_sens,
                ROUND(AVG(response_to_discount)::numeric, 2) AS avg_discount_resp
         FROM growth_customer_profiles
         WHERE ($1='' OR store_id=$1) GROUP BY lifecycle_stage ORDER BY cnt DESC`,
          [storeId]
        ),
        ctx.pool.query(
          `SELECT COUNT(*)::int as at_risk_count, store_id
         FROM growth_customer_profiles
         WHERE lifecycle_stage IN ('at_risk','dormant','churned')
           AND ($1='' OR store_id=$1)
         GROUP BY store_id`,
          [storeId]
        ),
        ctx.pool.query(
          `SELECT value_tier, COUNT(*)::int AS cnt,
                COUNT(*) FILTER (WHERE lifecycle_stage = 'dormant')::int AS dormant_cnt
         FROM growth_customer_profiles
         WHERE ($1='' OR store_id=$1) AND COALESCE(pos_total_spend,0) > 0
         GROUP BY value_tier`,
          [storeId]
        ),
      ])
    );

  return {
    status: 200,
    body: assembleActiveWindow({
      timePatterns: timePatterns.rows,
      profileSegments: profileSegments.rows,
      repurchaseRisk: repurchaseRisk.rows,
      valueTierSeg: valueTierSeg.rows,
    }),
  };
}

export async function triggerRepurchase(ctx, tenantId, body) {
  const storeId = ctx.cleanText(body?.store_id || '', 128);
  const created = await ctx.tenantContext.run(tenantId, async () => {
    const r = await ctx.pool.query(
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
      // 2026-08-07 核心修复：改成「客户+当天」确定性 key，同日重复触发 ON CONFLICT
      // DO NOTHING 天然去重；再补开放状态预检，避免跨天重复堆积待审池。
      const todayYmd = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
      const actionKey = `repurchase:${row.customer_id}:${todayYmd}`;
      const openSameCustomer = await ctx.pool.query(
        `SELECT 1 FROM growth_actions
          WHERE tenant_id = $1 AND status IN ('proposed','assigned','executing')
            AND payload->>'customer_id' = $2
          LIMIT 1`,
        [tenantId, String(row.customer_id || '')]
      );
      if (openSameCustomer.rows.length) continue;
      const useCoupon = Number(row.response_to_discount) > 0.4;
      await ctx.pool.query(
        `INSERT INTO growth_actions (action_key, action_type, status, store_id, title, detail, payload, created_by, tenant_id)
           VALUES ($1,'send_voucher','proposed',NULLIF($2,''),$3,$4,$5::jsonb,'agent_v2',$6)
           ON CONFLICT (action_key, tenant_id) DO NOTHING`,
        [
          actionKey,
          row.store_id,
          `复购唤醒-客户#${row.customer_id}`,
          `客户${row.phone}已${row.lifecycle_stage === 'churned' ? '流失' : '临近复购临界期'}，${useCoupon ? '建议发送优惠券' : '建议内容触达'}。最佳触达时间:${row.best_contact_window || '未设定'}`,
          JSON.stringify({
            customer_id: row.customer_id,
            phone: row.phone,
            use_coupon: useCoupon,
            channel: 'wecom',
            strategy_key: 'repurchase_auto',
          }),
          tenantId,
        ]
      );
      createdCount++;
    }
    return { createdCount, total: r.rows.length };
  });
  return {
    status: 200,
    body: { ok: true, triggered: created.createdCount, total_at_risk: created.total },
  };
}

export async function listUserClusters(ctx, tenantId, query) {
  const storeId = ctx.cleanText(query.store_id || '', 128);
  const r = await ctx.tenantContext.run(tenantId, () =>
    ctx.pool.query(
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
    )
  );
  return {
    status: 200,
    body: {
      ok: true,
      clusters: r.rows,
      total: r.rows.reduce((s, row) => s + Number(row.user_count), 0),
    },
  };
}

export async function generateSellingPoint(ctx, body) {
  try {
    const agentsInternal = String(
      process.env.AGENTS_INTERNAL_SECRET ||
        process.env.MINIPROGRAM_SYNC_SECRET ||
        process.env.JWT_SECRET ||
        ''
    ).trim();
    const fetchFn = ctx.fetch || fetch;
    const agentResp = await fetchFn(
      (process.env.AGENTS_SERVICE_URL || 'http://127.0.0.1:3101') +
        '/api/growth/generate-selling-point',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(agentsInternal
            ? { 'X-Internal-Secret': agentsInternal, Authorization: 'Bearer ' + agentsInternal }
            : {}),
          ...(ctx?.requestId ? { 'X-Request-Id': String(ctx.requestId) } : {}),
        },
        body: JSON.stringify({
          title: body?.title || '',
          offer: body?.offer || '',
          store: body?.store || '',
        }),
      }
    );
    const data = await agentResp.json();
    return {
      status: 200,
      body: { ok: true, selling_point: data?.selling_point || '限时优惠，到店即享' },
    };
  } catch {
    return { status: 200, body: { ok: true, selling_point: '限时优惠，到店即享' } };
  }
}

export async function sendDailyReport(ctx, tenantId, body) {
  const targetDate = ctx.cleanText(body?.date || '', 20) || null;
  const msg = await ctx.tenantContext.run(tenantId, () =>
    ctx.buildGrowthDailyReport(ctx.pool, targetDate)
  );
  const sendGrowthAlert = ctx.getSendGrowthAlert();
  if (sendGrowthAlert) {
    const result = await sendGrowthAlert(msg, 'growth_daily_report');
    return { status: 200, body: { ok: true, report: msg, feishu: result } };
  }
  return { status: 200, body: { ok: true, report: msg, feishu: null } };
}

export async function previewDailyReport(ctx, tenantId, query) {
  const targetDate = ctx.cleanText(query?.date || '', 20) || null;
  const msg = await ctx.tenantContext.run(tenantId, () =>
    ctx.buildGrowthDailyReport(ctx.pool, targetDate)
  );
  return { status: 200, body: { ok: true, report: msg } };
}

export async function listContentPerformance(ctx, query) {
  const storeId = ctx.cleanText(query.store_id || '', 128);
  const days = Math.min(Math.max(Number(query.days) || 30, 1), 365);
  const r = await ctx.pool.query(
    `SELECT * FROM content_performance
       WHERE ($1='' OR store_code=$1 OR store_id=$1)
         AND content_date >= CURRENT_DATE - ($2 || ' days')::interval
       ORDER BY content_date DESC, id DESC LIMIT 200`,
    [storeId, days]
  );
  return { status: 200, body: { ok: true, records: r.rows } };
}

export async function upsertContentPerformance(ctx, body) {
  const b = body || {};
  const storeCode = ctx.cleanText(b.store_id || b.store_code || '', 128);
  const channel = ctx.cleanText(b.channel || '', 64);
  const platform = ctx.cleanText(b.platform || b.content_type || '', 64);
  const contentTitle = ctx.cleanText(b.content_title || b.dish_name || '', 255);
  const contentDate = ctx.cleanText(
    b.record_date || b.content_date || ctx.fmtYmd(new Date()),
    32
  );
  const toInt = (v) => Math.max(0, Math.floor(Number(v) || 0));
  if (!channel) return { status: 400, body: { ok: false, error: 'channel required' } };
  const r = await ctx.pool.query(
    `INSERT INTO content_performance
         (content_date, channel, store_code, store_id, platform, content_type, content_title, dish_name,
          impressions, clicks, likes, saves, comments, shares, new_followers, orders, notes, created_by)
       VALUES ($1,$2,$3,$3,$4,$4,$5,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
    [
      contentDate,
      channel,
      storeCode,
      platform,
      contentTitle,
      toInt(b.impressions),
      toInt(b.clicks),
      toInt(b.likes),
      toInt(b.comments),
      toInt(b.shares),
      toInt(b.new_followers),
      toInt(b.conversions),
      ctx.cleanText(b.notes || '', 500),
      ctx.cleanText(b.operator_username || 'manual', 64),
    ]
  );
  return { status: 200, body: { ok: true, record: r.rows[0] } };
}

export async function deleteContentPerformance(ctx, idRaw) {
  const id = Number(idRaw);
  if (!id) return { status: 400, body: { ok: false, error: 'invalid id' } };
  await ctx.pool.query(`DELETE FROM content_performance WHERE id=$1`, [id]);
  return { status: 200, body: { ok: true } };
}
