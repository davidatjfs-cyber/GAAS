/**
 * Phase3：真实案例 → 陪练场景草稿（规则生成，可选 LLM 润色标题）
 */

export async function createCaseSource(pool, {
  tenantId = null,
  sourceType,
  sourceRef = null,
  title = '',
  rawText = '',
  suggestedProfileKey = null,
  meta = {},
}) {
  const text = String(rawText || '').trim();
  if (!text && !title) return { ok: false, error: 'empty_case' };
  const inferred = inferProfileAndScenario(text || title, suggestedProfileKey);
  const r = await pool.query(
    `INSERT INTO talent_case_sources
       (tenant_id, source_type, source_ref, title, raw_text,
        suggested_profile_key, suggested_scenario_key, status, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8::jsonb)
     RETURNING *`,
    [
      tenantId,
      String(sourceType || 'manual'),
      sourceRef,
      title || inferred.title,
      text,
      inferred.profileKey,
      inferred.scenarioKey,
      JSON.stringify({ ...meta, opening_line: inferred.openingLine }),
    ]
  );
  return { ok: true, case: r.rows[0], inferred };
}

/** 从案例草稿生成临时人格（写入 sales_sim_personas） */
export async function materializeCaseAsPersona(pool, caseId, { username = 'system' } = {}) {
  const r = await pool.query(`SELECT * FROM talent_case_sources WHERE id=$1`, [caseId]);
  const row = r.rows?.[0];
  if (!row) return { ok: false, error: 'not_found' };

  const profileKey = row.suggested_profile_key || 'foh_server';
  const personaKey = `case_${row.id}_${Date.now().toString(36)}`;
  const opening = row.meta?.opening_line
    || String(row.raw_text || '').slice(0, 80)
    || '请按真实客诉场景开始处理。';
  const title = row.title || `真实案例 #${row.id}`;

  await pool.query(
    `INSERT INTO sales_sim_personas
       (persona_key, track, title, difficulty, profile, opening_line, audience, source_type, tenant_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,'tenant','case',$7)
     ON CONFLICT (persona_key) DO UPDATE SET
       title=EXCLUDED.title, opening_line=EXCLUDED.opening_line, profile=EXCLUDED.profile, active=TRUE`,
    [
      personaKey, profileKey, title, 4,
      JSON.stringify({
        case_id: row.id,
        source_type: row.source_type,
        source_ref: row.source_ref,
        scenario_key: row.suggested_scenario_key,
        created_by: username,
      }),
      opening,
      row.tenant_id || null,
    ]
  );

  await pool.query(
    `UPDATE talent_case_sources SET status='materialized',
       meta = COALESCE(meta,'{}'::jsonb) || $2::jsonb
     WHERE id=$1`,
    [caseId, JSON.stringify({ persona_key: personaKey })]
  );

  return { ok: true, persona_key: personaKey, job_profile_key: profileKey, opening_line: opening };
}

export function inferProfileAndScenario(text, suggestedProfileKey = null) {
  const t = String(text || '');
  let profileKey = suggestedProfileKey || 'foh_server';
  let scenarioKey = 'foh_rush';
  let title = '真实客诉训练';
  let openingLine = t.slice(0, 100) || '请处理这位客人的问题。';

  if (/店长|升级|神秘|巡店|排班|总部/.test(t)) {
    profileKey = suggestedProfileKey || 'store_manager';
    scenarioKey = /排班/.test(t) ? 'mgr_staff' : (/巡店|神秘/.test(t) ? 'mgr_mystery' : 'mgr_complaint');
    title = '店长真实案例';
  } else if (/后厨|出餐|厨房|做错/.test(t)) {
    profileKey = suggestedProfileKey || 'kitchen_staff';
    scenarioKey = 'kit_rush';
    title = '后厨真实案例';
  } else if (/催菜|上错|上菜慢|会员|堂食客/.test(t) || (/投诉/.test(t) && !/验券|收银/.test(t))) {
    profileKey = suggestedProfileKey || 'foh_server';
    scenarioKey = /上错/.test(t) ? 'foh_wrong_dish' : (/会员/.test(t) ? 'foh_member' : 'foh_rush');
    title = '前厅真实案例';
  } else if (/退款|验券|团购|收银|排队/.test(t)) {
    profileKey = suggestedProfileKey || 'cashier';
    scenarioKey = /排队/.test(t) ? 'cash_queue' : 'cash_refund';
    title = '收银真实案例';
  }

  return { profileKey, scenarioKey, title, openingLine };
}
