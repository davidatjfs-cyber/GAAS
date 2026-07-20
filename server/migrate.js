/**
 * HRMS schema migrate CLI.
 *
 * Usage:
 *   node migrate.js              # apply pending (dev/staging; production needs ALLOW_PRODUCTION_MIGRATE=true)
 *   node migrate.js --status     # list applied / pending
 *   node migrate.js --dry-run    # show what would run
 *   node migrate.js --baseline   # mark all current .sql as applied WITHOUT running (existing DBs)
 *
 * Env:
 *   DATABASE_URL                 required
 *   ALLOW_PRODUCTION_MIGRATE=true  required when APP_ENV=production (except --status)
 */
import 'dotenv/config';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { getAppEnv } from './safety.js';
import { applyPendingMigrations, ensureSchemaMigrationsTable, getAppliedVersions, listMigrationFiles } from './schema-migrations.js';

const APP_ENV = getAppEnv();
const args = new Set(process.argv.slice(2));
const wantStatus = args.has('--status');
const dryRun = args.has('--dry-run');
const wantBaseline = args.has('--baseline');

if (APP_ENV === 'production' && !wantStatus && process.env.ALLOW_PRODUCTION_MIGRATE !== 'true') {
  console.error(
    '[safety] REFUSE_MIGRATE: APP_ENV=production. Set ALLOW_PRODUCTION_MIGRATE=true for a controlled one-shot run (still uses schema_migrations).'
  );
  process.exit(2);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function seedAdmin() {
  const username = String(process.env.ADMIN_USERNAME || 'admin').trim();
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  const realName = String(process.env.ADMIN_REAL_NAME || '系统管理员').trim();

  if (!password) {
    console.log('Skip admin seed: missing ADMIN_PASSWORD');
    return;
  }

  // users 表开了 FORCE RLS。这是独立的CLI脚本，不像应用服务器那样按请求
  // 用中间件设置 app.tenant_id 会话变量——不显式切到 system 上下文的话，
  // 下面的 SELECT 会被 RLS 过滤成看不到任何已有行，导致重复插入时又被
  // INSERT 的 WITH CHECK 拦下报错（曾经在这台机器上实际触发过）。
  await pool.query(`SELECT set_config('app.tenant_id', '__system__', false)`);

  const existing = await pool.query('select id from users where username = $1 limit 1', [username]);
  if ((existing.rows || []).length) {
    console.log('Admin already exists:', username);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query(
    'insert into users (username, password_hash, real_name, role, is_active) values ($1,$2,$3,$4,$5)',
    [username, passwordHash, realName, 'admin', true]
  );
  console.log('Admin seeded:', username);
}

async function printStatus() {
  await ensureSchemaMigrationsTable(pool);
  const done = await getAppliedVersions(pool);
  const files = listMigrationFiles();
  let pending = 0;
  for (const f of files) {
    if (done.has(f)) {
      console.log(`✓  ${f}`);
    } else {
      pending += 1;
      console.log(`○  ${f} (pending)`);
    }
  }
  console.log(`\nApplied ${done.size}/${files.length}; pending ${pending}`);
}

/** Existing production/demo DBs: record current files as applied, do not re-execute SQL. */
async function baselineExisting() {
  await ensureSchemaMigrationsTable(pool);
  const files = listMigrationFiles();
  const done = await getAppliedVersions(pool);
  let inserted = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    await pool.query(`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`, [file]);
    inserted += 1;
    console.log(`📌 baselined ${file}`);
  }
  console.log(`[migrate] baseline complete: marked ${inserted} new, already had ${done.size}`);
}

async function run() {
  if (wantStatus) {
    await printStatus();
    await pool.end();
    return;
  }

  if (wantBaseline) {
    console.log(`[migrate] APP_ENV=${APP_ENV} --baseline (no SQL execution)`);
    await baselineExisting();
    await pool.end();
    return;
  }

  console.log(`[migrate] APP_ENV=${APP_ENV} dryRun=${dryRun}`);
  const result = await applyPendingMigrations(pool, {
    dryRun,
    onProgress: ({ type, file, error }) => {
      if (type === 'skip') console.log(`⏭  ${file}`);
      else if (type === 'pending') console.log(`○  would run ${file}`);
      else if (type === 'run') console.log(`▶  ${file}`);
      else if (type === 'done') console.log(`✅ ${file}`);
      else if (type === 'error') console.error(`❌ ${file}:`, error?.message || error);
    },
  });

  if (result.failed) {
    console.error(`[migrate] stopped at ${result.failed}`);
    await pool.end();
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[migrate] dry-run: ${result.applied.length} pending, ${result.skipped.length} already applied`);
  } else {
    console.log(`[migrate] applied ${result.applied.length}, skipped ${result.skipped.length}`);
    if (result.applied.length === 0) {
      console.log('[migrate] nothing to do (schema up to date)');
    }
    await seedAdmin();
  }

  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
