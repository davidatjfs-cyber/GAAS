/**
 * 销售域表 ensure + 基础 CRUD 辅助
 */
let ensurePromise = null;

export async function ensureSalesTables(pool) {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_leads (
        id BIGSERIAL PRIMARY KEY,
        lead_key TEXT NOT NULL UNIQUE,
        external_userid TEXT,
        open_kfid TEXT,
        name TEXT,
        company TEXT,
        phone TEXT,
        city TEXT,
        cuisine TEXT,
        store_count INT,
        pos_brand TEXT,
        phone_data_ready BOOLEAN,
        member_estimate INT,
        pain_points JSONB NOT NULL DEFAULT '[]'::jsonb,
        decision_role TEXT,
        source_channel TEXT DEFAULT 'wecom_kf',
        stage TEXT NOT NULL DEFAULT 'new',
        controller TEXT NOT NULL DEFAULT 'ai',
        intent_score INT NOT NULL DEFAULT 0,
        intent_level TEXT NOT NULL DEFAULT 'low',
        owner_username TEXT,
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
        budget_range TEXT,
        expected_close_date DATE,
        win_probability INT,
        last_message_at TIMESTAMPTZ,
        last_human_at TIMESTAMPTZ,
        last_reminder_at TIMESTAMPTZ,
        last_risk_check_at TIMESTAMPTZ,
        first_contact_at TIMESTAMPTZ,
        first_response_at TIMESTAMPTZ,
        demo_count INT NOT NULL DEFAULT 0,
        meeting_count INT NOT NULL DEFAULT 0,
        trial_status TEXT,
        lost_reason TEXT,
        competitor TEXT,
        notes TEXT,
        next_action TEXT,
        next_action_due TIMESTAMPTZ,
        tenant_id VARCHAR(80),
        growth_customer_id BIGINT,
        provision_status TEXT,
        provision_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_leads_stage ON sales_leads (stage, intent_score DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_leads_score ON sales_leads (intent_score DESC, updated_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_leads_external ON sales_leads (external_userid)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_leads_owner ON sales_leads (owner_username, updated_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_leads_reminder ON sales_leads (last_reminder_at NULLS LAST)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_conversations (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT REFERENCES sales_leads(id) ON DELETE CASCADE,
        open_kfid TEXT,
        external_userid TEXT,
        controller TEXT NOT NULL DEFAULT 'ai',
        status TEXT NOT NULL DEFAULT 'open',
        cursor TEXT,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_conv_ext_kf
        ON sales_conversations (open_kfid, external_userid)
        WHERE open_kfid IS NOT NULL AND external_userid IS NOT NULL`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL REFERENCES sales_conversations(id) ON DELETE CASCADE,
        lead_id BIGINT REFERENCES sales_leads(id) ON DELETE SET NULL,
        direction TEXT NOT NULL,
        sender TEXT NOT NULL,
        content TEXT NOT NULL,
        msg_id TEXT,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_msg_msgid ON sales_messages (msg_id) WHERE msg_id IS NOT NULL`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_lead_events (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        summary TEXT,
        evidence TEXT,
        confidence NUMERIC(4,3),
        priority TEXT DEFAULT 'normal',
        recommended_action TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_events_lead ON sales_lead_events (lead_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_events_type ON sales_lead_events (event_type, created_at DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_score_items (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        rule_key TEXT NOT NULL,
        points INT NOT NULL,
        evidence TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_score_lead ON sales_score_items (lead_id, id DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_tasks (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        detail TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        due_at TIMESTAMPTZ,
        assignee TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_tasks_open ON sales_tasks (status, due_at NULLS LAST)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_opportunities (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'proposal',
        amount INT,
        expected_close_date DATE,
        probability INT,
        priority TEXT DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'open',
        owner_username TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_opps_lead ON sales_opportunities (lead_id, stage)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_opps_stage ON sales_opportunities (stage, updated_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_demos (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        scheduled_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        attended_by TEXT,
        summary TEXT,
        key_points TEXT,
        objections JSONB NOT NULL DEFAULT '[]'::jsonb,
        next_steps TEXT,
        status TEXT NOT NULL DEFAULT 'scheduled',
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_demos_lead ON sales_demos (lead_id, scheduled_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_meetings (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        meeting_type TEXT NOT NULL,
        occurred_at TIMESTAMPTZ,
        raw_notes TEXT,
        summary TEXT,
        customer_needs JSONB NOT NULL DEFAULT '[]'::jsonb,
        customer_objections JSONB NOT NULL DEFAULT '[]'::jsonb,
        customer_commitments JSONB NOT NULL DEFAULT '[]'::jsonb,
        our_commitments JSONB NOT NULL DEFAULT '[]'::jsonb,
        decision_maker TEXT,
        budget TEXT,
        timeline TEXT,
        risks TEXT,
        next_steps TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_meetings_lead ON sales_meetings (lead_id, occurred_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_trials (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        stores TEXT,
        pos_brand TEXT,
        target_kpis JSONB NOT NULL DEFAULT '{}'::jsonb,
        result_summary TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        tenant_id VARCHAR(80),
        validation_status TEXT,
        validation_report JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_trials_lead ON sales_trials (lead_id, started_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_deals (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        opportunity_id BIGINT REFERENCES sales_opportunities(id) ON DELETE SET NULL,
        deal_date DATE,
        amount INT,
        store_count INT,
        contract_term TEXT,
        notes TEXT,
        tenant_id VARCHAR(80),
        provision_status TEXT DEFAULT 'pending',
        provision_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_deals_lead ON sales_deals (lead_id, deal_date DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_loss_reasons (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        reason_key TEXT NOT NULL,
        reason_label TEXT,
        detail TEXT,
        evidence TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_loss_reasons_lead ON sales_loss_reasons (lead_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_loss_reasons_key ON sales_loss_reasons (reason_key, created_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_objections (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        objection_key TEXT NOT NULL,
        objection_label TEXT,
        evidence TEXT,
        response_text TEXT,
        resolved BOOLEAN DEFAULT false,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_objections_lead ON sales_objections (lead_id, resolved, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_objections_key ON sales_objections (objection_key, created_at DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_ai_guidance (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        conversation_id BIGINT REFERENCES sales_conversations(id) ON DELETE CASCADE,
        guidance JSONB NOT NULL DEFAULT '{}'::jsonb,
        source TEXT NOT NULL DEFAULT 'sales_ai',
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TIMESTAMPTZ,
        consumed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_guidance_active ON sales_ai_guidance (lead_id, status, created_at DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_stage_history (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        from_stage TEXT,
        to_stage TEXT NOT NULL,
        reason TEXT,
        evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        actor TEXT NOT NULL DEFAULT 'sales_ai',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_stage_history_lead ON sales_stage_history (lead_id, created_at DESC)`);
    await pool.query(`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS intent_level TEXT NOT NULL DEFAULT 'low'`);
    await pool.query(`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS handoff_level TEXT NOT NULL DEFAULT 'low'`);
    await pool.query(`ALTER TABLE sales_leads ADD COLUMN IF NOT EXISTS last_sales_decision JSONB NOT NULL DEFAULT '{}'::jsonb`);
  })().catch((e) => {
    ensurePromise = null;
    throw e;
  });
  return ensurePromise;
}

export function newLeadKey(prefix = 'L') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export async function getLead(pool, id) {
  const r = await pool.query(`SELECT * FROM sales_leads WHERE id=$1 LIMIT 1`, [id]);
  return r.rows?.[0] || null;
}

export async function listLeads(pool, opts = {}) {
  await ensureSalesTables(pool);
  const stage = String(opts.stage || '').trim();
  const minScore = Number(opts.min_score || 0) || 0;
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const r = await pool.query(
    `SELECT * FROM sales_leads
      WHERE ($1::text = '' OR stage = $1)
        AND intent_score >= $2
      ORDER BY intent_score DESC, updated_at DESC
      LIMIT $3`,
    [stage, minScore, limit]
  );
  return r.rows || [];
}

export async function addEvent(pool, leadId, event) {
  await pool.query(
    `INSERT INTO sales_lead_events
      (lead_id, event_type, summary, evidence, confidence, priority, recommended_action, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      leadId,
      event.event_type,
      event.summary || null,
      event.evidence || null,
      event.confidence ?? null,
      event.priority || 'normal',
      event.recommended_action || null,
      JSON.stringify(event.payload || {}),
    ]
  );
}

export async function saveSalesGuidance(pool, { leadId, conversationId, guidance, expiresInTurns = 1 }) {
  const r = await pool.query(
    `INSERT INTO sales_ai_guidance (lead_id, conversation_id, guidance, expires_at)
     VALUES ($1,$2,$3::jsonb,NOW() + ($4::text || ' minutes')::interval) RETURNING *`,
    [leadId, conversationId || null, JSON.stringify(guidance || {}), Math.max(5, Number(expiresInTurns || 1) * 15)]
  );
  return r.rows?.[0] || null;
}

export async function getActiveSalesGuidance(pool, leadId) {
  const r = await pool.query(
    `SELECT * FROM sales_ai_guidance WHERE lead_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY id DESC LIMIT 1`,
    [leadId]
  );
  return r.rows?.[0] || null;
}

export async function recordStageChange(pool, { leadId, fromStage, toStage, reason, evidence, actor = 'sales_ai' }) {
  if (!toStage || fromStage === toStage) return null;
  const r = await pool.query(
    `INSERT INTO sales_stage_history (lead_id, from_stage, to_stage, reason, evidence, actor)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
    [leadId, fromStage || null, toStage, reason || null, JSON.stringify(evidence || {}), actor]
  );
  return r.rows?.[0] || null;
}

export async function addMessage(pool, { conversationId, leadId, direction, sender, content, msgId, meta }) {
  if (msgId) {
    const exists = await pool.query(`SELECT id FROM sales_messages WHERE msg_id=$1 LIMIT 1`, [msgId]);
    if (exists.rows?.length) return exists.rows[0];
  }
  const r = await pool.query(
    `INSERT INTO sales_messages (conversation_id, lead_id, direction, sender, content, msg_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING *`,
    [conversationId, leadId || null, direction, sender, content, msgId || null, JSON.stringify(meta || {})]
  );
  return r.rows?.[0] || null;
}

export async function listMessages(pool, conversationId, limit = 40) {
  const r = await pool.query(
    `SELECT * FROM sales_messages WHERE conversation_id=$1 ORDER BY id ASC LIMIT $2`,
    [conversationId, limit]
  );
  return r.rows || [];
}

export async function loadLeadFunnel(pool, leadId) {
  await ensureSalesTables(pool);
  const [opps, demos, meetings, trials, deals, lossReasons, objections, tasks] = await Promise.all([
    pool.query(`SELECT * FROM sales_opportunities WHERE lead_id=$1 ORDER BY id DESC`, [leadId]),
    pool.query(`SELECT * FROM sales_demos WHERE lead_id=$1 ORDER BY scheduled_at DESC`, [leadId]),
    pool.query(`SELECT * FROM sales_meetings WHERE lead_id=$1 ORDER BY occurred_at DESC`, [leadId]),
    pool.query(`SELECT * FROM sales_trials WHERE lead_id=$1 ORDER BY started_at DESC`, [leadId]),
    pool.query(`SELECT * FROM sales_deals WHERE lead_id=$1 ORDER BY deal_date DESC`, [leadId]),
    pool.query(`SELECT * FROM sales_loss_reasons WHERE lead_id=$1 ORDER BY created_at DESC`, [leadId]),
    pool.query(`SELECT * FROM sales_objections WHERE lead_id=$1 ORDER BY created_at DESC`, [leadId]),
    pool.query(`SELECT * FROM sales_tasks WHERE lead_id=$1 ORDER BY due_at NULLS LAST, id DESC`, [leadId]),
  ]);
  return {
    opportunities: opps.rows || [],
    demos: demos.rows || [],
    meetings: meetings.rows || [],
    trials: trials.rows || [],
    deals: deals.rows || [],
    loss_reasons: lossReasons.rows || [],
    objections: objections.rows || [],
    tasks: tasks.rows || [],
  };
}

export async function upsertTask(pool, { leadId, title, detail, dueAt, assignee }) {
  const exist = await pool.query(
    `SELECT id FROM sales_tasks WHERE lead_id=$1 AND status='open' AND title=$2 LIMIT 1`,
    [leadId, title]
  );
  if (exist.rows?.length) return exist.rows[0];
  const r = await pool.query(
    `INSERT INTO sales_tasks (lead_id, title, detail, due_at, assignee)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [leadId, title, detail || null, dueAt || null, assignee || null]
  );
  return r.rows?.[0] || null;
}

export async function completeTask(pool, taskId) {
  await pool.query(`UPDATE sales_tasks SET status='done', updated_at=NOW() WHERE id=$1`, [taskId]);
}

export async function createDemo(pool, { leadId, scheduledAt, attendedBy, summary, keyPoints, objections, nextSteps, createdBy, markCompleted = false }) {
  const r = await pool.query(
    `INSERT INTO sales_demos (lead_id, scheduled_at, attended_by, summary, key_points, objections, next_steps, created_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [leadId, scheduledAt || null, attendedBy || null, summary || null, keyPoints || null, JSON.stringify(objections || []), nextSteps || null, createdBy || null, markCompleted || summary ? 'completed' : 'scheduled']
  );
  await pool.query(
    `UPDATE sales_leads
        SET demo_count = demo_count + 1,
            stage = CASE WHEN $2::boolean OR stage IN ('new','ai_greeting','need_identified','qualified','sales_takeover') THEN 'demo_completed' ELSE stage END,
            updated_at=NOW()
      WHERE id=$1`,
    [leadId, !!(markCompleted || summary)]
  );
  return r.rows?.[0] || null;
}

export async function createMeeting(pool, { leadId, meetingType, occurredAt, rawNotes, createdBy }) {
  const r = await pool.query(
    `INSERT INTO sales_meetings (lead_id, meeting_type, occurred_at, raw_notes, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [leadId, meetingType, occurredAt || null, rawNotes || null, createdBy || null]
  );
  await pool.query(
    `UPDATE sales_leads
        SET meeting_count = meeting_count + 1,
            stage = CASE WHEN stage IN ('new','ai_greeting','need_identified','qualified','sales_takeover') THEN 'sales_takeover' ELSE stage END,
            updated_at=NOW()
      WHERE id=$1`,
    [leadId]
  );
  return r.rows?.[0] || null;
}

export async function createTrial(pool, { leadId, startedAt, endedAt, stores, posBrand, targetKpis, createdBy, tenantId }) {
  const r = await pool.query(
    `INSERT INTO sales_trials (lead_id, started_at, ended_at, stores, pos_brand, target_kpis, created_by, status, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'in_progress',$8) RETURNING *`,
    [leadId, startedAt || new Date().toISOString(), endedAt || null, stores || null, posBrand || null, JSON.stringify(targetKpis || {}), createdBy || null, tenantId || null]
  );
  await pool.query(
    `UPDATE sales_leads
        SET trial_status='in_progress', stage='trial', tenant_id=COALESCE($2, tenant_id), updated_at=NOW()
      WHERE id=$1`,
    [leadId, tenantId || null]
  );
  return r.rows?.[0] || null;
}

export async function createDeal(pool, { leadId, opportunityId, dealDate, amount, storeCount, contractTerm, notes, createdBy, tenantId }) {
  const r = await pool.query(
    `INSERT INTO sales_deals (lead_id, opportunity_id, deal_date, amount, store_count, contract_term, notes, created_by, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [leadId, opportunityId || null, dealDate || null, amount || null, storeCount || null, contractTerm || null, notes || null, createdBy || null, tenantId || null]
  );
  await pool.query(
    `UPDATE sales_leads SET stage='won', trial_status='completed', updated_at=NOW() WHERE id=$1`,
    [leadId]
  );
  await pool.query(
    `UPDATE sales_opportunities SET stage='won', status='closed_won', updated_at=NOW() WHERE lead_id=$1 AND status='open'`,
    [leadId]
  );
  return r.rows?.[0] || null;
}

export async function recordObjection(pool, { leadId, objectionKey, objectionLabel, evidence, responseText, createdBy }) {
  const r = await pool.query(
    `INSERT INTO sales_objections (lead_id, objection_key, objection_label, evidence, response_text, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [leadId, objectionKey, objectionLabel || null, evidence || null, responseText || null, createdBy || null]
  );
  return r.rows?.[0] || null;
}

export async function recordLossReason(pool, { leadId, reasonKey, reasonLabel, detail, evidence, createdBy }) {
  const r = await pool.query(
    `INSERT INTO sales_loss_reasons (lead_id, reason_key, reason_label, detail, evidence, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [leadId, reasonKey, reasonLabel || null, detail || null, evidence || null, createdBy || null]
  );
  await pool.query(`UPDATE sales_leads SET stage='lost', lost_reason=$2, updated_at=NOW() WHERE id=$1`, [leadId, reasonKey]);
  return r.rows?.[0] || null;
}

export async function listObjectionsForKey(pool, objectionKey, limit = 20) {
  const r = await pool.query(
    `SELECT objection_key, objection_label, evidence, response_text, resolved, created_at
     FROM sales_objections
     WHERE objection_key=$1
     ORDER BY resolved DESC, created_at DESC
     LIMIT $2`,
    [objectionKey, limit]
  );
  return r.rows || [];
}

export async function listLossReasonStats(pool, limit = 20) {
  const r = await pool.query(
    `SELECT reason_key, reason_label, COUNT(*) as cnt
     FROM sales_loss_reasons
     GROUP BY reason_key, reason_label
     ORDER BY cnt DESC
     LIMIT $1`,
    [limit]
  );
  return r.rows || [];
}

export async function addOpportunity(pool, { leadId, title, stage, amount, expectedCloseDate, probability, ownerUsername }) {
  const r = await pool.query(
    `INSERT INTO sales_opportunities (lead_id, title, stage, amount, expected_close_date, probability, owner_username)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [leadId, title || '销售机会', stage || 'proposal', amount || null, expectedCloseDate || null, probability || null, ownerUsername || null]
  );
  return r.rows?.[0] || null;
}

export async function updateOpportunityStage(pool, opportunityId, { stage, status, probability, amount }) {
  await pool.query(
    `UPDATE sales_opportunities SET stage=COALESCE($2, stage), status=COALESCE($3, status), probability=COALESCE($4, probability), amount=COALESCE($5, amount), updated_at=NOW() WHERE id=$1`,
    [opportunityId, stage || null, status || null, probability !== undefined ? probability : null, amount !== undefined ? amount : null]
  );
}
