/**
 * AI 顾客会话引擎 v1（技能化培训）
 * 流程：选技能 → 开场 → 深挖 → 挑战 → 收尾 → 评分 → 进度/升级
 */

import { scriptFor, pickScene, shuffledIndices } from './coach-scripts.js';
import { evalSession, scanViolations, evaluateUpgrade, nextLevel } from './coach-scoring.js';
import { retrieveCoachKnowledge } from './coach-rag.js';

let _coachLlm = null;

export function setCoachLlm(fn) {
  _coachLlm = typeof fn === 'function' ? fn : null;
}

function pick(pool) {
  const arr = Array.isArray(pool) ? pool : [];
  if (!arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
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

async function resolveScript(pool, username, skillKey) {
  const cur = await pool.query(
    `SELECT level FROM job_coach_skill_progress
      WHERE username=$1 AND skill_key=$2 AND tenant_id='default'`,
    [username, skillKey]
  );
  const level = String(cur.rows?.[0]?.level || 'normal').trim();
  const script = scriptFor(skillKey, level);
  return { script, level };
}

export async function createCoachSession(pool, { username, skillKey }) {
  const { script, level } = await resolveScript(pool, username, skillKey);
  if (!script) return { ok: false, error: 'skill_script_not_ready' };
  const last = await pool.query(
    `SELECT persona FROM customer_twin_coach_sessions
      WHERE username=$1 AND skill_key=$2 AND status='finished'
        AND persona->>'scene_key' IS NOT NULL
      ORDER BY finished_at DESC NULLS LAST LIMIT 1`,
    [username, skillKey]
  );
  const avoidKey = String(last.rows?.[0]?.persona?.scene_key || '').trim();
  const scene = pickScene(script, { avoidKey });
  if (!scene) return { ok: false, error: 'skill_script_not_ready' };
  const seed = String(username).length + skillKey.length + Math.floor(Math.random() * 1e6);
  const persona = {
    label: scene.persona.label,
    desc: scene.persona.desc,
    scene: scene.persona.scene,
    scene_key: scene.key,
    level,
    seed,
    brand: seed % 2 === 0 ? '洪潮' : '马己仙',
    order: {
      deep: shuffledIndices(script.min_deep_turns),
      challenge: shuffledIndices(script.min_challenge_turns),
    },
  };
  const knowledge = await retrieveCoachKnowledge(pool, {
    skillLabel: script.skill_key,
    brand: persona.brand,
    keywords: (script.knowledge_hints || []).join(' '),
    limit: 4,
  });
  const no = sessionNo();
  const opening = pick(scene.opening);
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
      level,
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
  const persona = session.persona || {};
  const script = scriptFor(session.skill_key, persona.level || 'normal');
  if (!script) return { ok: false, error: 'skill_script_not_ready' };
  const scene = (script.scenes || []).find((s) => s.key === persona.scene_key) || script.scenes?.[0];
  if (!scene) return { ok: false, error: 'skill_script_not_ready' };
  const transcript = session.transcript || [];
  transcript.push({ role: 'trainee', text: String(message || '').slice(0, 1000) });

  const customerTurns = transcript.filter((t) => t.role === 'customer').length;
  const violations = scanViolations(transcript);
  const nextPhase = phaseFor({ ...session, transcript, phase: session.phase }, script);
  const order = persona.order || {};
  let customerText;
  if (nextPhase === 'closing') {
    customerText = violations.length
      ? pick(script.closing_unsatisfied)
      : pick(script.closing_satisfied);
  } else if (nextPhase === 'challenge') {
    const idx = Math.max(0, customerTurns - 1 - script.min_deep_turns);
    customerText = scene.challenge[(order.challenge || [])[idx] ?? idx] ?? scene.challenge[idx];
  } else if (nextPhase === 'deep_dive') {
    const idx = Math.max(0, customerTurns - 1);
    customerText = scene.deep_dive[(order.deep || [])[idx] ?? idx] ?? scene.deep_dive[idx];
  } else {
    customerText = pick(scene.opening);
  }
  transcript.push({ role: 'customer', text: customerText, phase: nextPhase });
  await pool.query(
    `UPDATE customer_twin_coach_sessions
        SET phase = $2, transcript = $3::jsonb
      WHERE id = $1`,
    [sessionId, nextPhase, JSON.stringify(transcript)]
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
  let judged = null;
  if (useLlm && _coachLlm) {
    judged = await judgeWithLlm(transcript, session.skill_key, session.persona).catch(() => null);
  }
  const result = evalSession({
    transcript,
    skillKey: session.skill_key,
    scores: judged?.scores || null,
    violations,
    issues: judged?.issues || [],
  });

  await pool.query(
    `UPDATE customer_twin_coach_sessions
        SET status='finished', success=$2, rule_score=$3::jsonb, ai_score=$4::jsonb, finished_at=NOW()
      WHERE id = $1`,
    [sessionId, result.success, JSON.stringify({ violations: result.violations }), JSON.stringify(result.dims)]
  );

  const progress = await updateSkillProgress(pool, username, session.skill_key, result.success);
  return {
    ok: true,
    report: {
      total: result.total,
      dims: result.dims,
      violations: result.violations,
      success: result.success,
      suggestions: result.suggestions,
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
    `你是餐厅服务员培训评分裁判。根据以下对话：\n` +
    `1) 按维度 0-100 打分；\n` +
    `2) 对每个低于 80 分的维度，从对话里挑出服务员具体那句扣分原话，说明问题、改进建议和标准说法。\n` +
    `只输出 JSON：{"专业度":80,"语气":70,...,"问题":[{"维度":"语气","原文":"服务员说的原话","问题":"具体问题","建议":"怎么改","标准说法":"应该怎么说"}]}。\n` +
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
  const scores = {};
  for (const d of dims) {
    const v = Number(parsed[d]);
    scores[d] = Number.isFinite(v) ? Math.max(20, Math.min(100, v)) : 70;
  }
  const issues = Array.isArray(parsed['问题']) ? parsed['问题'].slice(0, 6).map((it) => ({
    dimension: String(it?.维度 || it?.dimension || '').trim(),
    quote: String(it?.原文 || it?.quote || '').slice(0, 200),
    problem: String(it?.问题 || it?.problem || '').trim(),
    standard: String(it?.标准说法 || it?.standard || '').trim(),
  })).filter((it) => it.dimension) : [];
  return { scores, issues };
}
