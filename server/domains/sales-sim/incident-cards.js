/**
 * 事故卡：大类 → 具体场景；抽卡、挂 KB、双维评分
 */

import { INCIDENT_CATEGORIES } from './incident-categories.js';
import { INCIDENT_SEED_CARDS } from './incident-seed-cards.js';
import {
  collectKeyPhrasesForHints, mustKnowForCategory, BUILTIN_TRAINING_ARTICLES,
} from './training-pack.js';

export async function ensureIncidentSeed(pool) {
  for (const c of INCIDENT_CATEGORIES) {
    await pool.query(
      `INSERT INTO job_coach_scenario_categories
         (category_key, label, description, job_profile_keys, sort_order, active)
       VALUES ($1,$2,$3,$4,$5,TRUE)
       ON CONFLICT (category_key) DO UPDATE SET
         label=EXCLUDED.label, description=EXCLUDED.description,
         job_profile_keys=EXCLUDED.job_profile_keys, sort_order=EXCLUDED.sort_order, active=TRUE`,
      [c.category_key, c.label, c.description, c.job_profile_keys, c.sort_order]
    );
  }
  for (const card of INCIDENT_SEED_CARDS) {
    try {
      await pool.query(
        `INSERT INTO job_coach_incident_cards
           (card_key, category_key, job_profile_key, title, difficulty, counterpart_role,
            incident_brief, locked_facts, opening_line, success_criteria, failure_signals,
            sop_checklist, experience_rubric, competency_keys, kb_title_hints,
            model_answer, probe_questions, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17::jsonb,TRUE)
         ON CONFLICT (card_key) DO UPDATE SET
           title=EXCLUDED.title, difficulty=EXCLUDED.difficulty,
           counterpart_role=EXCLUDED.counterpart_role, incident_brief=EXCLUDED.incident_brief,
           locked_facts=EXCLUDED.locked_facts, opening_line=EXCLUDED.opening_line,
           success_criteria=EXCLUDED.success_criteria, failure_signals=EXCLUDED.failure_signals,
           sop_checklist=EXCLUDED.sop_checklist, experience_rubric=EXCLUDED.experience_rubric,
           competency_keys=EXCLUDED.competency_keys, kb_title_hints=EXCLUDED.kb_title_hints,
           model_answer=EXCLUDED.model_answer, probe_questions=EXCLUDED.probe_questions,
           active=TRUE`,
        [
          card.card_key, card.category_key, card.job_profile_key, card.title, card.difficulty,
          card.counterpart_role, card.incident_brief, JSON.stringify(card.locked_facts || []),
          card.opening_line, card.success_criteria || '', card.failure_signals || [],
          JSON.stringify(card.sop_checklist || []), JSON.stringify(card.experience_rubric || []),
          card.competency_keys || [], card.kb_title_hints || [],
          card.model_answer || '', JSON.stringify(card.probe_questions || []),
        ]
      );
    } catch (e) {
      if (!/model_answer|probe_questions/i.test(e?.message || '')) throw e;
      await pool.query(
        `INSERT INTO job_coach_incident_cards
           (card_key, category_key, job_profile_key, title, difficulty, counterpart_role,
            incident_brief, locked_facts, opening_line, success_criteria, failure_signals,
            sop_checklist, experience_rubric, competency_keys, kb_title_hints, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,TRUE)
         ON CONFLICT (card_key) DO UPDATE SET
           title=EXCLUDED.title, difficulty=EXCLUDED.difficulty,
           counterpart_role=EXCLUDED.counterpart_role, incident_brief=EXCLUDED.incident_brief,
           locked_facts=EXCLUDED.locked_facts, opening_line=EXCLUDED.opening_line,
           success_criteria=EXCLUDED.success_criteria, failure_signals=EXCLUDED.failure_signals,
           sop_checklist=EXCLUDED.sop_checklist, experience_rubric=EXCLUDED.experience_rubric,
           competency_keys=EXCLUDED.competency_keys, kb_title_hints=EXCLUDED.kb_title_hints,
           active=TRUE`,
        [
          card.card_key, card.category_key, card.job_profile_key, card.title, card.difficulty,
          card.counterpart_role, card.incident_brief, JSON.stringify(card.locked_facts || []),
          card.opening_line, card.success_criteria || '', card.failure_signals || [],
          JSON.stringify(card.sop_checklist || []), JSON.stringify(card.experience_rubric || []),
          card.competency_keys || [], card.kb_title_hints || [],
        ]
      );
    }
  }
}

export async function listCategories(pool, jobProfileKey = null) {
  const r = await pool.query(
    `SELECT category_key, label, description, job_profile_keys, sort_order
       FROM job_coach_scenario_categories
      WHERE active=TRUE
        AND ($1::text IS NULL OR $1 = ANY(job_profile_keys))
      ORDER BY sort_order, category_key`,
    [jobProfileKey]
  );
  return r.rows || [];
}

export async function listIncidentCards(pool, {
  jobProfileKey = null,
  categoryKey = null,
  competencyKey = null,
  limit = 50,
} = {}) {
  const r = await pool.query(
    `SELECT card_key, category_key, job_profile_key, title, difficulty, counterpart_role,
            incident_brief, competency_keys, kb_title_hints
       FROM job_coach_incident_cards
      WHERE active=TRUE
        AND ($1::text IS NULL OR job_profile_key=$1)
        AND ($2::text IS NULL OR category_key=$2)
        AND ($3::text IS NULL OR $3 = ANY(competency_keys))
      ORDER BY difficulty, card_key
      LIMIT $4`,
    [jobProfileKey, categoryKey, competencyKey, limit]
  );
  return r.rows || [];
}

export async function getIncidentCard(pool, cardKey) {
  const r = await pool.query(
    `SELECT c.*, cat.label AS category_label
       FROM job_coach_incident_cards c
       JOIN job_coach_scenario_categories cat ON cat.category_key = c.category_key
      WHERE c.card_key=$1 AND c.active=TRUE`,
    [cardKey]
  );
  return r.rows?.[0] || null;
}

/** 按大类/能力随机抽一张事故卡 */
export async function drawIncidentCard(pool, {
  jobProfileKey,
  categoryKey = null,
  competencyKey = null,
  excludeKeys = [],
  maxDifficulty = 10,
} = {}) {
  const r = await pool.query(
    `SELECT *
       FROM job_coach_incident_cards
      WHERE active=TRUE
        AND job_profile_key=$1
        AND difficulty <= $2
        AND ($3::text IS NULL OR category_key=$3)
        AND ($4::text IS NULL OR $4 = ANY(competency_keys))
        AND NOT (card_key = ANY($5::text[]))
      ORDER BY random()
      LIMIT 1`,
    [jobProfileKey, maxDifficulty, categoryKey, competencyKey, excludeKeys]
  );
  let card = r.rows?.[0] || null;
  if (!card && excludeKeys.length) {
    return drawIncidentCard(pool, {
      jobProfileKey, categoryKey, competencyKey, excludeKeys: [], maxDifficulty,
    });
  }
  if (card) {
    const cat = INCIDENT_CATEGORIES.find((c) => c.category_key === card.category_key);
    card = await attachKbArticles(pool, {
      ...card,
      category_label: cat?.label || null,
    });
  }
  return card;
}

export async function attachKbArticles(pool, card) {
  if (!card) return card;
  const hints = card.kb_title_hints || [];
  const articles = [];
  const seen = new Set();
  for (const title of hints) {
    const r = await pool.query(
      `SELECT id, title, category
         FROM knowledge_base
        WHERE enabled IS DISTINCT FROM FALSE
          AND (title = $1 OR title ILIKE $2)
        ORDER BY CASE WHEN title=$1 THEN 0 ELSE 1 END
        LIMIT 1`,
      [title, `%${String(title).slice(0, 12)}%`]
    );
    if (r.rows?.[0] && !seen.has(r.rows[0].id)) {
      seen.add(r.rows[0].id);
      articles.push({
        id: r.rows[0].id,
        title: r.rows[0].title,
        category: r.rows[0].category,
      });
    }
  }
  // 内置培训包兜底：hints 未命中 KB 时仍挂要点标题
  for (const builtin of BUILTIN_TRAINING_ARTICLES) {
    const matched = hints.some(
      (h) => builtin.title === h
        || builtin.title.includes(String(h).slice(0, 8))
        || String(h).includes(builtin.title.slice(0, 8))
        || (builtin.tags || []).some((t) => String(h).includes(t))
    );
    if (!matched) continue;
    if (articles.some((a) => a.title === builtin.title)) continue;
    articles.push({
      id: null,
      title: builtin.title,
      category: builtin.category,
      builtin: true,
    });
  }
  const keyPhrases = collectKeyPhrasesForHints([
    ...hints,
    ...articles.map((a) => a.title),
  ]);
  return {
    ...card,
    kb_articles: articles,
    must_know: mustKnowForCategory(card.category_key),
    key_phrases: keyPhrases,
  };
}

export function publicIncidentCard(card) {
  if (!card) return null;
  return {
    card_key: card.card_key,
    category_key: card.category_key,
    category_label: card.category_label || null,
    job_profile_key: card.job_profile_key,
    title: card.title,
    difficulty: card.difficulty,
    counterpart_role: card.counterpart_role,
    counterpart_label: counterpartLabel(card.counterpart_role),
    incident_brief: card.incident_brief,
    locked_facts: card.locked_facts || [],
    opening_line: card.opening_line,
    success_criteria: card.success_criteria,
    competency_keys: card.competency_keys || [],
    kb_articles: card.kb_articles || [],
    sop_checklist: card.sop_checklist || [],
    must_know: card.must_know || mustKnowForCategory(card.category_key),
    key_phrases: card.key_phrases || [],
    model_answer: card.model_answer || '',
    probe_questions: card.probe_questions || [],
  };
}

function counterpartLabel(role) {
  return ({
    customer: '客人',
    staff: '员工',
    hr: '人事/行政',
    regulator: '检查人员',
    mystery: '神秘顾客/督导',
  })[role] || role;
}

/**
 * 双维评分：知识/SOP 执行 + 客人（接收方）体验
 * 基于 principle evals + 失败信号关键词，不额外 LLM
 */
export function scoreIncidentPerformance({ card, evals = [], traineeTexts = [] }) {
  const joined = traineeTexts.join('\n');
  const allViolations = evals.flatMap((e) => e.violations || []);
  const allStrengths = evals.flatMap((e) => e.strengths || []);
  const checklist = asArr(card?.sop_checklist);
  const expRubric = asArr(card?.experience_rubric);
  const failSignals = card?.failure_signals || [];

  // SOP：检查表项是否在学员话里出现近似表达
  let sopHits = 0;
  const sopDetails = [];
  for (const item of checklist) {
    const hit = sopItemHit(String(item), joined, allStrengths);
    if (hit) sopHits += 1;
    sopDetails.push({ item: String(item), hit });
  }
  const sopRatio = checklist.length ? sopHits / checklist.length : 0.6;
  const phrases = asArr(card?.key_phrases).map(String).filter(Boolean);
  let phraseHits = 0;
  for (const p of phrases) {
    if (p && joined.includes(p)) phraseHits += 1;
  }
  const phraseRatio = phrases.length ? Math.min(1, phraseHits / Math.min(phrases.length, 6)) : 0;
  let knowledgeScore = Math.round(
    50 + sopRatio * 35 + phraseRatio * 15 - allViolations.length * 6
  );
  knowledgeScore = clamp(knowledgeScore);

  // 体验：安抚/共情/具体方案 vs 失败信号
  let expScore = 70 + allStrengths.length * 3 - allViolations.length * 7;
  for (const sig of failSignals) {
    if (sig && joined.includes(String(sig))) expScore -= 10;
  }
  if (/抱歉|对不起|不好意思/.test(joined)) expScore += 6;
  if (/马上|立刻|我来处理|帮您/.test(joined)) expScore += 4;
  if (/不是我|怪厨房|怪别人|按规定不能|你自己/.test(joined)) expScore -= 8;
  if (card?.counterpart_role === 'hr' && /手册|主管|店长|我去查|不确定/.test(joined)) {
    expScore += 5; // 人事场景：诚实求助优于编造
  }
  if (card?.counterpart_role === 'hr' && /我们都是|肯定是|随便|无所谓/.test(joined)) {
    expScore -= 10;
  }
  expScore = clamp(expScore);

  const total = clamp(Math.round(knowledgeScore * 0.5 + expScore * 0.5));

  return {
    knowledge_score: knowledgeScore,
    experience_score: expScore,
    total_score: total,
    sop_details: sopDetails,
    experience_notes: expRubric,
    kb_articles: card?.kb_articles || [],
  };
}

function sopItemHit(item, text, strengths) {
  const keyMap = [
    [/致歉|道歉|抱歉/, /抱歉|对不起|不好意思/],
    [/确认|核实|事实/, /确认|核实|查一下|对一下/],
    [/方案|补偿|处理/, /免单|重做|补偿|退款|换|安排|处理/],
    [/闭环|告知|回访/, /处理好|跟您说|稍后|回访|跟进/],
    [/配合|出示|记录/, /记录|台账|配合|带您|请看/],
    [/迎|微笑|等待/, /欢迎|请稍等|大概|组/],
  ];
  for (const [itemRe, textRe] of keyMap) {
    if (itemRe.test(item) && textRe.test(text)) return true;
  }
  if (strengths.some((s) => /soothe|own_exception|stabilize|greet|clear/.test(s.principle_id || ''))) {
    if (/安抚|致歉|揽责|稳场|问候/.test(item)) return true;
  }
  return false;
}

function asArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}
