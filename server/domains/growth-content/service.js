/**
 * Phase 5 内容建议 + 内容效果（从 growth-phases 外提）。
 */
import { sendLarkMessage } from '../../agents.js';
import { cleanText } from '../growth-phase-auth.js';

function todayShanghaiYmd() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

export function safeDateOnly(value) {
  const s = cleanText(value, 32);
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function ymdAddDays(ymd, delta) {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + Number(delta || 0));
  return d.toISOString().slice(0, 10);
}

function parseOccurredAt(value) {
  if (!value) return new Date();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function lookupLearnings(pool, context) {
  const channel = cleanText(context?.channel || '', 80);
  const scene = context?.scene ? cleanText(context.scene, 80) : null;
  const audienceTag = context?.audience_tag ? cleanText(context.audience_tag, 120) : null;
  const variable = cleanText(context?.variable || '', 120);
  if (!channel || !variable) return [];
  const r = await pool.query(
    `SELECT winning_value, losing_value, effect_desc, sample_size, confidence, variable, audience_tag, scene, is_verified
       FROM growth_learnings
      WHERE channel = $1
        AND (scene = $2 OR scene IS NULL OR $2 IS NULL)
        AND (audience_tag = $3 OR audience_tag IS NULL OR $3 IS NULL)
        AND variable = $4
        AND (valid_until IS NULL OR valid_until > CURRENT_DATE)
      ORDER BY is_verified DESC, sample_size DESC, confidence DESC
      LIMIT 3`,
    [channel, scene, audienceTag, variable]
  );
  return r.rows || [];
}

export async function generateDishTrendSummary(pool, storeCode) {
  const store = cleanText(storeCode, 128);
  const r = await pool.query(
    `WITH cur AS (
       SELECT dish_name, COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(amount_after_discount),0) AS revenue
       FROM pos_order_items
       WHERE store_code = $1 AND biz_date >= CURRENT_DATE - INTERVAL '7 day'
       GROUP BY dish_name
     ),
     prev AS (
       SELECT dish_name, COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(amount_after_discount),0) AS revenue
       FROM pos_order_items
       WHERE store_code = $1 AND biz_date >= CURRENT_DATE - INTERVAL '14 day' AND biz_date < CURRENT_DATE - INTERVAL '7 day'
       GROUP BY dish_name
     )
     SELECT COALESCE(cur.dish_name, prev.dish_name) AS dish_name,
            COALESCE(cur.qty,0) AS cur_qty,
            COALESCE(prev.qty,0) AS prev_qty,
            COALESCE(cur.revenue,0) AS cur_revenue,
            COALESCE(prev.revenue,0) AS prev_revenue
     FROM cur
     FULL JOIN prev ON prev.dish_name = cur.dish_name`,
    [store]
  );
  const rows = (r.rows || []).map((x) => {
    const prevQty = Number(x.prev_qty || 0);
    const curQty = Number(x.cur_qty || 0);
    const deltaPct = prevQty > 0 ? ((curQty - prevQty) / prevQty) * 100 : (curQty > 0 ? 100 : 0);
    return { ...x, deltaPct: Number(deltaPct.toFixed(2)) };
  });
  rows.sort((a, b) => Number(b.deltaPct || 0) - Number(a.deltaPct || 0));
  return {
    topGrowers: rows.filter((x) => Number(x.cur_qty || 0) > 0).slice(0, 5),
    topDecliners: rows.slice().sort((a, b) => Number(a.deltaPct || 0) - Number(b.deltaPct || 0)).filter((x) => Number(x.prev_qty || 0) > 0).slice(0, 5),
  };
}

export async function generateWeeklyContentSuggestion(pool, storeCode, weekStart, operator = 'system', tenantId = 'default') {
  const store = cleanText(storeCode, 128);
  const start = safeDateOnly(weekStart) || todayShanghaiYmd();
  const tid = String(tenantId || 'default').trim() || 'default';
  const trends = await generateDishTrendSummary(pool, store);

  const [smsLearnings, xhsLearnings, abRes] = await Promise.all([
    lookupLearnings(pool, { channel: 'sms', scene: '晚市', audience_tag: '7日未到店', variable: '文案风格' }),
    lookupLearnings(pool, { channel: 'xiaohongshu', variable: '内容策略' }),
    pool.query(
      `SELECT * FROM ab_test_tasks WHERE tenant_id = $2 AND ($1 = '' OR store_code = $1) AND winner IS NOT NULL ORDER BY created_at DESC LIMIT 10`,
      [store, tid]
    ),
  ]);

  const top = trends.topGrowers[0] || null;
  const down = trends.topDecliners[0] || null;
  const bestSmsLearning = smsLearnings[0] || null;
  const bestXhsLearning = xhsLearnings[0] || null;
  const bestAb = abRes.rows?.find((x) => x.test_type === 'sms_copy') || abRes.rows?.[0] || null;

  let smsA = top ? `荔枝木${top.dish_name}本周热卖，今晚来尝尝，限时优惠已备好` : '今晚来店，专属优惠已为您准备';
  let smsB = top ? `{姓名}，${top.dish_name}这周很受欢迎，给你留了一张优惠券，3天内有效` : '{姓名}，给你准备了一张限时优惠券，3天内有效';
  let smsCite = '';
  if (bestSmsLearning && bestSmsLearning.is_verified) {
    smsA = cleanText(bestSmsLearning.winning_value, 255) || smsA;
    smsCite = `根据已验证经验（${cleanText(bestSmsLearning.effect_desc || '', 80)}），已自动采用胜出风格`;
  } else if (bestSmsLearning) {
    smsCite = `参考经验库（待验证）：${cleanText(bestSmsLearning.effect_desc || '', 80)}`;
  }

  const items = [
    {
      rank: 1,
      theme: top ? `重点推${top.dish_name}` : '重点推本周热门菜品',
      reason: top ? `近7天销量环比增长${Number(top.deltaPct || 0).toFixed(0)}%` : '结合近7天销售趋势与已验证经验',
      channel: 'sms',
      sms_copy_a: smsA,
      sms_copy_b: smsB,
      learning_cite: smsCite || null,
      action: smsCite ? '胜出风格已自动应用为A组；B组为挑战版本，继续追踪7天核销率' : '建议测试这两条，追踪7天核销/回流率',
    },
    {
      rank: 2,
      theme: '午市单人套餐',
      reason: bestXhsLearning
        ? `根据上次测试，建议：${cleanText(bestXhsLearning.audience_tag || '目标人群', 40)}场景下「${cleanText(bestXhsLearning.winning_value || '', 30)}」效果更优（${cleanText(bestXhsLearning.effect_desc || '', 40)}）`
        : '午市需要持续拉动到店转化',
      channel: 'xiaohongshu',
      xhs_copies: [
        '工作日午市也要吃得像样，单人套餐快手不将就。',
        '一个人吃饭也能很满足，午市套餐把性价比拉满。',
        '午休一小时，来一份热腾腾现炒套餐，刚刚好。',
      ],
      dianping_cover_styles: ['高性价比风格', '烟火气风格'],
      learning_cite: bestXhsLearning ? `根据上次测试（${cleanText(bestXhsLearning.effect_desc || '', 60)}）` : null,
      action: '运营选一个版本发布，并录入曝光/点击/订单效果',
    },
    {
      rank: 3,
      theme: down ? `本周不建议重推：${down.dish_name}` : '本周不建议重推高价低转化品类',
      reason: down ? `近7天销量环比下降${Math.abs(Number(down.deltaPct || 0)).toFixed(0)}%` : '避免继续投放弱转化主题，节省预算',
      channel: 'all',
      learning_cite: null,
      action: bestAb ? `优先复用最近A/B测试胜出风格：${bestAb.winner || 'A'}组` : '优先复用最近已验证的高转化内容风格',
    },
  ];
  const summaryText = `【本周内容建议 · ${store || '全部门店'}】\n① ${items[0].theme}：${items[0].reason}\n② ${items[1].theme}：${items[1].reason}\n③ ${items[2].theme}：${items[2].reason}`;
  const saved = await pool.query(
    `INSERT INTO growth_content_suggestions (suggestion_key, week_start, store_code, summary_json, generated_by, tenant_id)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (suggestion_key, tenant_id) DO UPDATE SET summary_json = EXCLUDED.summary_json, generated_by = EXCLUDED.generated_by, updated_at = NOW()
     RETURNING *`,
    [
      `weekly_${store || 'all'}_${start}`,
      start,
      store,
      JSON.stringify({ store_code: store, week_start: start, items, summary_text: summaryText }),
      cleanText(operator, 80),
      tid,
    ]
  );
  return saved.rows[0] || null;
}

export async function pushWeeklySuggestionToFeishu(pool, suggestionRow) {
  if (!suggestionRow) return { pushed: 0 };
  if (suggestionRow.feishu_pushed_at) {
    const daysSince = (Date.now() - new Date(suggestionRow.feishu_pushed_at).getTime()) / 86400000;
    if (daysSince < 7) return { pushed: 0, skipped: true };
  }
  const summary = suggestionRow.summary_json && typeof suggestionRow.summary_json === 'object' ? suggestionRow.summary_json : {};
  const text = cleanText(summary.summary_text || '', 4000);
  if (!text) return { pushed: 0 };
  const rec = await pool.query(
    `SELECT open_id FROM feishu_users
      WHERE registered = TRUE AND open_id IS NOT NULL AND trim(open_id) <> ''
        AND role IN ('admin','hq_manager')`,
    []
  );
  let pushed = 0;
  for (const row of rec.rows || []) {
    const sent = await sendLarkMessage(String(row.open_id || '').trim(), text, { skipDedup: true }).catch((e) => {
      console.error('[growth-content-suggestion] feishu send failed:', e?.message || e);
      return { ok: false };
    });
    if (sent?.ok) pushed += 1;
  }
  if (pushed > 0) {
    await pool.query(`UPDATE growth_content_suggestions SET feishu_pushed_at = NOW() WHERE id = $1`, [
      Number(suggestionRow.id),
    ]).catch(() => {});
  }
  return { pushed };
}

export async function listContentSuggestions(pool, tenantId, { storeCode = '', weekStart = '', limit } = {}) {
  const store = cleanText(storeCode, 128);
  const week = safeDateOnly(weekStart);
  const tid = String(tenantId || 'default').trim() || 'default';
  const rowLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
  const r = await pool.query(
    `SELECT * FROM growth_content_suggestions
      WHERE tenant_id = $3
        AND ($1 = '' OR store_code = $1)
        AND ($2 = '' OR week_start = $2::date)
      ORDER BY week_start DESC, created_at DESC
      LIMIT $4`,
    [store, week, tid, rowLimit]
  );
  return r.rows || [];
}

export async function listContentPerformance(pool, { storeCode = '', channel = '' } = {}) {
  const store = cleanText(storeCode, 128);
  const ch = cleanText(channel, 80);
  const r = await pool.query(
    `SELECT * FROM content_performance
      WHERE ($1 = '' OR store_code = $1)
        AND ($2 = '' OR channel = $2)
      ORDER BY created_at DESC
      LIMIT 200`,
    [store, ch]
  );
  return r.rows || [];
}

async function maybeWriteContentLearning(pool, perf, tenantId) {
  const impressions = Number(perf.impressions || 0);
  const redemptions = Number(perf.redemptions || 0);
  const effectPct = impressions > 0 ? Number(((redemptions / impressions) * 100).toFixed(2)) : 0;
  if (!cleanText(perf.winning_value, 500)) return;
  await pool.query(
    `INSERT INTO growth_learnings (
       source_type, source_id, store_code, channel, scene, audience_tag, variable,
       winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, tenant_id
     ) VALUES ('campaign',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      String(perf.id),
      cleanText(perf.store_code, 128),
      cleanText(perf.channel, 80),
      cleanText(perf.scene, 80),
      cleanText(perf.audience_tag, 120),
      cleanText(perf.variable || '内容策略', 120),
      cleanText(perf.winning_value, 500),
      cleanText(perf.losing_value, 500),
      cleanText(`核销率${effectPct}%`, 255),
      impressions,
      impressions >= 100 ? 'high' : 'medium',
      ymdAddDays(todayShanghaiYmd(), 90),
      tenantId,
    ]
  ).catch(() => {});
}

export async function upsertContentPerformance(pool, tenantId, body = {}, recordedBy = 'system') {
  const b = body && typeof body === 'object' ? body : {};
  const contentKey = cleanText(b.content_key || `cp_${Date.now()}`, 255);
  const row = await pool.query(
    `INSERT INTO content_performance (
       content_key, suggestion_id, store_code, channel, scene, audience_tag, variable,
       content_title, content_body, winning_value, losing_value,
       impressions, clicks, orders, redemptions, revenue,
       notes, recorded_by, published_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (content_key) DO UPDATE SET
       impressions = EXCLUDED.impressions,
       clicks = EXCLUDED.clicks,
       orders = EXCLUDED.orders,
       redemptions = EXCLUDED.redemptions,
       revenue = EXCLUDED.revenue,
       notes = EXCLUDED.notes,
       recorded_by = EXCLUDED.recorded_by,
       published_at = EXCLUDED.published_at,
       updated_at = NOW()
     RETURNING *`,
    [
      contentKey,
      b.suggestion_id ? Number(b.suggestion_id) : null,
      cleanText(b.store_code, 128),
      cleanText(b.channel, 80),
      cleanText(b.scene, 80),
      cleanText(b.audience_tag, 120),
      cleanText(b.variable, 120),
      cleanText(b.content_title, 500),
      cleanText(b.content_body, 4000),
      cleanText(b.winning_value, 500),
      cleanText(b.losing_value, 500),
      Math.max(0, Math.floor(Number(b.impressions) || 0)),
      Math.max(0, Math.floor(Number(b.clicks) || 0)),
      Math.max(0, Math.floor(Number(b.orders) || 0)),
      Math.max(0, Math.floor(Number(b.redemptions) || 0)),
      Number(Number(b.revenue || 0).toFixed(2)),
      cleanText(b.notes, 2000),
      cleanText(recordedBy, 80),
      b.published_at ? parseOccurredAt(b.published_at) : new Date(),
    ]
  );
  const perf = row.rows[0];
  await maybeWriteContentLearning(pool, perf, tenantId);
  return perf;
}

export async function upsertContentPerformanceV2(pool, tenantId, body = {}, recordedBy = 'system') {
  const b = body && typeof body === 'object' ? body : {};
  const contentKey = cleanText(b.content_key || `cp_${Date.now()}`, 255);
  const row = await pool.query(
    `INSERT INTO content_performance (
       content_key, suggestion_id, content_date, store_code, store_id, channel, platform,
       content_type, variant_tag, dish_name, content_title, content_body,
       scene, audience_tag, variable, winning_value, losing_value,
       impressions, clicks, orders, redemptions, revenue,
       notes, created_by, recorded_by, published_at
     ) VALUES ($1,$2,$3,$4,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
     RETURNING *`,
    [
      contentKey,
      b.suggestion_id ? Number(b.suggestion_id) : null,
      safeDateOnly(b.content_date || b.published_at || todayShanghaiYmd()) || todayShanghaiYmd(),
      cleanText(b.store_code, 128),
      cleanText(b.channel, 80),
      cleanText(b.content_type || 'weekly_suggestion', 80),
      cleanText(b.variant_tag || 'A', 16),
      cleanText(b.dish_name || b.content_title, 255),
      cleanText(b.content_title, 500),
      cleanText(b.content_body, 4000),
      cleanText(b.scene, 80),
      cleanText(b.audience_tag, 120),
      cleanText(b.variable, 120),
      cleanText(b.winning_value, 500),
      cleanText(b.losing_value, 500),
      Math.max(0, Math.floor(Number(b.impressions) || 0)),
      Math.max(0, Math.floor(Number(b.clicks) || 0)),
      Math.max(0, Math.floor(Number(b.orders) || 0)),
      Math.max(0, Math.floor(Number(b.redemptions) || 0)),
      Number(Number(b.revenue || 0).toFixed(2)),
      cleanText(b.notes, 2000),
      cleanText(recordedBy, 80),
      cleanText(recordedBy, 80),
      b.published_at ? parseOccurredAt(b.published_at) : new Date(),
    ]
  );
  const perf = row.rows[0];
  await maybeWriteContentLearning(pool, perf, tenantId);
  return perf;
}
