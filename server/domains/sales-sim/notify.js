import {
  formatSkillsGradeLine, trackLabel, principleLabel, localizeSourceLabel,
  skillLabel, scoreGrade,
} from './labels.js';

export function buildReportMessage({ debrief, rank, personaTitle }) {
  const d = debrief || {};
  const improvements = (d.improvements || []).slice(0, 3).map((x, i) => {
    const name = principleLabel(x.principle_id);
    return `${i + 1}. 【${name}】${x.detail}`;
  }).join('\n') || '暂无';
  const reps = (d.replacements || []).slice(0, 2).map((r) => (
    `原话：${r.original}\n建议（${localizeSourceLabel(r.source_label)}）：${r.suggested}`
  )).join('\n\n') || '暂无';
  const rankLine = rank?.rank_label
    ? `职级：${rank.rank_label}${rank.promoted ? '（本场升级）' : ''}${rank.demoted ? '（本场降级）' : ''}`
    : '';
  const grade = d.score_grade || scoreGrade(d.score);

  return [
    `【模拟训练报告】${personaTitle || trackLabel(d.track) || ''}`,
    `本场评定：${grade || '—'}`,
    rankLine,
    `能力：${d.skills_line || formatSkillsGradeLine(d.skills || {})}`,
    '',
    '需要提升：',
    improvements,
    '',
    '参考话术：',
    reps,
    '',
    '详情请打开「模拟训练」查看完整复盘。',
  ].filter(Boolean).join('\n');
}

export async function notifyTraineeReport(pool, {
  username, sessionId, track, debrief, rank, personaTitle,
}) {
  const title = `模拟训练报告 · ${debrief?.score ?? '—'}分 · ${trackLabel(track)}`;
  const message = buildReportMessage({ debrief, rank, personaTitle });
  const r = await pool.query(
    `INSERT INTO sales_sim_notifications (username, title, message, session_id, track, meta)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id, created_at`,
    [
      username, title, message, sessionId, track,
      JSON.stringify({
        score: debrief?.score,
        rank_key: rank?.rank_key,
        skills: debrief?.skills || {},
        focus: debrief?.next_focus ? (principleLabel(debrief.next_focus) || skillLabel(debrief.next_focus)) : null,
      }),
    ]
  );

  // 租户店员：同步写入门店通知中心（若表可用）
  try {
    await pool.query(
      `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
       VALUES ($1,$2,$3,'sales_sim_report',$4::jsonb, COALESCE(
         (SELECT tenant_id FROM sales_sim_sessions WHERE id=$5), 'default'
       ))`,
      [username, title, message.slice(0, 1800), JSON.stringify({ session_id: sessionId, track }), sessionId]
    );
  } catch (_) {
    /* platform-only users may not need / table may reject — ignore */
  }

  return { ok: true, notification_id: r.rows?.[0]?.id };
}

export async function listNotifications(pool, username, { unreadOnly = false, limit = 30 } = {}) {
  const r = await pool.query(
    `SELECT id, title, message, session_id, track, meta, read_at, created_at
       FROM sales_sim_notifications
      WHERE username=$1
        AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
      ORDER BY created_at DESC
      LIMIT $3`,
    [username, unreadOnly, limit]
  );
  return r.rows || [];
}

export async function markNotificationRead(pool, username, id) {
  await pool.query(
    `UPDATE sales_sim_notifications SET read_at=NOW()
      WHERE id=$1 AND username=$2 AND read_at IS NULL`,
    [id, username]
  );
  return { ok: true };
}

export async function unreadCount(pool, username) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sales_sim_notifications WHERE username=$1 AND read_at IS NULL`,
    [username]
  );
  return Number(r.rows?.[0]?.n || 0);
}
