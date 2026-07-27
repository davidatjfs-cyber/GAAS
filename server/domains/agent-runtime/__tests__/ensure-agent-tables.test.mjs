import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createEnsureAgentTables } from '../ensure-agent-tables.js';

test('ensureAgentTables runs three migrations in order', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaas-agent-mig-'));
  for (const name of [
    '005_agent_p0p2_tables.sql',
    '010_hrms_perf_notifications.sql',
    '012_agent_scores_base_score.sql',
  ]) {
    fs.writeFileSync(path.join(dir, name), `-- ${name}\nSELECT 1;`);
  }
  const ran = [];
  const logs = [];
  const ensure = createEnsureAgentTables({
    pool: () => ({
      query: async (sql) => {
        ran.push(String(sql).trim());
      },
    }),
    log: {
      info: (...a) => logs.push(['info', ...a]),
      error: (...a) => logs.push(['error', ...a]),
    },
    migrationsDir: dir,
  });
  await ensure();
  assert.equal(ran.length, 3);
  assert.match(ran[0], /005_agent/);
  assert.match(ran[1], /010_hrms/);
  assert.match(ran[2], /012_agent/);
  assert.ok(logs.some((x) => x[0] === 'info' && String(x[2]).includes('005')));
});

test('ensureAgentTables ignores 23505 on 005 but logs other errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaas-agent-mig-'));
  fs.writeFileSync(path.join(dir, '005_agent_p0p2_tables.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(dir, '010_hrms_perf_notifications.sql'), 'SELECT 1;');
  fs.writeFileSync(path.join(dir, '012_agent_scores_base_score.sql'), 'SELECT 1;');
  const errors = [];
  let n = 0;
  const ensure = createEnsureAgentTables({
    pool: () => ({
      query: async () => {
        n += 1;
        if (n === 1) {
          const e = new Error('dup');
          e.code = '23505';
          throw e;
        }
      },
    }),
    log: { info: () => {}, error: (...a) => errors.push(a.join(' ')) },
    migrationsDir: dir,
  });
  await ensure();
  assert.equal(errors.length, 0);

  n = 0;
  const ensure2 = createEnsureAgentTables({
    pool: () => ({
      query: async () => {
        n += 1;
        if (n === 1) throw new Error('boom-005');
      },
    }),
    log: { info: () => {}, error: (...a) => errors.push(a.join(' ')) },
    migrationsDir: dir,
  });
  await ensure2();
  assert.ok(errors.some((s) => /005 failed/.test(s)));
});
