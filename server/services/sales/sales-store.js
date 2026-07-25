/**
 * 销售域表 ensure + 基础 CRUD 辅助
 */
import { canTransition } from './sales-collaboration-service.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales', handler: 'store' });

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
    // 历史数据里如果已经存在重复 external_userid（本次修复前的竞态遗留），建唯一索引会报错——
    // 那样会导致 ensureSalesTables 整体失败、销售AI全线不可用，所以这一条单独兜底不让它拖垮启动，
    // 只是这种情况下去重保护要等 migration 里先清理重复数据才能补上（见 migration 说明）。
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_leads_external_uid ON sales_leads (external_userid) WHERE external_userid IS NOT NULL`)
      .catch((e) => log.warn({ msg: 'idx_sales_leads_external_uid_skipped', err: e?.message || String(e) }));
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
    // 同样道理：如果之前的竞态已经产生了重复的(lead_id,title,status='open')行，建唯一索引会报错，
    // 单独兜底避免拖垮 ensureSalesTables；重复数据清理见 migration。
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tasks_dedup_open ON sales_tasks (lead_id, title) WHERE status='open'`)
      .catch((e) => log.warn({ msg: 'idx_sales_tasks_dedup_open_skipped', err: e?.message || String(e) }));

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

/**
 * scopeClause/scopeParams 由调用方传入(见 sales-permissions.js 的 leadScopeSql)，manager角色
 * 传 {clause:'TRUE', params:[]} 即不过滤；普通sales/customer_service必须传真实的归属过滤条件，
 * 不能在这里默认放行——之前的版本完全不做归属过滤，任何登录角色都能看到全部线索。
 */
export async function listLeads(pool, opts = {}, scope = { clause: 'TRUE', params: [] }) {
  await ensureSalesTables(pool);
  const stage = String(opts.stage || '').trim();
  const minScore = Number(opts.min_score || 0) || 0;
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const scopeParams = scope.params || [];
  const r = await pool.query(
    `SELECT * FROM sales_leads
      WHERE ($1::text = '' OR stage = $1)
        AND intent_score >= $2
        AND (${scope.clause})
      ORDER BY intent_score DESC, updated_at DESC
      LIMIT $3`,
    [stage, minScore, limit, ...scopeParams]
  );
  return r.rows || [];
}

export async function addEvent(pool, leadId, event) {
  await pool.query(
    `INSERT INTO sales_lead_events
      (lead_id, event_type, summary, evidence, confidence, priority, recommended_action, payload, actor_type, actor_id, source_type, source_id, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,
    [
      leadId,
      event.event_type,
      event.summary || null,
      event.evidence || null,
      event.confidence ?? null,
      event.priority || 'normal',
      event.recommended_action || null,
      JSON.stringify(event.payload || {}),
      event.actor_type || null, event.actor_id || null, event.source_type || null, event.source_id || null, event.correlation_id || null,
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

/**
 * 统一阶段写入入口：加行锁读当前stage → canTransition校验 → 写stage → 写sales_stage_history
 * → 写sales_lead_events，全部在同一事务里。非法转换直接拒绝，不再允许各业务函数各写各的。
 * toStage===当前stage时视为幂等操作，不重复写审计记录，直接返回changed:false。
 */
export async function transitionLeadStage(pool, {
  leadId, toStage, actorType = 'system', actorId = 'sales_ops', reason, sourceType, sourceId, metadata,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT stage FROM sales_leads WHERE id=$1 FOR UPDATE`, [leadId]);
    if (!cur.rows?.[0]) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'lead_not_found' };
    }
    const fromStage = cur.rows[0].stage;
    if (fromStage === toStage) {
      await client.query('COMMIT');
      return { ok: true, changed: false, from_stage: fromStage, to_stage: toStage };
    }
    if (!canTransition(fromStage, toStage)) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'illegal_transition', from_stage: fromStage, to_stage: toStage };
    }
    await client.query(`UPDATE sales_leads SET stage=$2, updated_at=NOW() WHERE id=$1`, [leadId, toStage]);
    await client.query(
      `INSERT INTO sales_stage_history (lead_id, from_stage, to_stage, reason, evidence, actor)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [leadId, fromStage, toStage, reason || null, JSON.stringify({ source_type: sourceType || null, source_id: sourceId || null, ...(metadata || {}) }), actorId]
    );
    await client.query(
      `INSERT INTO sales_lead_events (lead_id, event_type, summary, priority, recommended_action, payload)
       VALUES ($1,'STAGE_CHANGED',$2,'normal','none',$3::jsonb)`,
      [leadId, `${fromStage || '(new)'} → ${toStage}`, JSON.stringify({ actor_type: actorType, actor_id: actorId, source_type: sourceType || null, source_id: sourceId || null, reason: reason || null })]
    );
    await client.query('COMMIT');
    return { ok: true, changed: true, from_stage: fromStage, to_stage: toStage };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => null);
    throw e;
  } finally {
    client.release();
  }
}

/**
 * inserted=false 表示这条 msg_id 之前已经处理过——调用方(尤其 handleInboundMessage)必须
 * 在拿到 inserted=false 时立即返回，不能继续跑评分/LLM回复/通知等副作用，否则企微重推同一条
 * 消息会导致客户收到重复回复、销售收到重复通知。
 */
export async function addMessage(pool, { conversationId, leadId, direction, sender, content, msgId, meta }) {
  if (msgId) {
    // 原子 upsert：靠 idx_sales_msg_msgid 这个真正的唯一索引兜底并发重复请求，
    // 不再是"先SELECT再INSERT"——两个并发请求带同一个msgId，只有一个能插入成功。
    const r = await pool.query(
      `INSERT INTO sales_messages (conversation_id, lead_id, direction, sender, content, msg_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (msg_id) WHERE msg_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [conversationId, leadId || null, direction, sender, content, msgId, JSON.stringify(meta || {})]
    );
    if (r.rows?.[0]) return { ...r.rows[0], inserted: true };
    const exist = await pool.query(`SELECT * FROM sales_messages WHERE msg_id=$1 LIMIT 1`, [msgId]);
    return { ...(exist.rows?.[0] || {}), inserted: false };
  }
  const r = await pool.query(
    `INSERT INTO sales_messages (conversation_id, lead_id, direction, sender, content, msg_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     RETURNING *`,
    [conversationId, leadId || null, direction, sender, content, null, JSON.stringify(meta || {})]
  );
  return { ...(r.rows?.[0] || {}), inserted: true };
}

export async function listMessages(pool, conversationId, limit = 40) {
  const r = await pool.query(
    `SELECT * FROM (
       SELECT * FROM sales_messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT $2
     ) recent_messages
     ORDER BY id ASC`,
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

/**
 * 原子去重：靠 idx_sales_tasks_dedup_open 这个部分唯一索引兜底，不再是"先SELECT再INSERT"
 * 的竞态写法——并发cron/请求同时命中同一个(lead_id,title,status='open')时，数据库本身
 * 保证只留一行，ON CONFLICT DO NOTHING 后如果没插进去就查回已存在的那条。
 */
/**
 * dedupKey 是首选去重手段——传入时用 idx_sales_tasks_dedup_key 这个真正的唯一索引原子去重
 * (nurture:{lead_id}:{step} / renewal-risk:{tenant_id}:{type}:{period} 这类稳定业务键，不随
 * cron反复生成而变化，也不随任务被完成后重开而失效检测)。不传 dedupKey 的老调用方(比如后台
 * 手动创建任务)退回 (lead_id,title,status='open') 这层兜底，行为不变。
 */
export async function upsertTask(pool, {
  leadId, title, detail, dueAt, assignee, dedupKey = null,
  taskDomain = 'sales', taskType = null, tenantId = null, sourceType = null, sourceId = null, createdBy = null,
}) {
  const cols = `lead_id, title, detail, due_at, assignee, dedup_key, task_domain, task_type, tenant_id, source_type, source_id, created_by`;
  const vals = [leadId, title, detail || null, dueAt || null, assignee || null, dedupKey, taskDomain, taskType, tenantId, sourceType, sourceId, createdBy];
  const conflictClause = dedupKey
    ? `ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`
    : `ON CONFLICT (lead_id, title) WHERE status='open' DO NOTHING`;
  try {
    const r = await pool.query(
      `INSERT INTO sales_tasks (${cols}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ${conflictClause} RETURNING *`,
      vals
    );
    if (r.rows?.[0]) return r.rows[0];
  } catch (e) {
    // 兜底索引可能因历史重复数据未清理而尚未建成(见 ensureSalesTables/migration说明)，
    // 这种过渡期里退回旧的SELECT-then-INSERT写法，至少保证功能不中断，去重保护降级但不消失。
    // 同时存在 dedup_key 和 (lead_id,title,status=open) 两个唯一索引时，并发插入也可能先撞到
    // 另一个索引；23505 同样应当回查已存在行，而不是把幂等请求当成业务失败。
    if (e?.code !== '23505' && !/no unique or exclusion constraint/i.test(e?.message || '')) throw e;
  }
  const exist = dedupKey
    ? await pool.query(`SELECT * FROM sales_tasks WHERE dedup_key=$1 LIMIT 1`, [dedupKey])
    : await pool.query(`SELECT * FROM sales_tasks WHERE lead_id=$1 AND status='open' AND title=$2 LIMIT 1`, [leadId, title]);
  if (exist.rows?.[0]) return exist.rows[0];
  const r = await pool.query(
    `INSERT INTO sales_tasks (${cols}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    vals
  );
  return r.rows?.[0] || null;
}

export async function completeTask(pool, taskId, { completionResult = null } = {}) {
  await pool.query(
    `UPDATE sales_tasks SET status='done', completed_at=NOW(), completion_result=COALESCE($2, completion_result), updated_at=NOW() WHERE id=$1`,
    [taskId, completionResult]
  );
}

export async function createDemo(pool, { leadId, scheduledAt, attendedBy, summary, keyPoints, objections, nextSteps, createdBy, markCompleted = false }) {
  const r = await pool.query(
    `INSERT INTO sales_demos (lead_id, scheduled_at, attended_by, summary, key_points, objections, next_steps, created_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [leadId, scheduledAt || null, attendedBy || null, summary || null, keyPoints || null, JSON.stringify(objections || []), nextSteps || null, createdBy || null, markCompleted || summary ? 'completed' : 'scheduled']
  );
  await pool.query(`UPDATE sales_leads SET demo_count = demo_count + 1, updated_at=NOW() WHERE id=$1`, [leadId]);
  if (markCompleted || summary) {
    await transitionLeadStage(pool, { leadId, toStage: 'demo_completed', actorType: 'human', actorId: createdBy || 'sales_ops', reason: 'createDemo', sourceType: 'sales_demo', sourceId: String(r.rows?.[0]?.id || '') });
  }
  return r.rows?.[0] || null;
}

export async function createMeeting(pool, { leadId, meetingType, occurredAt, rawNotes, createdBy }) {
  const r = await pool.query(
    `INSERT INTO sales_meetings (lead_id, meeting_type, occurred_at, raw_notes, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [leadId, meetingType, occurredAt || null, rawNotes || null, createdBy || null]
  );
  await pool.query(`UPDATE sales_leads SET meeting_count = meeting_count + 1, updated_at=NOW() WHERE id=$1`, [leadId]);
  await transitionLeadStage(pool, { leadId, toStage: 'sales_takeover', actorType: 'human', actorId: createdBy || 'sales_ops', reason: 'createMeeting', sourceType: 'sales_meeting', sourceId: String(r.rows?.[0]?.id || '') });
  return r.rows?.[0] || null;
}

export async function createTrial(pool, { leadId, startedAt, endedAt, stores, posBrand, targetKpis, createdBy, tenantId }) {
  const r = await pool.query(
    `INSERT INTO sales_trials (lead_id, started_at, ended_at, stores, pos_brand, target_kpis, created_by, status, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'in_progress',$8) RETURNING *`,
    [leadId, startedAt || new Date().toISOString(), endedAt || null, stores || null, posBrand || null, JSON.stringify(targetKpis || {}), createdBy || null, tenantId || null]
  );
  await pool.query(`UPDATE sales_leads SET trial_status='in_progress', tenant_id=COALESCE($2, tenant_id), updated_at=NOW() WHERE id=$1`, [leadId, tenantId || null]);
  await transitionLeadStage(pool, { leadId, toStage: 'trial', actorType: 'human', actorId: createdBy || 'sales_ops', reason: 'createTrial', sourceType: 'sales_trial', sourceId: String(r.rows?.[0]?.id || '') });
  return r.rows?.[0] || null;
}

export async function createDeal(pool, { leadId, opportunityId, dealDate, amount, storeCount, contractTerm, notes, createdBy, tenantId }) {
  const r = await pool.query(
    `INSERT INTO sales_deals (lead_id, opportunity_id, deal_date, amount, store_count, contract_term, notes, created_by, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [leadId, opportunityId || null, dealDate || null, amount || null, storeCount || null, contractTerm || null, notes || null, createdBy || null, tenantId || null]
  );
  await pool.query(`UPDATE sales_leads SET trial_status='completed', updated_at=NOW() WHERE id=$1`, [leadId]);
  await transitionLeadStage(pool, { leadId, toStage: 'won', actorType: 'human', actorId: createdBy || 'sales_ops', reason: 'createDeal', sourceType: 'sales_deal', sourceId: String(r.rows?.[0]?.id || '') });
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

export async function recordLossReason(pool, { leadId, reasonKey, reasonLabel, detail, evidence, competitor, budgetStatus, currentSystem, recontactAt, enterNurture, createdBy }) {
  const r = await pool.query(
    `INSERT INTO sales_loss_reasons (lead_id, reason_key, reason_label, detail, evidence, competitor, budget_status, current_system, recontact_at, enter_nurture, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [leadId, reasonKey, reasonLabel || null, detail || null, evidence || null, competitor || null, budgetStatus || null, currentSystem || null, recontactAt || null, !!enterNurture, createdBy || null]
  );
  await pool.query(`UPDATE sales_leads SET lost_reason=$2, updated_at=NOW() WHERE id=$1`, [leadId, reasonKey]);
  await transitionLeadStage(pool, { leadId, toStage: 'lost', actorType: 'human', actorId: createdBy || 'sales_ops', reason: `recordLossReason:${reasonKey}`, sourceType: 'sales_loss_reason', sourceId: String(r.rows?.[0]?.id || '') });
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

/**
 * 按异议类型统计"回应后是否真的推动了转化"：命中该异议的线索，在异议提出后N天内
 * 是否推进到试跑或成交(sales_stage_history 里出现更晚的 trial/won 记录)。
 * 只统计"异议之后"的阶段变化，避免把异议提出前就已经在推进的线索计成这条话术的功劳。
 */
export async function listObjectionConversionStats(pool, { days = 30, limit = 20 } = {}) {
  const r = await pool.query(
    `SELECT o.objection_key,
            MAX(o.objection_label) AS objection_label,
            COUNT(*)::int AS raised_count,
            COUNT(conv.lead_id)::int AS converted_count
       FROM sales_objections o
       LEFT JOIN LATERAL (
         SELECT h.lead_id
           FROM sales_stage_history h
          WHERE h.lead_id = o.lead_id
            AND h.to_stage IN ('trial','won')
            AND h.created_at > o.created_at
            AND h.created_at <= o.created_at + ($2 || ' days')::interval
          LIMIT 1
       ) conv ON true
      WHERE o.created_at >= NOW() - ($2 || ' days')::interval
      GROUP BY o.objection_key
      ORDER BY raised_count DESC
      LIMIT $1`,
    [limit, days]
  );
  return (r.rows || []).map((row) => ({
    ...row,
    conversion_rate: row.raised_count ? Math.round((row.converted_count / row.raised_count) * 100) : 0,
  }));
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
