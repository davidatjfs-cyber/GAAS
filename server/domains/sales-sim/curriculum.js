/**
 * 下一场自动出题：按薄弱能力 + 职级解锁难度选人格
 */

import { getRankStatus, rankLadder } from './rank.js';
import { listPersonas } from './personas.js';
import { SALES_SKILLS, CS_SKILLS } from './principles.js';
import { localizeFocus, difficultyLabel } from './labels.js';

const FOCUS_TO_PERSONA = {
  sales: {
    ask_first: ['li_boss_skeptical', 'busy_owner'],
    no_early_pitch: ['busy_owner', 'price_shopper'],
    sell_outcome: ['price_shopper', 'biz_repurchase_gap'],
    stay_on_pain: ['price_shopper', 'li_boss_skeptical'],
    no_argue: ['li_boss_skeptical', 'pos_blocker'],
    questioning: ['cold_gatekeeper', 'busy_owner'],
    listening: ['li_boss_skeptical', 'silent_closer'],
    value: ['biz_repurchase_gap', 'price_shopper'],
    closing: ['last_minute_regret', 'think_again_boss'],
  },
  cs: {
    soothe_first: ['cs_sms_fail', 'cs_angry_bug'],
    empathy: ['cs_angry_bug', 'cs_rage_escalation'],
    ask_expectation: ['cs_angry_bug', 'cs_ux_loop'],
    dig_refund_root: ['cs_refund', 'cs_refund_lawyer'],
    close_loop: ['cs_sms_fail', 'cs_multi_issue'],
    diagnosis: ['cs_multi_issue', 'cs_ux_loop'],
    resolution: ['cs_refund', 'cs_sms_fail'],
    retention: ['cs_refund_lawyer', 'cs_rage_escalation'],
  },
};

function maxDifficultyForRank(track, rankKey) {
  const ladder = rankLadder(track);
  const idx = Math.max(0, ladder.findIndex((r) => r.key === rankKey));
  if (idx <= 0) return 3;
  if (idx === 1) return 6;
  if (idx === 2) return 10;
  return 10;
}

export async function recommendNextSession(pool, username, track) {
  const rank = await getRankStatus(pool, username, track);
  const skills = rank.skills || {};
  const keys = track === 'cs' ? CS_SKILLS : SALES_SKILLS;
  let weakest = keys[0];
  let weakestScore = 101;
  for (const k of keys) {
    const v = Number(skills[k]);
    if (!Number.isNaN(v) && v < weakestScore) {
      weakestScore = v;
      weakest = k;
    }
  }

  const last = await pool.query(
    `SELECT debrief->>'next_focus' AS next_focus, persona_key
       FROM sales_sim_sessions
      WHERE username=$1 AND track=$2 AND status='finished'
      ORDER BY finished_at DESC LIMIT 1`,
    [username, track]
  );
  const focus = last.rows?.[0]?.next_focus || weakest;
  const lastPersona = last.rows?.[0]?.persona_key;

  const maxDiff = maxDifficultyForRank(track, rank.rank_key);
  const personas = (await listPersonas(pool, track, { audience: 'internal' })).filter((p) =>
    Number(p.difficulty || 1) <= maxDiff
  );

  const preferKeys = FOCUS_TO_PERSONA[track]?.[focus] || FOCUS_TO_PERSONA[track]?.[weakest] || [];
  let pick = personas.find((p) => preferKeys.includes(p.persona_key) && p.persona_key !== lastPersona);
  if (!pick) pick = personas.find((p) => preferKeys.includes(p.persona_key));
  if (!pick) {
    // 在解锁难度内挑尚未练过的更高难度
    const tried = await pool.query(
      `SELECT DISTINCT persona_key FROM sales_sim_sessions WHERE username=$1 AND track=$2`,
      [username, track]
    );
    const triedSet = new Set((tried.rows || []).map((r) => r.persona_key));
    pick = [...personas].sort((a, b) => b.difficulty - a.difficulty).find((p) => !triedSet.has(p.persona_key))
      || personas[0];
  }

  return {
    ok: true,
    track,
    focus,
    weakest_skill: weakest,
    weakest_score: weakestScore === 101 ? null : weakestScore,
    max_difficulty: maxDiff,
    rank_key: rank.rank_key,
    rank_label: rank.rank_label,
    recommended: pick ? {
      persona_key: pick.persona_key,
      title: pick.title,
      difficulty: pick.difficulty,
      difficulty_label: difficultyLabel(pick.difficulty),
      opening_line: pick.opening_line,
      reason: `针对薄弱点「${localizeFocus(focus)}」，职级 ${rank.rank_label} 解锁至 ${difficultyLabel(maxDiff)}`,
    } : null,
    focus_label: localizeFocus(focus),
    max_difficulty_label: difficultyLabel(maxDiff),
  };
}
