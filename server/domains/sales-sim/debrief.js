import { scoreSkillsFromEvals, SALES_SKILLS, CS_SKILLS } from './principles.js';
import { findPlaybooksForPrinciples, findPlaybooksForScenes } from './playbooks.js';
import {
  skillLabel, principleLabel, sceneLabel, localizeSourceLabel,
  formatSkillsGradeLine, scoreGrade, skillsGrades, localizeFocus,
} from './labels.js';
import { isStoreTrack, skillsForTrack } from './store-tracks.js';

export async function buildDebrief(pool, {
  track, session, turns, evals, username,
}) {
  const skills = scoreSkillsFromEvals(track, evals);
  if (track === 'sales') {
    skills.closing = clamp(Math.round((skills.closing + Number(session.close_readiness || 0)) / 2));
  } else if (track === 'cs' && skills.retention != null) {
    const baseRetention = Number(skills.retention || 70);
    skills.retention = clamp(Math.round(baseRetention + (Number(session.satisfaction || 60) - 60) * 0.4));
  } else if (isStoreTrack(track) && skills.service_awareness != null) {
    skills.service_awareness = clamp(Math.round(
      (Number(skills.service_awareness || 70) + Number(session.satisfaction || 60)) / 2
    ));
  }

  const skillKeys = skillsForTrack(track) || (track === 'sales' ? SALES_SKILLS : CS_SKILLS);
  const skillAvg = Math.round(skillKeys.reduce((a, k) => a + (skills[k] || 0), 0) / skillKeys.length);

  const allViolations = [];
  const allStrengths = [];
  const sceneSet = new Set();
  for (const ev of evals) {
    for (const v of ev.violations || []) allViolations.push({ ...v, turn_no: ev.turn_no });
    for (const s of ev.strengths || []) allStrengths.push({ ...s, turn_no: ev.turn_no });
    for (const t of ev.triggers || []) sceneSet.add(t);
  }

  const principleIds = [...new Set(allViolations.map((v) => v.principle_id).filter(Boolean))];
  const playbooks = [
    ...(await findPlaybooksForScenes(pool, track, [...sceneSet])),
    ...(await findPlaybooksForPrinciples(pool, track, principleIds)),
  ];
  const seen = new Set();
  const uniquePlaybooks = playbooks.filter((p) => {
    if (seen.has(p.scene_key)) return false;
    seen.add(p.scene_key);
    return true;
  }).slice(0, 4);

  const traineeTurns = turns.filter((t) => t.role === 'trainee');
  const customerTurns = turns.filter((t) => t.role === 'customer');
  const replacements = buildReplacements(traineeTurns, uniquePlaybooks, allViolations);

  const outcomeAxis = track === 'sales'
    ? Number(session.close_readiness || 0)
    : Number(session.satisfaction || 0);
  const score = clamp(Math.round(
    skillAvg * 0.7
    + outcomeAxis * 0.3
    - allViolations.length * 2
  ));

  const nextFocus = principleIds[0]
    || skillKeys.find((k) => (skills[k] || 100) < 75)
    || (track === 'sales' ? 'ask_first' : (track === 'cs' ? 'soothe_first' : skillKeys[0]));
  const skillsLabeled = Object.fromEntries(
    Object.entries(skills).map(([k, v]) => [skillLabel(k), scoreGrade(v)])
  );

  return {
    score,
    score_grade: scoreGrade(score),
    track,
    username,
    outcome: session.outcome || 'completed',
    state: {
      emotion: session.emotion,
      trust: session.trust,
      close_readiness: session.close_readiness,
      satisfaction: session.satisfaction,
    },
    skills,
    skills_grades: skillsGrades(skills),
    skills_labeled: skillsLabeled,
    skills_line: formatSkillsGradeLine(skills),
    strengths: dedupeDetails(allStrengths).slice(0, 5).map((s) => ({
      ...s,
      principle_label: principleLabel(s.principle_id),
    })),
    improvements: dedupeDetails(allViolations).slice(0, 5).map((v) => ({
      principle_id: v.principle_id,
      principle_label: principleLabel(v.principle_id),
      detail: v.detail,
      turn_no: v.turn_no,
      timing_note: `第 ${v.turn_no} 轮时机问题（先看原则，再看参考话术）`,
    })),
    replacements: replacements.map((r) => ({
      ...r,
      principle_label: principleLabel(r.principle_id),
      source_label: localizeSourceLabel(r.source_label),
    })),
    talk_ratio: {
      trainee: traineeTurns.length,
      customer: customerTurns.length,
      hint: traineeTurns.length > customerTurns.length * 1.5
        ? '你说得明显更多，建议控制在约 1:1'
        : '话轮比例尚可',
    },
    playbooks_used: uniquePlaybooks.map((p) => ({
      scene_key: p.scene_key,
      scene_label: sceneLabel(p.scene_key),
      source_label: localizeSourceLabel(p.source_label),
      exemplar_text: p.exemplar_text,
    })),
    next_focus: nextFocus,
    next_focus_label: localizeFocus(nextFocus),
  };
}

function buildReplacements(traineeTurns, playbooks, violations) {
  const out = [];
  for (const v of violations.slice(0, 3)) {
    const pb = playbooks.find((p) => (p.principle_ids || []).includes(v.principle_id))
      || playbooks[0];
    const original = traineeTurns.find((t) => t.turn_no === v.turn_no)?.content
      || traineeTurns[traineeTurns.length - 1]?.content
      || '';
    if (!pb) continue;
    out.push({
      principle_id: v.principle_id,
      original: String(original).slice(0, 120),
      suggested: pb.exemplar_text,
      source_label: localizeSourceLabel(pb.source_label),
      note: '参考话术，非唯一正确答案；措辞不同但符合原则即算对',
    });
  }
  return out;
}

function dedupeDetails(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = `${it.principle_id}:${it.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function clamp(n) {
  return Math.max(0, Math.min(100, Number(n) || 0));
}
