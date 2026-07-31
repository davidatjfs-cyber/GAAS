import { randomUUID } from 'crypto';
import { ensurePlaybookSeed } from './playbooks.js';

export async function nominatePlaybook(pool, {
  track, targetSceneKey, title, exemplarText, principleIds = [],
  originalTraineeText = '', sessionId = null, username,
}) {
  const sceneKey = `nom_${randomUUID().slice(0, 8)}`;
  const r = await pool.query(
    `INSERT INTO sales_sim_playbooks
       (track, scene_key, title, trigger_patterns, principle_ids, exemplar_text, source_label,
        status, active, nominated_by, nominated_session_id, original_trainee_text, target_scene_key)
     VALUES ($1,$2,$3,'{}',$4,$5,$6,'pending',FALSE,$7,$8,$9,$10)
     RETURNING *`,
    [
      track,
      sceneKey,
      title || `提名·${targetSceneKey || sceneKey}`,
      principleIds,
      exemplarText,
      `候选·${username}`,
      username,
      sessionId,
      originalTraineeText || null,
      targetSceneKey || null,
    ]
  );
  return { ok: true, playbook: r.rows[0] };
}

export async function listPendingPlaybooks(pool, track = null) {
  const r = await pool.query(
    `SELECT * FROM sales_sim_playbooks
      WHERE status='pending'
        AND ($1::text IS NULL OR track=$1)
      ORDER BY created_at DESC LIMIT 100`,
    [track]
  );
  return r.rows || [];
}

export async function reviewPlaybook(pool, {
  id, approve, reviewerUsername, sourceLabel,
}) {
  const cur = await pool.query(`SELECT * FROM sales_sim_playbooks WHERE id=$1`, [id]);
  const row = cur.rows?.[0];
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'pending') return { ok: false, error: 'not_pending' };

  if (!approve) {
    await pool.query(
      `UPDATE sales_sim_playbooks
          SET status='rejected', reviewed_by=$2, reviewed_at=NOW(), active=FALSE
        WHERE id=$1`,
      [id, reviewerUsername]
    );
    return { ok: true, status: 'rejected' };
  }

  const target = row.target_scene_key || row.scene_key.replace(/^nom_/, 'custom_');
  await ensurePlaybookSeed(pool);

  // 晋升：写入/更新正式 scene
  await pool.query(
    `INSERT INTO sales_sim_playbooks
       (track, scene_key, title, trigger_patterns, principle_ids, exemplar_text, source_label, status, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',TRUE)
     ON CONFLICT (track, scene_key) DO UPDATE SET
       title=EXCLUDED.title,
       principle_ids=EXCLUDED.principle_ids,
       exemplar_text=EXCLUDED.exemplar_text,
       source_label=EXCLUDED.source_label,
       status='approved',
       active=TRUE`,
    [
      row.track,
      target,
      row.title,
      row.trigger_patterns || [],
      row.principle_ids || [],
      row.exemplar_text,
      sourceLabel || `销冠/金牌·已晋升·${reviewerUsername}`,
    ]
  );

  await pool.query(
    `UPDATE sales_sim_playbooks
        SET status='approved', reviewed_by=$2, reviewed_at=NOW(), active=FALSE,
            source_label=COALESCE($3, source_label)
      WHERE id=$1`,
    [id, reviewerUsername, sourceLabel || null]
  );

  // 导师贡献计数
  if (row.nominated_by) {
    await pool.query(
      `UPDATE sales_sim_ranks
          SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
            'playbooks_accepted', COALESCE((meta->>'playbooks_accepted')::int,0) + 1
          )
        WHERE username=$1 AND track=$2`,
      [row.nominated_by, row.track]
    );
  }

  return { ok: true, status: 'approved', scene_key: target };
}

export async function autoNominateFromDebrief(pool, {
  track, sessionId, username, debrief,
}) {
  const reps = (debrief?.replacements || []).slice(0, 1);
  if (!reps.length) return null;
  // 高分场次才自动产候选（语料飞轮）
  if (Number(debrief.score || 0) < 85) return null;
  const r = reps[0];
  // 若学员原话本身就很好（与建议不同且含问号），提名为候选
  const original = String(r.original || '');
  if (original.length < 12 || !/[？?]/.test(original)) return null;
  return nominatePlaybook(pool, {
    track,
    targetSceneKey: r.principle_id || 'custom_win',
    title: `高分场次自动提名·${r.principle_id || ''}`,
    exemplarText: original,
    principleIds: r.principle_id ? [r.principle_id] : [],
    originalTraineeText: original,
    sessionId,
    username,
  });
}
