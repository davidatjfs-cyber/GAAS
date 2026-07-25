import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'hrms-core-schema' });

export async function ensureEmployeeAttachmentsTable(pool) {
  try {
    await pool.query(`
      create table if not exists employee_attachments (
        id serial primary key,
        employee_id text not null,
        filename text not null,
        original_name text not null,
        url text not null,
        description text default '',
        uploaded_by text not null,
        created_at timestamptz default now()
      )
    `);
    await pool.query(`create index if not exists idx_emp_att_emp_id on employee_attachments(employee_id)`);
  } catch (e) { /* ignore */ }
}

export async function ensureHrmsStateTable(pool) {
  try {
    await pool.query(
      `create table if not exists hrms_state (
        key text primary key,
        data jsonb not null,
        updated_at timestamp default current_timestamp
      )`
    );
  } catch (e) {
    log.error({ msg: 'ensure_hrms_state_table_failed', err: e?.message || String(e) });
  }
}

export async function ensureApprovalTables(pool) {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists approval_requests (
        id uuid primary key default gen_random_uuid(),
        type varchar(50) not null,
        status varchar(20) not null,
        applicant_username varchar(100) not null,
        current_assignee_username varchar(100),
        chain jsonb not null default '[]'::jsonb,
        payload jsonb not null default '{}'::jsonb,
        effective_date date,
        executed_at timestamp,
        created_at timestamp default current_timestamp,
        updated_at timestamp default current_timestamp
      )`
    );
    await pool.query(`create index if not exists idx_approval_requests_assignee_status on approval_requests (current_assignee_username, status)`);
    await pool.query(`create index if not exists idx_approval_requests_applicant_status on approval_requests (applicant_username, status)`);
    await pool.query(`create index if not exists idx_approval_requests_type_effective_date on approval_requests (type, effective_date)`);
    await pool.query(`create table if not exists recurring_reward_templates (
      id uuid primary key default gen_random_uuid(),
      active boolean not null default true,
      created_by varchar(100) not null,
      frequency varchar(20) not null default 'monthly',
      payload jsonb not null default '{}'::jsonb,
      last_generated_ym varchar(7),
      created_at timestamptz default current_timestamp,
      updated_at timestamptz default current_timestamp
    )`);
    await pool.query(
      `create index if not exists idx_recurring_reward_templates_active on recurring_reward_templates (active, frequency)`
    );
  } catch (e) {
    log.error({ msg: 'ensure_approval_tables_failed', err: e?.message || String(e) });
  }
}

export async function ensureUserSessionsTable(pool, databaseUrl) {
  if (!databaseUrl) return;
  let client;
  try {
    client = await pool.connect();
    await client.query('SET default_transaction_read_only = OFF');
    await client.query(
      `create table if not exists user_sessions (
        username varchar(100) primary key,
        session_nonce varchar(64) not null,
        tenant_id varchar(80) not null default 'default',
        updated_at timestamp default current_timestamp
      )`
    );
    await client.query(`alter table user_sessions add column if not exists tenant_id varchar(80) not null default 'default'`);
    await client.query(`create unique index if not exists user_sessions_username_tenant_idx on user_sessions (username, tenant_id)`);
  } catch (e) {
    log.error({ msg: 'ensure_user_sessions_table_failed', err: e?.message || String(e) });
  } finally {
    try {
      if (client) client.release();
    } catch (_e) {
      /* ignore */
    }
  }
}

export async function ensureTenantRuntimeTables(pool, databaseUrl) {
  if (!databaseUrl) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT UNIQUE NOT NULL,
        name TEXT,
        mode TEXT DEFAULT 'managed',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id BIGSERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        status TEXT DEFAULT 'trial',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_config (
        id BIGSERIAL PRIMARY KEY,
        tenant_key TEXT NOT NULL,
        config_key TEXT NOT NULL,
        config_value JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (tenant_key, config_key)
      )`);
    await pool.query(`
      INSERT INTO tenants (tenant_id, name, mode, status)
      VALUES ('default', '本地默认租户', 'managed', 'active')
      ON CONFLICT (tenant_id) DO UPDATE SET status='active', updated_at=NOW()`);
  } catch (e) {
    log.error({ msg: 'ensure_tenant_runtime_tables_failed', err: e?.message || String(e) });
  }
}

export async function ensureUserReadsTable(pool) {
  try {
    await pool.query(
      `create table if not exists user_reads (
        username varchar(100) not null,
        module varchar(50) not null,
        item_key varchar(160) not null,
        read_at timestamp default current_timestamp,
        primary key (username, module, item_key)
      )`
    );
    await pool.query(`create index if not exists idx_user_reads_username_module on user_reads (username, module)`);
  } catch (e) {
    log.error({ msg: 'ensure_user_reads_table_failed', err: e?.message || String(e) });
  }
}

export async function ensureLoginLogTable(pool) {
  try {
    await pool.query(`
      create table if not exists user_login_log (
        id serial primary key,
        username varchar(100) not null,
        login_at timestamptz not null default now(),
        logout_at timestamptz,
        session_nonce varchar(64),
        ip_address varchar(45),
        user_agent text,
        created_at timestamptz not null default now()
      )
    `);
    await pool.query(`create index if not exists idx_ull_username_date on user_login_log (username, CAST((login_at at time zone 'Asia/Shanghai') AS date))`);
    await pool.query(`create index if not exists idx_ull_login_at on user_login_log (login_at)`);
    await pool.query(`create index if not exists idx_ull_open_session on user_login_log (username, logout_at) where logout_at is null`);
  } catch (e) {
    log.error({ msg: 'ensure_login_log_table_failed', err: e?.message || String(e) });
  }
}
