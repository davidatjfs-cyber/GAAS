/**
 * Talent Engine — Job Profile + Competency（含 version）
 */

import { SALES_SKILLS, CS_SKILLS } from './principles.js';
import { STORE_COMPETENCY_SEEDS } from './store-tracks.js';

export const BUILTIN_PROFILES = [
  {
    profile_key: 'sales',
    label: '销售',
    description: 'B2B 销售陪练轨',
    role_matchers: ['sales', 'sales_manager'],
    position_matchers: ['销售'],
    default_coach_persona_key: 'sales_champion',
    sort_order: 10,
  },
  {
    profile_key: 'cs',
    label: '客服',
    description: '客户成功 / 客服陪练轨',
    role_matchers: ['customer_service', 'implementation'],
    position_matchers: ['客服'],
    default_coach_persona_key: 'encouraging',
    sort_order: 20,
  },
  {
    profile_key: 'foh_server',
    label: '服务员',
    description: '门店前厅服务员情景陪练',
    role_matchers: ['store_employee'],
    position_matchers: ['服务员', '传菜员', '迎宾'],
    default_coach_persona_key: 'service_star',
    sort_order: 30,
  },
  {
    profile_key: 'cashier',
    label: '收银员',
    description: '门店收银情景陪练',
    role_matchers: ['cashier'],
    position_matchers: ['收银', '收银员'],
    default_coach_persona_key: 'encouraging',
    sort_order: 40,
  },
  {
    profile_key: 'store_manager',
    label: '店长',
    description: '门店店长情景陪练',
    role_matchers: ['store_manager'],
    position_matchers: ['店长'],
    default_coach_persona_key: 'hq_supervisor',
    sort_order: 50,
  },
  {
    profile_key: 'kitchen_staff',
    label: '厨房员工',
    description: '后厨协同与异常处置陪练',
    role_matchers: ['store_production_manager'],
    position_matchers: ['厨师', '厨工', '配菜', '厨师长'],
    default_coach_persona_key: 'strict',
    sort_order: 60,
  },
  {
    profile_key: 'hq_ops',
    label: '总部运营',
    description: '总部运营情景应答',
    role_matchers: ['hq_manager', 'admin'],
    position_matchers: ['运营', '总部'],
    default_coach_persona_key: 'hq_supervisor',
    sort_order: 70,
  },
];

const SALES_COMP_META = {
  questioning: { label: '提问能力', ability_key: 'questioning', sort_order: 10 },
  listening: { label: '倾听能力', ability_key: 'listening', sort_order: 20 },
  value: { label: '价值表达', ability_key: 'value', sort_order: 30 },
  closing: { label: '成交推进', ability_key: 'closing', sort_order: 40 },
};

const CS_COMP_META = {
  empathy: { label: '情绪安抚', ability_key: 'empathy', sort_order: 10 },
  diagnosis: { label: '问题定位', ability_key: 'diagnosis', sort_order: 20 },
  resolution: { label: '解决闭环', ability_key: 'resolution', sort_order: 30 },
  retention: { label: '关系维护', ability_key: 'retention', sort_order: 40 },
};

export async function ensureProfileSeed(pool) {
  for (const p of BUILTIN_PROFILES) {
    await pool.query(
      `INSERT INTO job_coach_profiles
         (profile_key, label, description, role_matchers, position_matchers,
          default_coach_persona_key, active, sort_order)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)
       ON CONFLICT (profile_key) DO UPDATE SET
         label = EXCLUDED.label,
         description = EXCLUDED.description,
         role_matchers = EXCLUDED.role_matchers,
         position_matchers = EXCLUDED.position_matchers,
         default_coach_persona_key = EXCLUDED.default_coach_persona_key,
         active = EXCLUDED.active,
         sort_order = EXCLUDED.sort_order`,
      [
        p.profile_key, p.label, p.description,
        JSON.stringify(p.role_matchers || []),
        JSON.stringify(p.position_matchers || []),
        p.default_coach_persona_key || null,
        p.active !== false,
        p.sort_order ?? 100,
      ]
    );
  }
}

export async function ensureCompetencySeed(pool) {
  await seedCompetenciesForProfile(pool, 'sales', SALES_SKILLS, SALES_COMP_META);
  await seedCompetenciesForProfile(pool, 'cs', CS_SKILLS, CS_COMP_META);
  for (const [profileKey, rows] of Object.entries(STORE_COMPETENCY_SEEDS)) {
    const metaMap = Object.fromEntries(rows.map((r) => [r.key, r]));
    await seedCompetenciesForProfile(pool, profileKey, rows.map((r) => r.key), metaMap);
  }
}

async function seedCompetenciesForProfile(pool, profileKey, keys, metaMap) {
  for (const key of keys) {
    const meta = metaMap[key];
    if (!meta) continue;
    await pool.query(
      `INSERT INTO job_coach_competencies
         (job_profile_key, competency_key, ability_key, label, weight, version,
          recommended_topic_ids, recommended_kb_ids, sort_order, active)
       VALUES ($1,$2,$3,$4,1.0,1,'[]'::jsonb,'[]'::jsonb,$5,TRUE)
       ON CONFLICT (job_profile_key, competency_key, version) DO UPDATE SET
         ability_key = EXCLUDED.ability_key,
         label = EXCLUDED.label,
         sort_order = EXCLUDED.sort_order,
         active = TRUE,
         retired_at = NULL`,
      [profileKey, key, meta.ability_key, meta.label, meta.sort_order]
    );
  }
}

/** 当前生效的能力项（未退休、effective_at 已到，取每 key 最高 version） */
export async function listActiveCompetencies(pool, jobProfileKey) {
  const r = await pool.query(
    `SELECT DISTINCT ON (competency_key)
            id, job_profile_key, competency_key, ability_key, label, weight,
            pass_score, version, effective_at, retired_at,
            recommended_topic_ids, recommended_kb_ids, kpi_metric_key, sort_order
       FROM job_coach_competencies
      WHERE job_profile_key = $1
        AND active = TRUE
        AND (retired_at IS NULL OR retired_at > NOW())
        AND effective_at <= NOW()
      ORDER BY competency_key, version DESC`,
    [jobProfileKey]
  );
  return (r.rows || []).sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
}

export function buildCompetencySnapshot(rows = []) {
  return rows.map((c) => ({
    competency_key: c.competency_key,
    ability_key: c.ability_key,
    label: c.label,
    weight: Number(c.weight || 1),
    version: Number(c.version || 1),
    pass_score: Number(c.pass_score || 75),
  }));
}

export async function getProfile(pool, profileKey) {
  const r = await pool.query(
    `SELECT * FROM job_coach_profiles WHERE profile_key=$1`,
    [profileKey]
  );
  return r.rows?.[0] || null;
}

export async function listProfiles(pool, { activeOnly = true } = {}) {
  const r = await pool.query(
    `SELECT * FROM job_coach_profiles
      WHERE ($1::boolean IS FALSE OR active = TRUE)
      ORDER BY sort_order, profile_key`,
    [activeOnly]
  );
  return r.rows || [];
}

/** track 与 job_profile_key 在 P0 对齐；后续门店轨可直接用 profile_key */
export function trackToProfileKey(track) {
  return String(track || '').trim() || null;
}
