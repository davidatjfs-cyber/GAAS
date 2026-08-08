/**
 * AI 顾客会话引擎 v1（技能化培训）
 * 流程：选技能 → 开场 → 深挖 → 挑战 → 收尾 → 评分 → 进度/升级
 */

import { SKILL_SCRIPTS } from './coach-scripts.js';
import { evalSession, scanViolations, evaluateUpgrade, nextLevel } from './coach-scoring.js';
import { retrieveCoachKnowledge } from './coach-rag.js';

let _coachLlm = null;

export function setCoachLlm(fn) {
  _coachLlm = typeof fn === 'function' ? fn : null;
}

function pick(pool, idx) {
  return pool[Math.abs(idx) % pool.length];
}

function sessionNo() {
  return `CT-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1e4)}`;
}

function phaseFor(session, script) {
  const customerTurns = (session.transcript || []).filter((t) => t.role === 'customer').length;
  const used = session.phase;
  if (used === 'opening' && customerTurns >= 1) return 'deep_dive';
  if (used === 'deep_dive' && customerTurns >= 1 + script.min_deep_turns) return 'challenge';
  if (used === 'challenge' && customerTurns >= 1 + script.min_deep_turns + script.min_challenge_turns) return 'closing';
  return used;
}

export async function createCoachSession(pool, { username, skillKey }) {
  const script = SKILL_SCRIPTS[skillKey];
  if (!script) return { ok: false, error: 'skill_script_not_ready' };
  const seed = String(username).length + skillKey.length;
  const persona = {
    ...script.persona,
    seed,
    brand: seed % 2 === 0 ? '洪潮' : '马己仙',
  };
  const knowledge = await retrieveCoachKnowledge(pool, {
    skillLabel: script.skill_key,
    brand: persona.brand,
    keywords: (script.knowledge_hints || []).join(' '),
    limit: 4,
  });
  const no = sessionNo();
  const opening = pick(script.opening, seed);
  const transcript = [{ role: 'customer', text: opening, phase: 'opening' }];
  const r = await pool.query(
    `INSERT INTO customer_twin_coach_sessions
       (session_no, username, skill_key, persona, locked_facts, phase, transcript, status, tenant_id)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'deep_dive',$6::jsonb,'active','default')
     RETURNING id`,
    [no, username, skillKey, JSON.stringify(persona), JSON.stringify({ knowledge }), JSON.stringify(transcript)]
  );
  return {
    ok: true,
    session: {
      id: r.rows[0].id,
      session_no: no,
      skill_key: skillKey,
      phase: 'deep_dive',
      persona,
      knowledge: knowledge.map((k) => k.title),
      transcript,
    },
  };
}

export async function nextCoachTurn(pool, { sessionId, username, message }) {
  const r = await pool.query(
    `SELECT * FROM customer_twin_coach_sessions
      WHERE id = $1 AND username = $2 AND status = 'active'`,
    [sessionId, username]
  );
  const session = r.rows?.[0];
  if (!session) return { ok: false, error: 'session_not_found' };
  const script = SKILL_SCRIPTS[session.skill_key];
  if (!script) return { ok: false, error: 'skill_script_not_ready' };
  const transcript = session.transcript || [];
  transcript.push({ role: 'trainee', text: String(message || '').slice(0, 1000) });

  const customerTurns = transcript.filter((t) => t.role === 'customer').length;
  const violations = scanViolations(transcript);
  const nextPhase = phaseFor({ ...session, transcript, phase: session.phase }, script);
  let customerText;
  if (nextPhase === 'closing') {
    customerText = violations.length
      ? pick(script.closing_unsatisfied, customerTurns)
      : pick(script.closing_satisfied, customerTurns);
  } else if (nextPhase === 'challenge') {
    customerText = pick(script.challenge, customerTurns);
  } else if (nextPhase === 'deep_dive') {
    customerText = pick(script.deep_dive, customerTurns);
  } else {
    customerText = pick(script.opening, customerTurns);
  }
  transcript.push({ role: 'customer', text: customerText, phase: nextPhase });
  await pool.query(
    `UPDATE customer_twin_coach_sessions
        SET phase = $3, transcript = $4::jsonb
      WHERE id = $1`,
    [sessionId, null, nextPhase, JSON.stringify(transcript)]
  );
  return {
    ok: true,
    phase: nextPhase,
    transcript,
    customer: customerText,
    done: nextPhase === 'closing',
  };
}

export async function finishCoachSession(pool, { sessionId, username, useLlm = true }) {
  const r = await pool.query(
    `SELECT * FROM customer_twin_coach_sessions
      WHERE id = $1 AND username = $2`,
    [sessionId, username]
  );
  const session = r.rows?.[0];
  if (!session) return { ok: false, error: 'session_not_found' };
  if (session.status !== 'active') return { ok: false, error: 'already_finished' };

  const transcript = session.transcript || [];
  const violations = scanViolations(transcript);
  let dims = null;
  if (useLlm && _coachLlm) {
    dims = await judgeWithLlm(transcript, session.skill_key, session.persona).catch(() => null);
  }
  const result = evalSession({ transcript, skillKey: session.skill_key, scores: dims, violations });

  await pool.query(
    `UPDATE customer_twin_coach_sessions
        SET status='finished', success=$3, rule_score=$4::jsonb, ai_score=$5::jsonb, finished_at=NOW()
      WHERE id = $1`,
    [sessionId, null, result.success, JSON.stringify({ violations: result.violations }), JSON.stringify(result.dims)]
  );

  const progress = await updateSkillProgress(pool, username, session.skill_key, result.success);
  return {
    ok: true,
    report: {
      total: result.total,
      dims: result.dims,
      violations: result.violations,
      success: result.success,
      transcript_length: transcript.length,
    },
    progress,
  };
}

async function updateSkillProgress(pool, username, skillKey, success) {
  const cur = await pool.query(
    `SELECT * FROM job_coach_skill_progress WHERE username=$1 AND skill_key=$2 AND tenant_id='default'`,
    [username, skillKey]
  );
  const row = cur.rows?.[0] || { level: 'normal', trained_count: 0, success_count: 0 };
  const trained = Number(row.trained_count || 0) + 1;
  const successCount = Number(row.success_count || 0) + (success ? 1 : 0);
  const up = evaluateUpgrade({ ...row, trained_count: trained, success_count: successCount });
  let level = row.level || 'normal';
  let trainedAfter = trained;
  let successAfter = successCount;
  if (up.upgrade) {
    level = up.next_level;
    trainedAfter = 0;
    successAfter = 0;
  }
  await pool.query(
    `INSERT INTO job_coach_skill_progress (username, skill_key, level, trained_count, success_count, tenant_id)
     VALUES ($1,$2,$3,$4,$5,'default')
     ON CONFLICT (username, skill_key, tenant_id) DO UPDATE SET
       level=EXCLUDED.level, trained_count=EXCLUDED.trained_count,
       success_count=EXCLUDED.success_count, updated_at=NOW()`,
    [username, skillKey, level, trainedAfter, successAfter]
  );
  return {
    level,
    trained_count: trainedAfter,
    success_count: successAfter,
    upgraded: !!up.upgrade,
    next_level: up.upgrade ? level : nextLevel(level),
  };
}

async function judgeWithLlm(transcript, skillKey, persona) {
  const dims = ['专业度', '语气', '应对', '完整性', '知识准确性', '主动性'];
  if (skillKey === 'selling') dims.push('销售转化');
  const prompt =
    `你是餐厅服务员培训评分裁判。根据以下对话，按维度 0-100 打分，只输出 JSON：{"专业度":80,...}。\n` +
    `客人人设：${JSON.stringify(persona || {})}\n` +
    `对话：\n${transcript.map((t) => `${t.role === 'customer' ? '客人' : '服务员'}：${t.text}`).join('\n')}`;
  const resp = await _coachLlm([
    { role: 'system', content: '你是严谨的评分裁判，只输出 JSON。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.1, maxTokens: 300 });
  const text = String(resp?.content || '');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const parsed = JSON.parse(m[0]);
  const out = {};
  for (const d of dims) {
    const v = Number(parsed[d]);
    out[d] = Number.isFinite(v) ? Math.max(20, Math.min(100, v)) : 70;
  }
  return out;
}
