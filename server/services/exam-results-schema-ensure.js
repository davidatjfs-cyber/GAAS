/**
 * exam_results 表遗留 listen-time ensure*：从 server/index.js 外提
 * （只搬家，不新增 schema；B5 冻结要求新表走 migrations，domains/ 一律禁止 ensure*+CREATE TABLE，
 * 存量 ensure* 只能落在 services/ 并进 ensure-ddl-freeze.test.mjs 的白名单）。
 */
import { childLogger } from '../utils/logger.js';
import { createHasColumnHelpers } from '../domains/shared/has-column.js';

const log = childLogger({ domain: 'exam-results-schema' });

export async function ensureExamResultsTable(pool) {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists exam_results (
        id uuid primary key default gen_random_uuid(),
        assignment_id uuid,
        user_key varchar(100) not null,
        created_at timestamp default current_timestamp,
        started_at timestamp,
        submitted_at timestamp,
        time_used_seconds integer,
        auto_submitted boolean default false,
        set_index integer,
        total integer,
        correct integer,
        score integer,
        answers jsonb
      )`
    );

    // In case an older schema exists, backfill missing columns.
    await pool.query(`alter table exam_results add column if not exists assignment_id uuid`);
    await pool.query(`alter table exam_results add column if not exists user_key varchar(100)`);
    await pool.query(`alter table exam_results add column if not exists created_at timestamp default current_timestamp`);
    await pool.query(`alter table exam_results add column if not exists started_at timestamp`);
    await pool.query(`alter table exam_results add column if not exists submitted_at timestamp`);
    await pool.query(`alter table exam_results add column if not exists time_used_seconds integer`);
    await pool.query(`alter table exam_results add column if not exists auto_submitted boolean default false`);
    await pool.query(`alter table exam_results add column if not exists set_index integer`);
    await pool.query(`alter table exam_results add column if not exists total integer`);
    await pool.query(`alter table exam_results add column if not exists correct integer`);
    await pool.query(`alter table exam_results add column if not exists score integer`);
    await pool.query(`alter table exam_results add column if not exists answers jsonb`);

    const { hasColumn } = createHasColumnHelpers({ pool });
    const hasUserKey = await hasColumn('exam_results', 'user_key');
    const hasCreatedAt = await hasColumn('exam_results', 'created_at');
    const hasAssignmentId = await hasColumn('exam_results', 'assignment_id');

    if (hasUserKey && hasCreatedAt) {
      await pool.query(
        `create index if not exists idx_exam_results_user_key_created_at
         on exam_results (user_key, created_at desc)`
      );
    }
    if (hasAssignmentId) {
      await pool.query(
        `create index if not exists idx_exam_results_assignment_id
         on exam_results (assignment_id)`
      );
    }
  } catch (e) {
    log.error({ msg: 'ensure_exam_results_table_failed', err: e?.message || String(e) });
  }
}
