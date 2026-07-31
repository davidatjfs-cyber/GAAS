/**
 * Talent Engine — Coach Persona（赛后/旁白风格，非客户人格）
 */

export const BUILTIN_COACH_PERSONAS = [
  {
    persona_key: 'strict',
    label: '严格型教练',
    description: '直指问题，少客套',
    tone_rules: {
      praise_first: false,
      criticism_intensity: 'high',
      address: '你',
      opener: '本场问题很明确：',
    },
    debrief_template: {
      strengths_prefix: '做得对的地方：',
      improvements_prefix: '必须立刻改正：',
      next_prefix: '下场必须练：',
    },
  },
  {
    persona_key: 'encouraging',
    label: '鼓励型教练',
    description: '先肯定再给改进点',
    tone_rules: {
      praise_first: true,
      criticism_intensity: 'medium',
      address: '你',
      opener: '这场有进步，我们一起看还能更好的地方：',
    },
    debrief_template: {
      strengths_prefix: '值得保持：',
      improvements_prefix: '可以再顺一点：',
      next_prefix: '建议下场重点：',
    },
  },
  {
    persona_key: 'store_manager',
    label: '店长型教练',
    description: '门店实战口吻，强调落地',
    tone_rules: {
      praise_first: true,
      criticism_intensity: 'medium',
      address: '你',
      opener: '按门店标准看这一场：',
    },
    debrief_template: {
      strengths_prefix: '现场可用：',
      improvements_prefix: '上线前先改：',
      next_prefix: '明日班前再练：',
    },
  },
  {
    persona_key: 'sales_champion',
    label: '冠军销售教练',
    description: '强调时机与成交推进',
    tone_rules: {
      praise_first: false,
      criticism_intensity: 'high',
      address: '你',
      opener: '销冠标准复盘：',
    },
    debrief_template: {
      strengths_prefix: '时机抓对了：',
      improvements_prefix: '错失的推进点：',
      next_prefix: '下场专攻：',
    },
  },
  {
    persona_key: 'service_star',
    label: '五星服务教练',
    description: '强调体验与品牌表达',
    tone_rules: {
      praise_first: true,
      criticism_intensity: 'medium',
      address: '你',
      opener: '按五星服务标准看：',
    },
    debrief_template: {
      strengths_prefix: '体验加分：',
      improvements_prefix: '体验减分：',
      next_prefix: '下一场打磨：',
    },
  },
  {
    persona_key: 'hq_supervisor',
    label: '总部督导',
    description: '制度与标准口径',
    tone_rules: {
      praise_first: false,
      criticism_intensity: 'high',
      address: '你',
      opener: '督导复盘意见：',
    },
    debrief_template: {
      strengths_prefix: '符合标准：',
      improvements_prefix: '偏离标准：',
      next_prefix: '整改后再练：',
    },
  },
];

export async function ensureCoachPersonaSeed(pool) {
  for (const p of BUILTIN_COACH_PERSONAS) {
    await pool.query(
      `INSERT INTO job_coach_coach_personas
         (persona_key, label, description, tone_rules, debrief_template, active)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,TRUE)
       ON CONFLICT (persona_key) DO UPDATE SET
         label = EXCLUDED.label,
         description = EXCLUDED.description,
         tone_rules = EXCLUDED.tone_rules,
         debrief_template = EXCLUDED.debrief_template,
         active = TRUE`,
      [
        p.persona_key, p.label, p.description,
        JSON.stringify(p.tone_rules || {}),
        JSON.stringify(p.debrief_template || {}),
      ]
    );
  }
}

export async function getCoachPersona(pool, personaKey) {
  if (!personaKey) return null;
  const r = await pool.query(
    `SELECT * FROM job_coach_coach_personas WHERE persona_key=$1 AND active=TRUE`,
    [personaKey]
  );
  return r.rows?.[0] || null;
}

export async function listCoachPersonas(pool) {
  const r = await pool.query(
    `SELECT persona_key, label, description, tone_rules, debrief_template, active
       FROM job_coach_coach_personas
      WHERE active=TRUE
      ORDER BY persona_key`
  );
  return r.rows || [];
}

/** 用教练人格包装复盘文案（规则拼装，无 LLM） */
export function applyCoachPersonaToDebrief(debrief, coachPersona) {
  if (!debrief) return debrief;
  const tone = coachPersona?.tone_rules || {};
  const tmpl = coachPersona?.debrief_template || {};
  const opener = tone.opener || '本场复盘：';
  const strengthsPrefix = tmpl.strengths_prefix || '优点：';
  const improvementsPrefix = tmpl.improvements_prefix || '需要提升：';
  const nextPrefix = tmpl.next_prefix || '下一场推荐：';

  const strengthLines = (debrief.strengths || []).map((s) => `- ${s.detail || s.principle_label || ''}`);
  const improveLines = (debrief.improvements || []).map((v) => `- [${v.principle_label || v.principle_id}] ${v.detail || ''}`);

  let narrative = `${opener}\n本场评分：${debrief.score} 分（${debrief.score_grade || ''}）\n`;
  if (tone.praise_first !== false) {
    narrative += `\n${strengthsPrefix}\n${strengthLines.join('\n') || '- （暂无）'}\n`;
    narrative += `\n${improvementsPrefix}\n${improveLines.join('\n') || '- （暂无）'}\n`;
  } else {
    narrative += `\n${improvementsPrefix}\n${improveLines.join('\n') || '- （暂无）'}\n`;
    narrative += `\n${strengthsPrefix}\n${strengthLines.join('\n') || '- （暂无）'}\n`;
  }
  if (debrief.next_focus) {
    narrative += `\n${nextPrefix}${debrief.next_focus_label || debrief.next_focus}`;
  }

  return {
    ...debrief,
    coach_persona_key: coachPersona?.persona_key || null,
    coach_persona_label: coachPersona?.label || null,
    coach_narrative: narrative.trim(),
  };
}
