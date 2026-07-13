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
        last_message_at TIMESTAMPTZ,
        last_human_at TIMESTAMPTZ,
        next_action TEXT,
        next_action_due TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_leads_stage ON sales_leads (stage, intent_score DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sales_leads_score ON sales_leads (intent_score DESC, updated_at DESC)`);
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales_score_items (
        id BIGSERIAL PRIMARY KEY,
        lead_id BIGINT NOT NULL REFERENCES sales_leads(id) ON DELETE CASCADE,
        rule_key TEXT NOT NULL,
        points INT NOT NULL,
        evidence TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
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
