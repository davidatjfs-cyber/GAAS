import { getRankStatus } from './rank.js';

export async function assertMentor(pool, username, track) {
  const rank = await getRankStatus(pool, username, track);
  const isMentorRank = String(rank.rank_key || '').includes('mentor');
  return !!(isMentorRank || rank.mentor_eligible);
}

export async function listMenteeSessions(pool, {
  track, limit = 40, menteeUsername = null,
}) {
  const r = await pool.query(
    `SELECT s.id, s.username, s.track, s.persona_key, s.difficulty, s.status,
            s.finished_at, s.duration_sec, s.outcome,
            (s.debrief->>'score')::int AS score,
            s.debrief->'skills' AS skills,
            s.meta->>'persona_title' AS persona_title
       FROM sales_sim_sessions s
      WHERE s.status='finished'
        AND ($1::text IS NULL OR s.track=$1)
        AND ($2::text IS NULL OR s.username=$2)
      ORDER BY s.finished_at DESC NULLS LAST
      LIMIT $3`,
    [track || null, menteeUsername, limit]
  );
  return r.rows || [];
}

export async function addMentorNote(pool, {
  sessionId, mentorUsername, note,
}) {
  const text = String(note || '').trim();
  if (!text) return { ok: false, error: 'empty_note' };
  const s = await pool.query(`SELECT id, track FROM sales_sim_sessions WHERE id=$1`, [sessionId]);
  if (!s.rows?.[0]) return { ok: false, error: 'not_found' };
  const okMentor = await assertMentor(pool, mentorUsername, s.rows[0].track);
  if (!okMentor) return { ok: false, error: 'not_mentor' };
  const r = await pool.query(
    `INSERT INTO sales_sim_mentor_notes (session_id, mentor_username, note)
     VALUES ($1,$2,$3) RETURNING *`,
    [sessionId, mentorUsername, text]
  );
  return { ok: true, note: r.rows[0] };
}

export async function listMentorNotes(pool, sessionId) {
  const r = await pool.query(
    `SELECT * FROM sales_sim_mentor_notes WHERE session_id=$1 ORDER BY created_at DESC`,
    [sessionId]
  );
  return r.rows || [];
}
