/**
 * 下一场自动出题：按薄弱能力 + 职级解锁难度选人格
 */

import { getRankStatus, rankLadder } from './rank.js';
import { listPersonas } from './personas.js';
import { SALES_SKILLS, CS_SKILLS, CONSULT_SKILLS } from './principles.js';
import { localizeFocus, difficultyLabel } from './labels.js';
import {
  getCoachMemory, resolveFocusFromMemory, recentPersonaSet,
} from './coach-memory.js';
import { trackToProfileKey } from './competency.js';
import { recommendLearningLoop } from './learning-loop.js';
import { skillsForTrack } from './store-tracks.js';

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
  consult: {
    communication: ['cs_activity_setup', 'cs_growth_diagnosis'],
    product_knowledge: ['cs_pos_data_connect', 'cs_report_billing'],
    service_awareness: ['cs_marketing_sms', 'cs_pos_data_connect'],
    recommendation: ['cs_growth_diagnosis', 'cs_marketing_sms'],
    clear_steps: ['cs_activity_setup'],
    accurate_info: ['cs_report_billing', 'cs_pos_data_connect'],
    confirm_scope: ['cs_pos_data_connect', 'cs_report_billing'],
    suggest_next: ['cs_growth_diagnosis', 'cs_marketing_sms'],
  },
  foh_server: {
    exception_handling: ['foh_rush_diner', 'foh_wrong_dish'],
    recommendation: ['foh_first_visit'],
    member_conversion: ['foh_member_ask'],
    service_awareness: ['foh_vip', 'foh_rush_diner'],
    brand_expression: ['foh_vip'],
    communication: ['foh_first_visit', 'foh_member_ask'],
    product_knowledge: ['foh_first_visit'],
    soothe_guest: ['foh_rush_diner'],
    recommend_after_need: ['foh_first_visit'],
  },
  cashier: {
    exception_handling: ['cash_refund_guest'],
    communication: ['cash_queue_guest'],
    product_knowledge: ['cash_groupbuy'],
    member_conversion: ['cash_groupbuy'],
    service_awareness: ['cash_queue_guest'],
    refund_verify: ['cash_refund_guest'],
    queue_calm: ['cash_queue_guest'],
  },
  store_manager: {
    exception_handling: ['mgr_angry_guest'],
    communication: ['mgr_staff_conflict', 'mgr_hq_review'],
    brand_expression: ['mgr_mystery'],
    service_awareness: ['mgr_mystery', 'mgr_hq_review'],
    stabilize_first: ['mgr_angry_guest'],
    listen_staff: ['mgr_staff_conflict'],
  },
  kitchen_staff: {
    exception_handling: ['kit_rush_ticket'],
    communication: ['kit_rush_ticket'],
    product_knowledge: ['kit_wrong_item'],
    service_awareness: ['kit_wrong_item'],
  },
  hq_ops: {
    communication: ['hq_boss_brief'],
    brand_expression: ['hq_boss_brief'],
    service_awareness: ['hq_boss_brief'],
    exception_handling: ['hq_boss_brief'],
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
  const keys = skillsForTrack(track)
    || (track === 'cs' ? CS_SKILLS : (track === 'consult' ? CONSULT_SKILLS : SALES_SKILLS));
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
  const fallbackFocus = last.rows?.[0]?.next_focus || weakest;
  const lastPersona = last.rows?.[0]?.persona_key;

  const jobProfileKey = trackToProfileKey(track);
  let memory = null;
  try {
    memory = await getCoachMemory(pool, username, jobProfileKey);
  } catch (_) { /* migration pending */ }
  const focus = resolveFocusFromMemory(memory, fallbackFocus);
  const recentSet = recentPersonaSet(memory);

  const maxDiff = maxDifficultyForRank(track, rank.rank_key);
  const personas = (await listPersonas(pool, track, { audience: 'internal' })).filter((p) =>
    Number(p.difficulty || 1) <= maxDiff
  );

  const preferKeys = FOCUS_TO_PERSONA[track]?.[focus] || FOCUS_TO_PERSONA[track]?.[weakest] || [];
  let pick = personas.find((p) => preferKeys.includes(p.persona_key)
    && p.persona_key !== lastPersona
    && !recentSet.has(p.persona_key));
  if (!pick) {
    pick = personas.find((p) => preferKeys.includes(p.persona_key) && p.persona_key !== lastPersona);
  }
  if (!pick) pick = personas.find((p) => preferKeys.includes(p.persona_key));
  if (!pick) {
    const tried = await pool.query(
      `SELECT DISTINCT persona_key FROM sales_sim_sessions WHERE username=$1 AND track=$2`,
      [username, track]
    );
    const triedSet = new Set((tried.rows || []).map((r) => r.persona_key));
    pick = [...personas].sort((a, b) => b.difficulty - a.difficulty).find((p) => !triedSet.has(p.persona_key))
      || personas[0];
  }

  let learningLoop = null;
  try {
    learningLoop = await recommendLearningLoop(pool, {
      jobProfileKey,
      skills,
      weakestCompetency: weakest,
    });
  } catch (_) { /* ignore */ }

  return {
    ok: true,
    track,
    job_profile_key: jobProfileKey,
    focus,
    weakest_skill: weakest,
    weakest_score: weakestScore === 101 ? null : weakestScore,
    max_difficulty: maxDiff,
    rank_key: rank.rank_key,
    rank_label: rank.rank_label,
    coach_memory: memory ? {
      focus_competencies: memory.focus_competencies,
      boost_until: memory.boost_until,
    } : null,
    learning_loop: learningLoop,
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
