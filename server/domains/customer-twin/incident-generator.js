/**
 * 真实客诉 → 岗位教练事故卡生成器
 * 从真实桌访（table_visit_records）与差评（agent_messages negative_review）提取真实客诉，
 * 生成事故卡写入 job_coach_incident_cards（active=false 待审核），
 * 由现有 AI岗位教练（job-coach.html）自动消费，前端零改动。
 */

import { INCIDENT_CATEGORIES } from '../sales-sim/incident-categories.js';

const KB_HINTS = {
  dine_complaint: ['前厅客诉处置通用SOP（陪练内置）', '前厅客诉处置SOP'],
  delivery_complaint: ['外卖客诉与履约通用SOP（陪练内置）', '马己仙外卖培训SOP'],
  greeting_host: ['迎宾揽客与等位服务要点（陪练内置）', '迎宾员岗位培训SOP'],
  table_service: ['L2 服务员——席间服务', '马己仙前厅工作职责和标准SOP'],
  upsell_member: ['L2 服务员——席间服务', 'L1 收银员——独立完成收银全流程'],
  cashier_dispute: ['收银结账争议处理要点（陪练内置）', 'L1 收银员——独立完成收银全流程'],
  manager_escalate: ['店长客诉升级与现场稳场要点（陪练内置）', '店长（M3）——门店全盘经营'],
};

const DEFAULT_SOP = ['先致歉安抚', '确认事实', '给处理方案', '闭环告知'];
const DEFAULT_FAILURE = ['推诿', '争辩', '否认事实', '空话别着急'];
const DEFAULT_RUBRIC = ['客人感到被重视', '语气稳定不顶撞', '方案具体可执行'];
const DEFAULT_PROBES = [
  '请先复述客人不满的核心事实，再说你的处理步骤。',
  '如果客人不接受当前方案，你下一步怎么做？',
];

const RULES = [
  {
    category_key: 'delivery_complaint',
    re: /外卖|骑手|超时|洒漏|洒了|漏餐|餐洒/,
    difficulty: 3,
    competency: ['exception_handling', 'communication'],
  },
  {
    category_key: 'cashier_dispute',
    re: /结账|账单|算错|买单|扫码|付款|会员不能用|积分/,
    difficulty: 2,
    competency: ['communication', 'exception_handling'],
  },
  {
    category_key: 'upsell_member',
    re: /会员|充值|办卡|储值/,
    difficulty: 2,
    competency: ['member_conversion', 'communication'],
  },
  {
    category_key: 'dine_complaint',
    re: /异物|头发|铁丝|虫子|玻璃|塑料|上错|送错|不是我们点|没点这个|催|慢|还没上|漏了|漏单|没上|等太久|多久|态度|没人理|不理|冷漠|叫了|服务|餐具|桌子脏|厕所|卫生|热|吵|灯|咸|淡|老|不新鲜|腥|分量|少|贵|价格|不值|凉/,
    difficulty: 3,
    competency: ['exception_handling', 'communication'],
  },
];

function classify(text) {
  const joined = String(text || '');
  for (const rule of RULES) {
    if (rule.re.test(joined)) {
      return {
        category_key: rule.category_key,
        difficulty: /异物|头发|铁丝|虫子|态度差|没人理/.test(joined) ? 4 : rule.difficulty,
        competency_keys: rule.competency,
      };
    }
  }
  return {
    category_key: 'dine_complaint',
    difficulty: 2,
    competency_keys: ['exception_handling', 'communication'],
  };
}

function categoryMeta(categoryKey) {
  const cat = INCIDENT_CATEGORIES.find((c) => c.category_key === categoryKey);
  return {
    job_profile_key: (cat?.job_profile_keys || ['foh_server'])[0],
    label: cat?.label || categoryKey,
  };
}

function clampText(text, max = 300) {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function buildCard({ cardKey, store, date, platform, product, reason, openingLine, metaExtra, extraFacts = [] }) {
  const joined = [reason, product, store].filter(Boolean).join(' ');
  const cls = classify(joined);
  const meta = categoryMeta(cls.category_key);
  const facts = [
    `门店：${store || '未记录'}`,
    `日期：${date || '未记录'}`,
  ];
  if (product) facts.push(`涉及：${clampText(product, 80)}`);
  if (platform) facts.push(`来源：${platform}`);
  for (const f of extraFacts) {
    if (f) facts.push(clampText(f, 120));
  }
  const rawLine = clampText(reason, 160);
  if (rawLine) facts.push(`原文：${rawLine}`);

  const successCriteria = '先安抚确认事实，给出可执行方案与时间，闭环告知，不让客人带着不满离店';
  const brief = [
    `【真实案例${platform ? `·${platform}` : ''}】${store || ''} ${date || ''}`,
    reason ? `客人反馈：${clampText(reason, 260)}` : '',
    '（由顾客数字孪生从真实桌访/差评自动生成，训练目标：按店内 SOP 处理真实客诉）',
  ].filter(Boolean).join('\n');

  return {
    card_key: cardKey,
    category_key: cls.category_key,
    job_profile_key: meta.job_profile_key,
    title: `真实客诉·${clampText(store || '门店', 14)}·${meta.label}`,
    difficulty: cls.difficulty,
    counterpart_role: 'customer',
    incident_brief: brief,
    locked_facts: facts,
    opening_line: openingLine || rawLine || '我想反映一下今天用餐的情况。',
    success_criteria: successCriteria,
    failure_signals: DEFAULT_FAILURE,
    sop_checklist: DEFAULT_SOP,
    experience_rubric: DEFAULT_RUBRIC,
    competency_keys: cls.competency_keys,
    kb_title_hints: KB_HINTS[cls.category_key] || KB_HINTS.dine_complaint,
    model_answer: `标准答法：先致歉安抚→确认事实（${facts.slice(0, 3).join('、')}）→给出方案与时间→闭环告知。成功标准：${successCriteria}`,
    probe_questions: DEFAULT_PROBES,
    meta: {
      source: 'customer_twin',
      source_table: metaExtra.sourceTable,
      source_record_id: metaExtra.sourceRecordId,
      store,
      date,
      platform: platform || null,
      generated_at: new Date().toISOString(),
    },
  };
}

async function upsertCard(pool, card) {
  await pool.query(
    `INSERT INTO job_coach_incident_cards
       (card_key, category_key, job_profile_key, title, difficulty, counterpart_role,
        incident_brief, locked_facts, opening_line, success_criteria, failure_signals,
        sop_checklist, experience_rubric, competency_keys, kb_title_hints,
        model_answer, probe_questions, active, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17::jsonb,FALSE,$18::jsonb)
     ON CONFLICT (card_key) DO UPDATE SET
       category_key=EXCLUDED.category_key, job_profile_key=EXCLUDED.job_profile_key,
       title=EXCLUDED.title, difficulty=EXCLUDED.difficulty,
       incident_brief=EXCLUDED.incident_brief, locked_facts=EXCLUDED.locked_facts,
       opening_line=EXCLUDED.opening_line, success_criteria=EXCLUDED.success_criteria,
       failure_signals=EXCLUDED.failure_signals, sop_checklist=EXCLUDED.sop_checklist,
       experience_rubric=EXCLUDED.experience_rubric, competency_keys=EXCLUDED.competency_keys,
       kb_title_hints=EXCLUDED.kb_title_hints, model_answer=EXCLUDED.model_answer,
       probe_questions=EXCLUDED.probe_questions, meta=EXCLUDED.meta
     WHERE job_coach_incident_cards.meta->>'review_status' IS NULL`,
    [
      card.card_key, card.category_key, card.job_profile_key, card.title, card.difficulty,
      card.counterpart_role, card.incident_brief, JSON.stringify(card.locked_facts),
      card.opening_line, card.success_criteria, card.failure_signals,
      JSON.stringify(card.sop_checklist), JSON.stringify(card.experience_rubric),
      card.competency_keys, card.kb_title_hints, card.model_answer,
      JSON.stringify(card.probe_questions), JSON.stringify(card.meta),
    ]
  );
}

export async function fetchTableVisitComplaints(pool, limit = 50) {
  const r = await pool.query(
    `SELECT id, date, store, satisfaction_level, repeat_customer,
            feedback, customer_complaint, dissatisfaction_dish,
            dissatisfaction_main_reason, suggested_improvements,
            staff_performance, facility_issues, problem_resolution,
            compensation_provided, complaint_resolution, guest_count, amount
       FROM table_visit_records
      WHERE (customer_complaint IS NOT NULL AND length(customer_complaint) > 3)
         OR (dissatisfaction_main_reason IS NOT NULL AND length(dissatisfaction_main_reason) > 3)
         OR (suggested_improvements IS NOT NULL AND length(suggested_improvements) > 3)
         OR (staff_performance IS NOT NULL AND length(staff_performance) > 3)
         OR (facility_issues IS NOT NULL AND length(facility_issues) > 3)
         OR (feedback IS NOT NULL AND length(feedback) > 3
             AND feedback NOT LIKE '不满意的菜品%')
      ORDER BY date DESC
      LIMIT $1`,
    [limit]
  );
  return r.rows || [];
}

export async function fetchBadReviews(pool, limit = 50) {
  const r = await pool.query(
    `SELECT id, agent_data
       FROM agent_messages
      WHERE content_type = 'negative_review'
        AND agent_data ? 'reason'
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return r.rows || [];
}

export function buildFromTableVisit(row) {
  const meaningful = [
    row.customer_complaint,
    row.dissatisfaction_main_reason,
    row.suggested_improvements,
    row.staff_performance,
    row.facility_issues,
    row.problem_resolution,
    row.feedback && !String(row.feedback).startsWith('不满意的菜品') ? row.feedback : '',
  ].filter((v) => String(v || '').trim().length > 3);
  if (!meaningful.length) return null;

  const reason = [
    row.customer_complaint,
    row.dissatisfaction_main_reason ? `不满原因：${row.dissatisfaction_main_reason}` : '',
    row.suggested_improvements ? `改进建议：${row.suggested_improvements}` : '',
    row.staff_performance ? `服务表现：${row.staff_performance}` : '',
    row.facility_issues ? `环境问题：${row.facility_issues}` : '',
    row.problem_resolution ? `处理情况：${row.problem_resolution}` : '',
    row.compensation_provided ? `补偿情况：${row.compensation_provided}` : '',
    row.feedback && !String(row.feedback).startsWith('不满意的菜品') ? row.feedback : '',
    row.dissatisfaction_dish ? `涉及菜品：${row.dissatisfaction_dish}` : '',
  ].filter(Boolean).join('；');
  if (!reason) return null;
  const extraFacts = [
    row.satisfaction_level ? `满意度：${row.satisfaction_level}` : '',
    row.repeat_customer ? '顾客类型：老顾客' : '',
    row.guest_count ? `用餐人数：${row.guest_count}` : '',
  ];
  return buildCard({
    cardKey: `twin_tv_${row.id}`,
    store: row.store,
    date: row.date ? String(row.date) : '',
    platform: '桌访',
    product: row.dissatisfaction_dish || '',
    reason,
    extraFacts,
    metaExtra: { sourceTable: 'table_visit_records', sourceRecordId: String(row.id) },
  });
}

export function buildFromBadReview(row) {
  const d = row.agent_data || {};
  const rawReason = String(d.reason || '').trim();
  if (!rawReason || /不属于差评|无差评|该评价为好评|^无$/.test(rawReason)) return null;
  const reason = [rawReason, d.extractedInfo].filter(Boolean).join('；');
  return buildCard({
    cardKey: `twin_br_${String(row.id).slice(0, 12)}`,
    store: d.store || '',
    date: d.date && d.date !== '未提及' ? d.date : '',
    platform: d.platform || '大众点评',
    product: d.product || '',
    reason,
    metaExtra: { sourceTable: 'agent_messages', sourceRecordId: String(row.id) },
  });
}

export async function generateIncidentCards(pool, { limitPerSource = 50 } = {}) {
  const [tvRows, brRows] = await Promise.all([
    fetchTableVisitComplaints(pool, limitPerSource),
    fetchBadReviews(pool, limitPerSource),
  ]);
  const cards = [];
  for (const row of tvRows) {
    const card = buildFromTableVisit(row);
    if (card) cards.push(card);
  }
  for (const row of brRows) {
    const card = buildFromBadReview(row);
    if (card) cards.push(card);
  }
  let upserted = 0;
  for (const card of cards) {
    await upsertCard(pool, card);
    upserted += 1;
  }
  const cleaned = await rejectThinTableVisitCards(pool);
  return { candidates: cards.length, upserted, cleaned_thin_cards: cleaned, sources: { table_visit: tvRows.length, bad_review: brRows.length } };
}

export async function rejectThinTableVisitCards(pool) {
  const r = await pool.query(
    `SELECT card_key, incident_brief, locked_facts
       FROM job_coach_incident_cards
      WHERE active = FALSE
        AND meta->>'source' = 'customer_twin'
        AND meta->>'source_table' = 'table_visit_records'
        AND meta->>'review_status' IS DISTINCT FROM 'rejected'`
  );
  let cleaned = 0;
  for (const row of r.rows || []) {
    const facts = Array.isArray(row.locked_facts) ? row.locked_facts.join(' ') : '';
    const text = `${row.incident_brief || ''} ${facts}`;
    const hasContext = /不满原因|改进建议|服务表现|环境问题|处理情况|补偿情况|满意度|顾客类型|投诉|等待|上菜|态度|卫生|退款|退菜|重做/.test(text);
    const onlyDish = /涉及菜品|不满意的菜品/.test(text);
    if (onlyDish && !hasContext) {
      await pool.query(
        `UPDATE job_coach_incident_cards
            SET meta = jsonb_set(jsonb_set(meta, '{review_status}', '"rejected"'), '{reject_reason}', '"thin_table_visit_only_dish"')
          WHERE card_key = $1 AND active = FALSE`,
        [row.card_key]
      );
      cleaned += 1;
    }
  }
  return cleaned;
}

export async function listPendingTwinCards(pool, { limit = 100 } = {}) {
  const r = await pool.query(
    `SELECT card_key, category_key, job_profile_key, title, difficulty,
            incident_brief, locked_facts, opening_line, meta, created_at
       FROM job_coach_incident_cards
      WHERE active = FALSE
        AND meta->>'source' = 'customer_twin'
        AND meta->>'review_status' IS DISTINCT FROM 'rejected'
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit]
  );
  return r.rows || [];
}

export async function countPendingTwinCards(pool) {
  const r = await pool.query(
    `SELECT count(*)::int AS n
       FROM job_coach_incident_cards
      WHERE active = FALSE
        AND meta->>'source' = 'customer_twin'
        AND meta->>'review_status' IS DISTINCT FROM 'rejected'`
  );
  return r.rows?.[0]?.n || 0;
}

export async function setTwinCardActive(pool, cardKey, active, username = 'system') {
  const reviewStatus = active ? 'approved' : 'rejected';
  const r = await pool.query(
    `UPDATE job_coach_incident_cards
        SET active = $2,
            meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{review_status}', to_jsonb($3::text))
                    || jsonb_build_object('reviewed_at', now(), 'reviewed_by', coalesce($4, 'system'))
      WHERE card_key = $1 AND meta->>'source' = 'customer_twin'
      RETURNING card_key`,
    [cardKey, active, reviewStatus, username]
  );
  return r.rows?.[0] || null;
}

/** 拒绝（软删除）：保留记录并标记 rejected，生成器不再重建该来源 */
export async function rejectTwinCard(pool, cardKey, username = 'system') {
  const r = await pool.query(
    `UPDATE job_coach_incident_cards
        SET active = FALSE,
            meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{review_status}', to_jsonb('rejected'::text))
                    || jsonb_build_object('reviewed_at', now(), 'reviewed_by', coalesce($2, 'system'))
      WHERE card_key = $1 AND meta->>'source' = 'customer_twin'
      RETURNING card_key`,
    [cardKey, username]
  );
  return r.rows?.[0] || null;
}
