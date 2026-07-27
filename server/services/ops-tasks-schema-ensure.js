/**
 * ops_tasks 表遗留 listen-time ensure*：从 server/index.js 外提
 * （只搬家，不新增 schema；B5 冻结要求新表走 migrations，domains/ 一律禁止 ensure*+CREATE TABLE，
 * 存量 ensure* 只能落在 services/ 并进 ensure-ddl-freeze.test.mjs 的白名单）。
 */
import { childLogger } from '../utils/logger.js';
import { safeErrMessage } from '../domains/shared/safe-err-message.js';

const log = childLogger({ domain: 'ops-tasks-schema' });

export async function ensureOpsTasksTable(pool) {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists ops_tasks (
        id uuid primary key default gen_random_uuid(),
        biz_date date not null,
        store varchar(200) not null,
        brand varchar(120),
        task_type varchar(60) not null,
        schedule_key varchar(100) not null,
        dedupe_key varchar(220) not null,
        title varchar(220) not null,
        instructions text,
        checklist jsonb not null default '[]'::jsonb,
        required_photos int not null default 1,
        assignee_username varchar(100) not null,
        assignee_role varchar(60) not null,
        status varchar(20) not null default 'open',
        due_at timestamp not null,
        completed_at timestamp,
        evidence_urls jsonb not null default '[]'::jsonb,
        evidence_note text,
        feedback_score int,
        feedback_text text,
        source varchar(60) not null default 'ops_agent',
        tenant_id varchar(80) not null default 'default',
        created_at timestamp default current_timestamp,
        updated_at timestamp default current_timestamp,
        constraint uq_ops_tasks_dedupe unique (dedupe_key, tenant_id)
      )`
    );
    await pool.query(`create index if not exists idx_ops_tasks_assignee_status on ops_tasks (assignee_username, status)`);
    await pool.query(`create index if not exists idx_ops_tasks_store_date on ops_tasks (store, biz_date)`);
    await pool.query(`create index if not exists idx_ops_tasks_due on ops_tasks (due_at)`);
  } catch (e) {
    if (safeErrMessage(e).includes('already exists')) return;
    if (e?.code === '23505') {
      const rel = await pool.query(`select to_regclass('public.ops_tasks') as rel`).catch(() => null);
      if (rel?.rows?.[0]?.rel === 'ops_tasks') return;
    }
    log.error({ msg: 'ensure_ops_tasks_table_failed', err: e?.message || String(e) });
    throw e;
  }
}
