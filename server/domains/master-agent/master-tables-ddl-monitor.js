/**
 * Agent monitor / quality / regression DDL (P4 peel).
 */

/** @param {{ query: Function }} client */
export async function applyAgentMonitorTablesDdl(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_autonomous_logs (
      id SERIAL PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      result JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_autonomous_logs_task ON agent_autonomous_logs (task_id, created_at)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_collaboration_archives (
      id SERIAL PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      topic TEXT NOT NULL,
      initiator TEXT NOT NULL,
      participants JSONB NOT NULL,
      messages JSONB DEFAULT '[]',
      summary TEXT,
      created_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_collaboration_session ON agent_collaboration_archives (session_id, created_at)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS regression_check_results (
      id SERIAL PRIMARY KEY,
      check_data JSONB NOT NULL,
      passed BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_regression_check_time ON regression_check_results (created_at)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS automated_test_results (
      id SERIAL PRIMARY KEY,
      test_data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_automated_test_time ON automated_test_results (created_at)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS agent_task_logs (
      id SERIAL PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      execution_time_ms INTEGER,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_task_logs_agent ON agent_task_logs (agent_id, created_at)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_agent_task_logs_type ON agent_task_logs (task_type, status)`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS data_quality_logs (
      id SERIAL PRIMARY KEY,
      data_source TEXT NOT NULL,
      record_count INTEGER DEFAULT 0,
      data_quality_score NUMERIC(3,2) DEFAULT 1.0,
      issues JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_data_quality_source ON data_quality_logs (data_source, created_at)`);
}
