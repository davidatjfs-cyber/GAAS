import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listMigrationFiles, applyPendingMigrations } from './schema-migrations.js';

test('listMigrationFiles sorts sql names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-mig-'));
  fs.writeFileSync(path.join(dir, '002_b.sql'), 'select 1;');
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'select 1;');
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'nope');
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
