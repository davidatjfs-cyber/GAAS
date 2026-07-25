/**
 * 语音回复效果统计：按 TTS 变体(baseline / natural_v1 / natural_v1_tag / …)看客户后续行为。
 *
 * 为什么用"客户是否继续对话/是否继续用语音回"当真人感的代理指标：企微语音是 AMR-NB 8kHz 窄带，
 * 音质类指标(采样率、码率)全被编码器抹平，没有可测的差异；能观察到的只有客户听完之后的反应。
 * 客户听完继续聊 = 没被"机器味"劝退；继续用语音回 = 愿意把它当人对话，这是目前成本最低的信号。
 *
 * 数据全部来自 sales_messages.meta（TTS 变体由 sales-kf.js recordKfDelivery 写入），不需要新表。
 */

const VOICE_ROWS_SQL = `
  SELECT
    v.meta->>'tts_variant' AS variant,
    v.meta->>'tts_tone' AS tone,
    COALESCE((v.meta->>'tts_tagged')::boolean, false) AS tagged,
    n.input_mode AS next_input_mode,
    EXTRACT(EPOCH FROM (n.created_at - v.created_at)) AS reply_seconds
  FROM sales_messages v
  LEFT JOIN LATERAL (
    SELECT m.meta->>'input_mode' AS input_mode, m.created_at
    FROM sales_messages m
    WHERE m.conversation_id = v.conversation_id AND m.direction = 'inbound' AND m.id > v.id
    ORDER BY m.id LIMIT 1
  ) n ON TRUE
  WHERE v.direction = 'outbound'
    AND v.meta->>'delivery_channel' = 'voice'
    AND v.meta->>'delivery_status' = 'sent'
    AND v.created_at >= NOW() - make_interval(days => $1::int)
`;

function ratio(part, total) {
  return total > 0 ? Number((part / total).toFixed(3)) : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Number(value.toFixed(1));
}

function emptyBucket(key) {
  return { key, sent: 0, replied: 0, replied_voice: 0, _latencies: [] };
}

function finalizeBucket(bucket) {
  const { _latencies, ...rest } = bucket;
  return {
    ...rest,
    reply_rate: ratio(bucket.replied, bucket.sent),
    voice_reply_rate: ratio(bucket.replied_voice, bucket.sent),
    median_reply_seconds: median(_latencies),
  };
}

/**
 * 纯函数聚合，便于单测：把每条语音投递 + 它之后的第一条客户消息，折算成按变体/语气的对照表。
 * replyWindowHours 之外的回复不算"被这条语音带动的"，否则几周后的回访会污染口径。
 */
export function summarizeVoiceRows(rows = [], { replyWindowHours = 24 } = {}) {
  const windowSeconds = replyWindowHours * 3600;
  const byVariant = new Map();
  const byTone = new Map();
  const overall = emptyBucket('all');

  for (const row of rows) {
    const variantKey = row.variant || 'unknown';
    const toneKey = row.tone || 'unknown';
    if (!byVariant.has(variantKey)) byVariant.set(variantKey, emptyBucket(variantKey));
    if (!byTone.has(toneKey)) byTone.set(toneKey, emptyBucket(toneKey));
    const buckets = [byVariant.get(variantKey), byTone.get(toneKey), overall];

    // LEFT JOIN 没有后续消息时 reply_seconds 是 NULL；Number(null) 会变成 0 被误算成"秒回"。
    const raw = row.reply_seconds;
    const seconds = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    const replied = Number.isFinite(seconds) && seconds >= 0 && seconds <= windowSeconds;
    const repliedByVoice = replied && row.next_input_mode === 'voice';
    for (const bucket of buckets) {
      bucket.sent += 1;
      if (replied) { bucket.replied += 1; bucket._latencies.push(seconds); }
      if (repliedByVoice) bucket.replied_voice += 1;
    }
  }

  return {
    overall: finalizeBucket(overall),
    by_variant: [...byVariant.values()].map(finalizeBucket).sort((a, b) => b.sent - a.sent),
    by_tone: [...byTone.values()].map(finalizeBucket).sort((a, b) => b.sent - a.sent),
  };
}

export async function buildVoiceQualityReport(pool, { days = 30, replyWindowHours = 24 } = {}) {
  const safeDays = Math.min(365, Math.max(1, Number(days) || 30));
  const { rows } = await pool.query(VOICE_ROWS_SQL, [safeDays]);
  return { ok: true, days: safeDays, reply_window_hours: replyWindowHours, ...summarizeVoiceRows(rows, { replyWindowHours }) };
}
