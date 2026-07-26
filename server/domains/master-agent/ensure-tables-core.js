/**
 * Core master_tasks / master_events DDL (P4 peel).
 */

/** @param {{ query: Function }} client */
export async function ensureCoreMasterTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS master_tasks (
      id SERIAL PRIMARY KEY,
      task_id TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_audit',
      source TEXT DEFAULT 'scheduled_audit',
      source_ref TEXT,
      current_agent TEXT,
      category TEXT,
      severity TEXT DEFAULT 'medium',
      store TEXT,
      brand TEXT,
      assignee_username TEXT,
      assignee_role TEXT,
      title TEXT,
      detail TEXT,
      source_data JSONB DEFAULT '{}'::jsonb,
      audit_result JSONB DEFAULT '{}'::jsonb,
      dispatch_data JSONB DEFAULT '{}'::jsonb,
      response_text TEXT,
      response_images JSONB DEFAULT '[]'::jsonb,
      review_result JSONB DEFAULT '{}'::jsonb,
      settlement_data JSONB DEFAULT '{}'::jsonb,
      score_impact NUMERIC(5,1) DEFAULT 0,
      feishu_msg_ids JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      dispatched_at TIMESTAMPTZ,
      responded_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      settled_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS master_events (
      id SERIAL PRIMARY KEY,
      task_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_agent TEXT,
      to_agent TEXT,
      status_before TEXT,
      status_after TEXT,
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_master_tasks_status ON master_tasks (status)`);
  await client.query(`ALTER TABLE master_tasks ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default'`);
  await client.query(`ALTER TABLE master_events ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default'`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_master_tasks_store ON master_tasks (store, status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_master_tasks_assignee ON master_tasks (assignee_username, status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_master_tasks_task_id ON master_tasks (task_id)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_master_events_task ON master_events (task_id, created_at)`);
}
