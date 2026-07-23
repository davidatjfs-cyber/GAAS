/**
 * C10 / SHARED_TABLE_WRITERS 闸门：冻结跨仓越界写入，禁止新增。
 *
 * packages/gaas-shared 的 SHARED_TABLE_WRITERS 定义唯一写入方；
 * 本测试扫描 INSERT/UPDATE/DELETE，比对矩阵，存量进 allowlist（只减不增）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SHARED_TABLES, SHARED_TABLE_WRITERS } from '@gaas/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

/** 冻结前已存在的越界写入（file|OP|table）。只减不增。 */
const GAAS_CROSS_WRITER_ALLOWLIST = new Set([
  'agents.js|DELETE FROM|agent_messages',
  'agents.js|INSERT INTO|agent_messages',
  'agents.js|INSERT INTO|agent_scores',
  'agents.js|INSERT INTO|feishu_generic_records',
  'agents.js|INSERT INTO|feishu_users',
  'agents.js|INSERT INTO|master_tasks',
  'agents.js|UPDATE|agent_messages',
  'agents.js|UPDATE|feishu_users',
  'agents.js|UPDATE|master_tasks',
  'auto-ops-engine.js|UPDATE|master_tasks',
  'fix_bad_review_code.js|INSERT INTO|agent_messages',
  'fix_bitable_process.js|INSERT INTO|agent_messages',
  'force_sync.js|INSERT INTO|agent_messages',
  'index.js|DELETE FROM|agent_messages',
  'index.js|INSERT INTO|feishu_generic_records',
  'index.js|INSERT INTO|feishu_users',
  'index.js|UPDATE|feishu_users',
  'index.js|UPDATE|knowledge_base',
  'knowledge-routes.js|DELETE FROM|knowledge_base',
  'knowledge-routes.js|INSERT INTO|knowledge_base',
  'knowledge-routes.js|UPDATE|knowledge_base',
  'master-agent.js|INSERT INTO|agent_messages',
  'master-agent.js|INSERT INTO|master_tasks',
  'master-agent.js|UPDATE|master_tasks',
  'ontology/action-plan-service.js|INSERT INTO|master_tasks',
  'ontology/ontology-task-adapter.js|INSERT INTO|master_tasks',
  'performance-invalidation-api.js|UPDATE|agent_scores',
  'performance-jobs.js|INSERT INTO|agent_scores',
  'performance-jobs.js|UPDATE|agent_scores',
  'rag-tool.js|UPDATE|knowledge_base',
  'test-tenant-operation-inspection.mjs|INSERT INTO|master_tasks',
  'training.js|UPDATE|knowledge_base',
  'utils/feishu-open-id-cross-app.js|UPDATE|feishu_users',
]);

const OWNER = 'gaas';
const keyToTable = Object.fromEntries(Object.entries(SHARED_TABLES));

function walkJs(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', 'migrations', 'coverage', 'test'].includes(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkJs(p, out);
    else if (/\.(js|mjs)$/.test(name) && !name.includes('.test.')) out.push(p);
  }
  return out;
}

function scanCrossWrites(rootAbs, owner) {
  const litRe = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)\b/gi;
  const tplRe = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+\$\{SHARED_TABLES\.([A-Z0-9_]+)\}/gi;
  const hits = new Set();
  for (const abs of walkJs(rootAbs)) {
    const rel = path.relative(rootAbs, abs).replace(/\\/g, '/');
    if (rel.startsWith('scripts/')) continue;
    const src = fs.readFileSync(abs, 'utf8');
    let m;
    const r1 = new RegExp(litRe);
    while ((m = r1.exec(src))) {
      const op = m[1].toUpperCase().replace(/\s+/g, ' ');
      const table = m[2].toLowerCase();
      const writer = SHARED_TABLE_WRITERS[table];
      if (!writer || writer === owner) continue;
      hits.add(`${rel}|${op}|${table}`);
    }
    const r2 = new RegExp(tplRe);
    while ((m = r2.exec(src))) {
      const op = m[1].toUpperCase().replace(/\s+/g, ' ');
      const table = keyToTable[m[2]];
      if (!table) continue;
      const writer = SHARED_TABLE_WRITERS[table];
      if (!writer || writer === owner) continue;
      hits.add(`${rel}|${op}|${table}`);
    }
  }
  return [...hits].sort();
}

test('SHARED_TABLE_WRITERS：GAAS 不得新增对 agents 权威表的写入', () => {
  const found = scanCrossWrites(serverRoot, OWNER);
  const unexpected = found.filter((h) => !GAAS_CROSS_WRITER_ALLOWLIST.has(h));
  const stale = [...GAAS_CROSS_WRITER_ALLOWLIST].filter((h) => !found.includes(h));
  assert.deepEqual(
    unexpected,
    [],
    `新增越界写入（请改走 HTTP 或扩共享包纪律）：\n${unexpected.join('\n')}`
  );
  // allowlist 只减不增：已清除的条目应从白名单删掉（提示，不强制 fail 以免误伤 WIP）
  if (stale.length) {
    console.warn('[shared-table-writers] allowlist 可收缩（已无命中）:\n' + stale.join('\n'));
  }
});
