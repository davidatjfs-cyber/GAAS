import { getPersona, listPersonas, ensurePersonaSeed } from './personas.js';
import { ensurePlaybookSeed, listPlaybooks } from './playbooks.js';
import { evaluateTraineeUtterance, detectCustomerTriggers } from './principles.js';
import {
  applyStateDelta, buildCustomerTurn, maybeGenerateCustomerReply, maybePolishCustomerReply,
  shouldEndSession, shouldResolveSession, similarLine,
} from './customer-reply.js';
import { maybeRefineEvaluationWithLLM, applyRefinedEvaluation } from './llm-eval.js';
import { buildDebrief } from './debrief.js';
import { applySessionToRank, getRankStatus } from './rank.js';
import { recommendNextSession } from './curriculum.js';
import { autoNominateFromDebrief } from './playbook-lifecycle.js';
import { notifyTraineeReport } from './notify.js';
import { difficultyLabel } from './labels.js';
import { ensureTalentEngineSeed } from './talent-seed.js';
import {
  getProfile, listActiveCompetencies, buildCompetencySnapshot, trackToProfileKey,
} from './competency.js';
import { getCoachPersona, applyCoachPersonaToDebrief } from './coach-persona.js';
import { updateCoachMemoryFromSession } from './coach-memory.js';
import { recommendLearningLoop } from './learning-loop.js';
import { runFactGate } from './fact-gate.js';
import {
  getIncidentCard, attachKbArticles, publicIncidentCard, scoreIncidentPerformance,
} from './incident-cards.js';
import { buildIncidentCorrections } from './incident-dialogue.js';

const ALLOWED_TRACKS = new Set([
  'sales', 'cs', 'consult', 'foh_server', 'cashier', 'store_manager', 'kitchen_staff', 'hq_ops',
]);

let _callLLM = null;
export function setSalesSimLlm(fn) {
  _callLLM = typeof fn === 'function' ? fn : null;
}

export async function ensureSalesSimSeed(pool) {
  await ensurePersonaSeed(pool);
  await ensurePlaybookSeed(pool);
  await ensureTalentEngineSeed(pool);
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
  coachPersonaKey = null,
  examMode = false,
  scenarioKey = null,
  incidentCardKey = null,
}) {
  if (!ALLOWED_TRACKS.has(track)) return { ok: false, error: 'invalid_track' };

  let incident = null;
  if (incidentCardKey) {
    incident = await getIncidentCard(pool, incidentCardKey).catch(() => null);
    if (!incident) return { ok: false, error: 'incident_not_found' };
    if (incident.job_profile_key !== track) return { ok: false, error: 'incident_profile_mismatch' };
    incident = await attachKbArticles(pool, incident);
  }

  let persona = null;
  if (!incident) {
    persona = await getPersona(pool, personaKey);
    if (!persona || persona.track !== track) return { ok: false, error: 'persona_not_found' };
    if (audience === 'tenant' && persona.audience === 'internal') {
      return { ok: false, error: 'persona_not_allowed' };
    }
  }

  const diff = Number(difficulty) || incident?.difficulty || persona?.difficulty || 1;
  const jobProfileKey = trackToProfileKey(track);
  const profile = await getProfile(pool, jobProfileKey).catch(() => null);
  const resolvedCoachKey = examMode
    ? 'strict'
    : (coachPersonaKey
      || profile?.default_coach_persona_key
      || (track === 'sales' ? 'sales_champion' : 'encouraging'));
  const resolvedScenario = scenarioKey || incident?.category_key || persona?.profile?.scenario_key || null;
  const personaKeyResolved = incident ? `inc_${incident.card_key}` : persona.persona_key;
  const openingLine = incident?.opening_line || persona.opening_line;
  const incidentSnapshot = incident ? {
    card_key: incident.card_key,
    category_key: incident.category_key,
    title: incident.title,
    counterpart_role: incident.counterpart_role,
    incident_brief: incident.incident_brief,
    locked_facts: incident.locked_facts,
    success_criteria: incident.success_criteria,
    failure_signals: incident.failure_signals,
    sop_checklist: incident.sop_checklist,
    experience_rubric: incident.experience_rubric,
    competency_keys: incident.competency_keys,
    kb_articles: incident.kb_articles || [],
    must_know: incident.must_know || [],
    key_phrases: incident.key_phrases || [],
    model_answer: incident.model_answer || '',
    probe_questions: incident.probe_questions || [],
  } : null;

  let competencySnapshot = [];
  try {
    const comps = await listActiveCompetencies(pool, jobProfileKey);
    competencySnapshot = buildCompetencySnapshot(comps);
  } catch (_) { /* migration pending */ }

  const emotion0 = track === 'sales' ? 45 : 35;
  const trust0 = track === 'sales' ? 40 : 35;
  const close0 = track === 'sales' ? 15 : 0;
  const sat0 = track === 'sales' ? 0 : 55;

  const meta = {
    persona_title: incident?.title || persona?.title,
    source_type: incident ? 'incident_card' : persona?.source_type,
    exam_mode: !!examMode,
    incident: incidentSnapshot,
  };

  const insertArgs = [
    username, track, personaKeyResolved, diff,
    emotion0, trust0, close0, sat0,
    JSON.stringify(meta),
    audience || persona?.audience || 'tenant',
    tenantId || persona?.tenant_id || null,
    jobProfileKey,
    resolvedCoachKey,
    JSON.stringify(competencySnapshot),
    !!examMode,
    resolvedScenario,
    incident?.card_key || null,
    JSON.stringify(incidentSnapshot || {}),
  ];
  let session;
  try {
    const r = await pool.query(
      `INSERT INTO sales_sim_sessions
         (username, track, persona_key, difficulty, emotion, trust, close_readiness, satisfaction,
          meta, audience, tenant_id, job_profile_key, coach_persona_key, competency_snapshot,
          exam_mode, scenario_key, incident_card_key, incident_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18::jsonb)
       RETURNING *`,
      insertArgs
    );
    session = r.rows[0];
  } catch (e) {
    if (!/job_profile_key|competency_snapshot|coach_persona_key|exam_mode|scenario_key|incident_/i.test(e?.message || '')) {
      throw e;
    }
    const r = await pool.query(
      `INSERT INTO sales_sim_sessions
         (username, track, persona_key, difficulty, emotion, trust, close_readiness, satisfaction, meta, audience, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING *`,
      insertArgs.slice(0, 11)
    );
    session = r.rows[0];
  }
  await pool.query(
    `INSERT INTO sales_sim_turns (session_id, turn_no, role, content)
     VALUES ($1,0,'customer',$2)`,
    [session.id, openingLine]
  );

  return {
    ok: true,
    session: publicSession(session),
    opening: { role: 'customer', content: openingLine, turn_no: 0 },
    incident: publicIncidentCard(incident),
    persona: incident ? {
      persona_key: personaKeyResolved,
      title: incident.title,
      difficulty: incident.difficulty,
      profile: { incident: true },
    } : {
      persona_key: persona.persona_key,
      title: persona.title,
      difficulty: persona.difficulty,
      profile: persona.profile,
    },
    coach_persona_key: resolvedCoachKey,
    competency_snapshot: competencySnapshot,
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

  const priorTraineeTexts = turns.filter((t) => t.role === 'trainee').map((t) => t.content);
  const priorCustomerTexts = turns.filter((t) => t.role === 'customer').map((t) => t.content);
  const ruleEval = evaluateTraineeUtterance({
    track: session.track,
    traineeText,
    customerText: lastCustomer?.content || '',
    turnNo,
    priorTraineeCount,
  });
  // LLM 复核单句判定（上下文纠偏 + 补漏 + 教练旁白）；失败回退规则判定
  const refined = await maybeRefineEvaluationWithLLM(_callLLM, {
    track: session.track,
    traineeText,
    customerText: lastCustomer?.content || '',
    evalResult: ruleEval,
    turnNo,
  });
  const evalResult = refined?.ok ? applyRefinedEvaluation(ruleEval, refined) : ruleEval;
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

  // 考试模式：不展示实时教练旁白（仍记入 principle_hits 供复盘）
  if (evalResult.coachTags?.length && !session.exam_mode) {
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
    const incidentSnap = session.incident_snapshot
      || (typeof session.meta === 'object' ? session.meta?.incident : null)
      || {};
    const priorCustomerIntents = turns
      .filter((t) => t.role === 'customer')
      .map((t) => t.state_delta?.customer_intent)
      .filter(Boolean);
    // 跨轮累计 L1 优点（按原则去重）：学员整体表现稳定 → 客户软化
    const seenPrinciples = new Set();
    for (const t of turns) {
      for (const s of (t.principle_hits?.strengths || [])) {
        if (s?.principle_id) seenPrinciples.add(s.principle_id);
      }
    }
    for (const s of (evalResult.strengths || [])) {
      if (s?.principle_id) seenPrinciples.add(s.principle_id);
    }
    const turnPlan = buildCustomerTurn({
      track: session.track,
      persona,
      evalResult,
      session: { ...session, ...state, incident_snapshot: incidentSnap },
      turnNo,
      traineeText,
      priorTraineeTexts,
      priorCustomerTexts,
      cumulativeStrengths: seenPrinciples.size,
    });
    const ruleReply = turnPlan.reply;
    const history = [...turns, { role: 'trainee', content: traineeText }];
    let customerIntent = turnPlan.intent || null;
    // 满意收束：诉求全部覆盖 + 满意度达标 → 客户自然道谢收场（第二次 resolve 触发）
    const successEnd = shouldResolveSession({
      track: session.track,
      session: { ...session, ...state },
      turnPlan,
      priorCustomerIntents,
      turnNo,
    });
    if (successEnd.end) {
      customerText = successEnd.closingLine;
      finished = await finishSession(pool, {
        sessionId, username, outcome: successEnd.outcome, force: true,
      });
    } else if (incidentSnap?.card_key || incidentSnap?.locked_facts) {
      // 事故卡路径保留原有规则+润色
      customerText = await maybePolishCustomerReply(_callLLM, {
        persona: persona || { title: incidentSnap.title, profile: incidentSnap },
        ruleReply,
        history,
        lockedFacts: incidentSnap.locked_facts || [],
        priorCustomerTexts,
        state,
      });
    } else {
      // 人格路径：LLM 按意图+状态生成整句
      const generated = await maybeGenerateCustomerReply(_callLLM, {
        persona,
        track: session.track,
        state,
        ruleReply,
        intent: turnPlan.intent || '',
        guidance: turnPlan.guidance || '',
        history,
        priorCustomerTexts,
        priorCustomerIntents,
      });
      customerText = generated.reply;
      customerIntent = generated.intent || turnPlan.intent || null;
    }
    // 生成若仍高度重复上一句对方话，回退规则句
    if (priorCustomerTexts.length) {
      const last = String(priorCustomerTexts[priorCustomerTexts.length - 1] || '');
      if (last && customerText && similarLine(last, customerText)) customerText = ruleReply;
    }
    await pool.query(
      `INSERT INTO sales_sim_turns (session_id, turn_no, role, content, state_delta)
       VALUES ($1,$2,'customer',$3,$4::jsonb)`,
      [sessionId, turnNo, customerText, JSON.stringify({ ...state, customer_intent: customerIntent })]
    );
  }

  return {
    ok: true,
    turn_no: turnNo,
    exam_mode: !!session.exam_mode,
    coach: session.exam_mode ? [] : (evalResult.coachTags || []),
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

function buildEvalsWithTriggers(turns, track) {
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
    if (cust) ev.triggers = detectCustomerTriggers(cust.content, track);
  }
  return { traineeTurns, evals };
}

async function runFactGateForEvals(traineeTurns, evals) {
  try {
    const traineeTexts = traineeTurns.map((t) => t.content);
    return await runFactGate({
      traineeTexts,
      queryHints: [...new Set(evals.flatMap((e) => e.triggers || []))].slice(0, 3),
    });
  } catch (_) {
    return null;
  }
}

async function enrichDebriefWithCoachAndLearning(pool, {
  session, debrief, evals, username, jobProfileKey,
}) {
  let nextDebrief = debrief;
  try {
    const coachPersona = await getCoachPersona(pool, session.coach_persona_key);
    if (coachPersona) nextDebrief = applyCoachPersonaToDebrief(nextDebrief, coachPersona);
  } catch (_) { /* ignore */ }

  const sceneKeys = [...new Set(evals.flatMap((e) => e.triggers || []))];
  try {
    await updateCoachMemoryFromSession(pool, {
      username,
      jobProfileKey,
      skills: nextDebrief.skills || {},
      personaKey: session.persona_key,
      scenarioKeys: sceneKeys,
    });
  } catch (_) { /* migration pending */ }

  let learningLoop = null;
  try {
    learningLoop = await recommendLearningLoop(pool, {
      jobProfileKey,
      skills: nextDebrief.skills || {},
      weakestCompetency: nextDebrief.next_focus || null,
    });
    if (learningLoop?.ok) {
      nextDebrief = {
        ...nextDebrief,
        learning_loop: {
          weakest: learningLoop.weakest,
          courses: learningLoop.courses,
          kpi_hooks: learningLoop.kpi_hooks,
        },
      };
    }
  } catch (_) { /* ignore */ }

  return { debrief: nextDebrief, learningLoop };
}

function applyFactGateToDebrief(debrief, factGate) {
  if (!factGate?.ok) return debrief;
  return {
    ...debrief,
    fact_gate: {
      warnings: factGate.warnings || [],
      hits: (factGate.hits || []).slice(0, 4),
    },
  };
}

function applyIncidentScoringToDebrief(debrief, { incidentSnap, evals, traineeTurns }) {
  if (!incidentSnap?.card_key) return debrief;
  const dual = scoreIncidentPerformance({
    card: incidentSnap,
    evals,
    traineeTexts: traineeTurns.map((t) => t.content),
  });
  let nextDebrief = {
    ...debrief,
    score: dual.total_score,
    score_grade: dual.total_score >= 91 ? '卓越'
      : dual.total_score >= 80 ? '优秀'
        : dual.total_score >= 70 ? '合格' : '不合格',
    incident_scores: dual,
    incident: {
      card_key: incidentSnap.card_key,
      title: incidentSnap.title,
      brief: incidentSnap.incident_brief,
      success_criteria: incidentSnap.success_criteria,
    },
    kb_articles: dual.kb_articles || incidentSnap.kb_articles || [],
  };
  const corrections = buildIncidentCorrections({ card: incidentSnap, traineeTurns, evals });
  nextDebrief.model_answer = corrections.model_answer;
  nextDebrief.turn_corrections = corrections.turn_corrections;
  nextDebrief.coverage = corrections.coverage;
  // 事故卡优先挂真实 KB，避免复盘出现「请配置 recommended_topic_ids」
  const arts = nextDebrief.kb_articles || [];
  if (arts.length) {
    nextDebrief.learning_loop = {
      ...(nextDebrief.learning_loop || {}),
      courses: arts.map((a) => ({
        type: 'knowledge_base', id: a.id, title: a.title, reason: '事故卡关联知识库',
      })),
    };
  }
  return nextDebrief;
}

async function persistFinishedSession(pool, { sessionId, durationSec, outcome, debrief, factGate }) {
  try {
    await pool.query(
      `UPDATE sales_sim_sessions
          SET status='finished', finished_at=NOW(), duration_sec=$2, outcome=$3, debrief=$4::jsonb,
              fact_gate=COALESCE($5::jsonb, '{}'::jsonb)
        WHERE id=$1`,
      [
        sessionId, durationSec, outcome, JSON.stringify(debrief),
        factGate?.ok ? JSON.stringify(factGate) : '{}',
      ]
    );
  } catch (e) {
    if (!/fact_gate/i.test(e?.message || '')) throw e;
    await pool.query(
      `UPDATE sales_sim_sessions
          SET status='finished', finished_at=NOW(), duration_sec=$2, outcome=$3, debrief=$4::jsonb
        WHERE id=$1`,
      [sessionId, durationSec, outcome, JSON.stringify(debrief)]
    );
  }
}

async function recordTrainingEvent(pool, {
  username, session, jobProfileKey, sessionId, debrief, learningLoop,
}) {
  try {
    await pool.query(
      `INSERT INTO talent_training_events
         (username, tenant_id, job_profile_key, session_id, event_type, competency_key, payload)
       VALUES ($1,$2,$3,$4,'session_finished',$5,$6::jsonb)`,
      [
        username,
        session.tenant_id || null,
        jobProfileKey,
        sessionId,
        debrief.next_focus || learningLoop?.weakest || null,
        JSON.stringify({
          score: debrief.score,
          skills: debrief.skills,
          exam_mode: !!session.exam_mode,
          scenario_key: session.scenario_key || null,
          courses: learningLoop?.courses || [],
        }),
      ]
    );
  } catch (_) { /* migration pending */ }
}

async function finalizeAndNotify(pool, { username, session, sessionId, debrief, rank }) {
  let nomination = null;
  try {
    nomination = await autoNominateFromDebrief(pool, {
      track: session.track, sessionId, username, debrief,
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
      username, sessionId, track: session.track, debrief, rank, personaTitle,
    });
  } catch (_) { /* ignore notify failure */ }

  return { nomination, next, notification };
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
  const { traineeTurns, evals } = buildEvalsWithTriggers(turns, session.track);
  const factGate = await runFactGateForEvals(traineeTurns, evals);

  const durationSec = Math.max(30, Math.round((Date.now() - new Date(session.started_at).getTime()) / 1000));
  let debrief = await buildDebrief(pool, {
    track: session.track,
    session: { ...session, outcome },
    turns,
    evals,
    username,
  });

  const jobProfileKey = session.job_profile_key || trackToProfileKey(session.track);
  let learningLoop;
  ({ debrief, learningLoop } = await enrichDebriefWithCoachAndLearning(pool, {
    session, debrief, evals, username, jobProfileKey,
  }));

  debrief = applyFactGateToDebrief(debrief, factGate);

  const incidentSnap = session.incident_snapshot
    || (typeof session.meta === 'object' ? session.meta?.incident : null);
  debrief = applyIncidentScoringToDebrief(debrief, { incidentSnap, evals, traineeTurns });

  await persistFinishedSession(pool, { sessionId, durationSec, outcome, debrief, factGate });
  await recordTrainingEvent(pool, {
    username, session, jobProfileKey, sessionId, debrief, learningLoop,
  });

  const rank = await applySessionToRank(pool, {
    username, track: session.track, durationSec, debrief, difficulty: session.difficulty,
  });

  const { nomination, next, notification } = await finalizeAndNotify(pool, {
    username, session, sessionId, debrief, rank,
  });

  return {
    ok: true,
    debrief,
    rank,
    duration_sec: durationSec,
    nomination: nomination?.ok ? { scene_key: nomination.playbook?.scene_key } : null,
    curriculum_next: next,
    learning_loop: learningLoop,
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
    job_profile_key: s.job_profile_key || s.track,
    coach_persona_key: s.coach_persona_key || null,
    competency_snapshot: s.competency_snapshot || [],
    exam_mode: !!s.exam_mode,
    scenario_key: s.scenario_key || null,
    incident_card_key: s.incident_card_key || null,
    incident_snapshot: s.incident_snapshot || null,
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
