import test from 'node:test';
import assert from 'node:assert/strict';
import { runSchemaMigrationDriftCheck } from '../schema-migration-drift-monitor.js';

test('runSchemaMigrationDriftCheck alerts once when pending migrations exist', async () => {
  const msgs = [];
  const pool = {
    async query(sql) {
      if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(sql)) return { rows: [] };
      if (/SELECT version FROM schema_migrations/i.test(sql)) {
        return { rows: [{ version: '001_a.sql' }] };
      }
      return { rows: [] };
    },
  };
  // Point at a fake dir via opts — create temp with 2 files
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'));
  fs.writeFileSync(path.join(dir, '001_a.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(dir, '002_b.sql'), 'SELECT 2;');

  const first = await runSchemaMigrationDriftCheck(pool, {
    migrationsDir: dir,
    notifyFn: async (m) => { msgs.push(m); },
  });
  assert.equal(first.ok, false);
  assert.equal(msgs.length, 1);
  assert.match(msgs[0], /pending/);

  const second = await runSchemaMigrationDriftCheck(pool, {
    migrationsDir: dir,
    notifyFn: async (m) => { msgs.push(m); },
  });
  assert.equal(second.skipped, true);
  assert.equal(msgs.length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});
