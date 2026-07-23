import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listMigrationFiles,
  applyPendingMigrations,
  isMigrationSqlFile,
  getMigrationDriftReport,
} from './schema-migrations.js';

test('isMigrationSqlFile rejects AppleDouble and non-numeric prefixes', () => {
  assert.equal(isMigrationSqlFile('001_a.sql'), true);
  assert.equal(isMigrationSqlFile('111b_sales_case_seed.sql'), true);
  assert.equal(isMigrationSqlFile('._001_a.sql'), false);
  assert.equal(isMigrationSqlFile('.~lock.sql'), false);
  assert.equal(isMigrationSqlFile('readme.sql'), false);
  assert.equal(isMigrationSqlFile('notes.txt'), false);
});

test('listMigrationFiles sorts sql names and ignores junk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-mig-'));
  fs.writeFileSync(path.join(dir, '002_b.sql'), 'select 1;');
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'select 1;');
  fs.writeFileSync(path.join(dir, '._001_a.sql'), 'junk');
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'nope');
  fs.writeFileSync(path.join(dir, 'notes.sql'), 'select 1;');
  assert.deepEqual(listMigrationFiles(dir), ['001_a.sql', '002_b.sql']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('applyPendingMigrations skips already applied and records new', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-mig-'));
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(dir, '002_b.sql'), 'SELECT 2;');

  const store = new Set(['001_a.sql']);
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(sql)) return { rows: [] };
      if (/SELECT version FROM schema_migrations/i.test(sql)) {
        return { rows: [...store].map((version) => ({ version })) };
      }
      if (/^BEGIN|^COMMIT|^ROLLBACK/i.test(String(sql).trim())) return { rows: [] };
      if (/INSERT INTO schema_migrations/i.test(sql)) {
        store.add(params[0]);
        return { rows: [] };
      }
      if (/^SELECT /i.test(String(sql).trim())) return { rows: [] };
      return { rows: [] };
    },
    async connect() {
      return {
        query: (sql, params) => pool.query(sql, params),
        release() {},
      };
    },
  };

  const first = await applyPendingMigrations(pool, { migrationsDir: dir });
  assert.equal(first.failed, null);
  assert.deepEqual(first.skipped, ['001_a.sql']);
  assert.deepEqual(first.applied, ['002_b.sql']);
  assert.ok(store.has('002_b.sql'));

  const second = await applyPendingMigrations(pool, { migrationsDir: dir });
  assert.deepEqual(second.applied, []);
  assert.equal(second.skipped.length, 2);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('getMigrationDriftReport flags pending and orphan applied versions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-mig-'));
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(dir, '002_b.sql'), 'SELECT 2;');
  fs.writeFileSync(path.join(dir, '._junk.sql'), 'SELECT 9;');

  const store = new Set(['001_a.sql', '999_gone.sql']);
  const pool = {
    async query(sql) {
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(sql)) return { rows: [] };
      if (/SELECT version FROM schema_migrations/i.test(sql)) {
        return { rows: [...store].map((version) => ({ version })) };
      }
      return { rows: [] };
    },
  };

  const report = await getMigrationDriftReport(pool, { migrationsDir: dir });
  assert.equal(report.ok, false);
  assert.equal(report.repoCount, 2);
  assert.equal(report.appliedCount, 2);
  assert.deepEqual(report.pending, ['002_b.sql']);
  assert.deepEqual(report.orphanApplied, ['999_gone.sql']);

  fs.rmSync(dir, { recursive: true, force: true });
});
