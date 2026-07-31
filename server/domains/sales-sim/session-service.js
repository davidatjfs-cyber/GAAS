import { getPersona, listPersonas, ensurePersonaSeed } from './personas.js';
import { ensurePlaybookSeed, listPlaybooks } from './playbooks.js';
import { evaluateTraineeUtterance, detectCustomerTriggers } from './principles.js';
import {
  applyStateDelta, buildCustomerReply, maybePolishCustomerReply, shouldEndSession,
} from './customer-reply.js';
import { buildDebrief } from './debrief.js';
import { applySessionToRank, getRankStatus } from './rank.js';
import { recommendNextSession } from './curriculum.js';
import { autoNominateFromDebrief } from './playbook-lifecycle.js';
import { notifyTraineeReport } from './notify.js';
import { difficultyLabel } from './labels.js';

let _callLLM = null;
export function setSalesSimLlm(fn) {
  _callLLM = typeof fn === 'function' ? fn : null;
}

export async function ensureSalesSimSeed(pool) {
  await ensurePersonaSeed(pool);
  await ensurePlaybookSeed(pool);
}

export async function listSimPersonas(pool, track, opts = {}) {
  const rows = await listPersonas(pool, track, opts);
  return rows.map((p) => ({
    ...p,
    difficulty_label: difficultyLabel(p.difficulty),
  }));
}

export async function listSessionHistory(pool, username, { track = null, limit = 20 } = {}) {
  const r = await pool.query(
    `SELECT id, track, persona_key, difficulty, status, outcome, duration_sec,
            started_at, finished_at, (debrief->>'score')::int AS score,
            debrief->'skills' AS skills, meta
       FROM sales_sim_sessions
      WHERE username=$1 AND ($2::text IS NULL OR track=$2)
      ORDER BY started_at DESC LIMIT $3`,
    [username, track, limit]
  );
  return r.rows || [];
}

export async function listSimPlaybooks(pool, track) {
  return listPlaybooks(pool, track);
}

export async function getSimRank(pool, username, track) {
  await ensureSalesSimSeed(pool);
  return getRankStatus(pool, username, track);
}

export async function startSession(pool, {
  username, track, personaKey, difficulty,
  audience = 'internal', tenantId = null,
}) {
  if (!['sales', 'cs'].includes(track)) return { ok: false, error: 'invalid_track' };
  const persona = await getPersona(pool, personaKey);
  if (!persona || persona.track !== track) return { ok: false, error: 'persona_not_found' };
  if (audience === 'tenant' && persona.audience === 'internal') {
    return { ok: false, error: 'persona_not_allowed' };
  }
  const diff = Number(difficulty) || persona.difficulty || 1;

  const r = await pool.query(
    `INSERT INTO sales_sim_sessions
       (username, track, persona_key, difficulty, emotion, trust, close_readiness, satisfaction, meta, audience, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING *`,
    [
      username, track, persona.persona_key, diff,
      track === 'cs' ? 35 : 45,
      track === 'cs' ? 35 : 40,
      track === 'sales' ? 15 : 0,
      track === 'cs' ? 55 : 0,
      JSON.stringify({ persona_title: persona.title, source_type: persona.source_type }),
      audience || persona.audience || 'internal',
      tenantId || persona.tenant_id || null,
    ]
  );
  const session = r.rows[0];
  await pool.query(
    `INSERT INTO sales_sim_turns (session_id, turn_no, role, content)
     VALUES ($1,0,'customer',$2)`,
    [session.id, persona.opening_line]
  );

  return {
    ok: true,
    session: publicSession(session),
    opening: { role: 'customer', content: persona.opening_line, turn_no: 0 },
    persona: {
      persona_key: persona.persona_key,
      title: persona.title,
      difficulty: persona.difficulty,
      profile: persona.profile,
    },
  };
}

export async function submitTurn(pool, {
  sessionId, username, text, voice = false,
}) {
  const session = await loadOwnedSession(pool, sessionId, username);
  if (!session) return { ok: false, error: 'not_found' };
  if (session.status !== 'active') return { ok: false, error: 'session_not_active' };

  const traineeText = String(text || '').trim();
  if (!traineeText) return { ok: false, error: 'empty_text' };

  const turns = await loadTurns(pool, sessionId);
  const lastCustomer = [...turns].reverse().find((t) => t.role === 'customer');
  const priorTraineeCount = turns.filter((t) => t.role === 'trainee').length;
  const turnNo = priorTraineeCount + 1;

  const evalResult = evaluateTraineeUtterance({
    track: session.track,
    traineeText,
    customerText: lastCustomer?.content || '',
    turnNo,
    priorTraineeCount,
  });
  evalResult.turn_no = turnNo;

  const state = applyStateDelta(session, { evalResult, track: session.track });
  await pool.query(
    `UPDATE sales_sim_sessions
        SET emotion=$2, trust=$3, close_readiness=$4, satisfaction=$5
      WHERE id=$1`,
    [sessionId, state.emotion, state.trust, state.close_readiness, state.satisfaction]
  );

  await pool.query(
    `INSERT INTO sales_sim_turns
       (session_id, turn_no, role, content, coach_tags, principle_hits, state_delta, voice)
     VALUES ($1,$2,'trainee',$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)`,
    [
      sessionId, turnNo, traineeText,
      JSON.stringify(evalResult.coachTags || []),
      JSON.stringify({ violations: evalResult.violations, strengths: evalResult.strengths }),
      JSON.stringify(state),
      !!voice,
    ]
  );

  if (evalResult.coachTags?.length) {
    await pool.query(
      `INSERT INTO sales_sim_turns (session_id, turn_no, role, content, coach_tags)
       VALUES ($1,$2,'coach',$3,$4::jsonb)`,
      [
        sessionId, turnNo,
        evalResult.coachTags.map((t) => t.message).join('；'),
        JSON.stringify(evalResult.coachTags),
      ]
    );
  }

  const endCheck = shouldEndSession({ ...session, ...state }, session.track);
  const persona = await getPersona(pool, session.persona_key);
  let customerText = '';
  let finished = null;

  if (endCheck.end) {
    customerText = endCheck.reason;
    finished = await finishSession(pool, {
      sessionId, username, outcome: endCheck.outcome, force: true,
    });
  } else {
    const ruleReply = buildCustomerReply({
      track: session.track,
      persona,
      evalResult,
      session: { ...session, ...state },
      turnNo,
    });
    const history = [...turns, { role: 'trainee', content: traineeText }];
    customerText = await maybePolishCustomerReply(_callLLM, { persona, ruleReply, history });
    await pool.query(
      `INSERT INTO sales_sim_turns (session_id, turn_no, role, content)
       VALUES ($1,$2,'customer',$3)`,
      [sessionId, turnNo, customerText]
    );
  }

  return {
    ok: true,
    turn_no: turnNo,
    coach: evalResult.coachTags || [],
    principles: { violations: evalResult.violations, strengths: evalResult.strengths },
    state,
    customer: customerText ? { role: 'customer', content: customerText, turn_no: turnNo } : null,
    ended: !!finished?.ok,
    debrief: finished?.debrief || null,
    rank: finished?.rank || null,
    curriculum_next: finished?.curriculum_next || null,
    notification: finished?.notification || null,
  };
}

export async function finishSession(pool, {
  sessionId, username, outcome = 'completed', force = false,
}) {
  const session = await loadOwnedSession(pool, sessionId, username);
  if (!session) return { ok: false, error: 'not_found' };
  if (session.status === 'finished' && !force) {
    return { ok: true, debrief: session.debrief, rank: await getRankStatus(pool, username, session.track) };
  }

  const turns = await loadTurns(pool, sessionId);
  const traineeTurns = turns.filter((t) => t.role === 'trainee');
  const evals = traineeTurns.map((t) => {
    const hits = t.principle_hits || {};
    return {
      turn_no: t.turn_no,
      violations: hits.violations || [],
      strengths: hits.strengths || [],
      triggers: [],
      coachTags: t.coach_tags || [],
    };
  });
  // recover triggers from paired customer lines
  for (const ev of evals) {
    const cust = turns.find((t) => t.role === 'customer' && t.turn_no === ev.turn_no - 1)
      || turns.find((t) => t.role === 'customer' && t.turn_no === 0);
    if (cust) ev.triggers = detectCustomerTriggers(cust.content);
  }

  const durationSec = Math.max(30, Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000));
  const debrief = await buildDebrief(pool, {
    track: session.track,
    session: { ...session, outcome },
    turns,
    evals,
    username,
  });

  await pool.query(
    `UPDATE sales_sim_sessions
        SET status='finished', finished_at=NOW(), duration_sec=$2, outcome=$3, debrief=$4::jsonb
      WHERE id=$1`,
    [sessionId, durationSec, outcome, JSON.stringify(debrief)]
  );

  const rank = await applySessionToRank(pool, {
    username,
    track: session.track,
    durationSec,
    debrief,
    difficulty: session.difficulty,
  });

  let nomination = null;
  try {
    nomination = await autoNominateFromDebrief(pool, {
      track: session.track,
      sessionId,
      username,
      debrief,
    });
  } catch (_) { /* ignore */ }

  const next = await recommendNextSession(pool, username, session.track).catch(() => null);

  const meta = typeof session.meta === 'string'
    ? (() => { try { return JSON.parse(session.meta); } catch { return {}; } })()
    : (session.meta || {});
  const personaTitle = meta.persona_title || session.persona_key;
  let notification = null;
  try {
    notification = await notifyTraineeReport(pool, {
      username,
      sessionId,
      track: session.track,
      debrief,
      rank,
      personaTitle,
    });
  } catch (_) { /* ignore notify failure */ }

  return {
    ok: true,
    debrief,
    rank,
    duration_sec: durationSec,
    nomination: nomination?.ok ? { scene_key: nomination.playbook?.scene_key } : null,
    curriculum_next: next,
    notification,
  };
}

export async function getSessionDetail(pool, sessionId, username) {
  const session = await loadOwnedSession(pool, sessionId, username);
  if (!session) return { ok: false, error: 'not_found' };
  const turns = await loadTurns(pool, sessionId);
  return { ok: true, session: publicSession(session), turns };
}

async function loadOwnedSession(pool, sessionId, username) {
  const r = await pool.query(
    `SELECT * FROM sales_sim_sessions WHERE id=$1 AND username=$2`,
    [sessionId, username]
  );
  return r.rows?.[0] || null;
}

async function loadTurns(pool, sessionId) {
  const r = await pool.query(
    `SELECT turn_no, role, content, coach_tags, principle_hits, state_delta, voice, created_at
       FROM sales_sim_turns WHERE session_id=$1 ORDER BY turn_no ASC, id ASC`,
    [sessionId]
  );
  return r.rows || [];
}

function publicSession(s) {
  return {
    id: s.id,
    track: s.track,
    persona_key: s.persona_key,
    difficulty: s.difficulty,
    status: s.status,
    emotion: s.emotion,
    trust: s.trust,
    close_readiness: s.close_readiness,
    satisfaction: s.satisfaction,
    started_at: s.started_at,
    finished_at: s.finished_at,
    outcome: s.outcome,
    meta: s.meta,
  };
}
