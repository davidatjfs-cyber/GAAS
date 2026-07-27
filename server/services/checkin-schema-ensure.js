/**
 * checkin_records 表遗留 listen-time ensure*：从 server/index.js 外提
 * （只搬家，不新增 schema；B5 冻结要求新表走 migrations，domains/ 一律禁止 ensure*+CREATE TABLE，
 * 存量 ensure* 只能落在 services/ 并进 ensure-ddl-freeze.test.mjs 的白名单）。
 */
import { childLogger } from '../utils/logger.js';

const log = childLogger({ domain: 'checkin-schema' });

export async function ensureCheckinTable(pool) {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists checkin_records (
        id uuid primary key default gen_random_uuid(),
        username varchar(100) not null,
        store varchar(200),
        type varchar(20) not null default 'clock_in',
        check_time timestamp not null default current_timestamp,
        latitude double precision,
        longitude double precision,
        distance_meters double precision,
        face_match boolean default false,
        face_score double precision,
        photo_url text,
        status varchar(20) not null default 'normal',
        note text,
        confirmed_by varchar(100),
        confirmed_at timestamp,
        created_at timestamp default current_timestamp
      )`
    );
    await pool.query(`create index if not exists idx_checkin_username_time on checkin_records (username, check_time)`);
    await pool.query(`create index if not exists idx_checkin_store_time on checkin_records (store, check_time)`);
    await pool.query(`create index if not exists idx_checkin_time on checkin_records (check_time)`);
  } catch (e) {
    log.error({ msg: 'ensure_checkin_table_failed', err: e?.message || String(e) });
  }
}
