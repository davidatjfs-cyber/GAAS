import fs from 'node:fs/promises';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'baseline-schema-health' });

let initialized = false;

// 按分号切分成独立语句，但跳过$$.../$tag$...$tag$内部的分号(DO块/函数体常见)，
// 否则会把一个DO $$ BEGIN ... END $$;块拦腰切断成好几条不完整的语句。
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let dollarTag = null;
  let i = 0;
  while (i < sql.length) {
    if (dollarTag === null) {
      const dollarMatch = sql.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
      if (dollarMatch) {
        dollarTag = dollarMatch[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
      if (sql[i] === ';') {
        if (current.trim()) statements.push(current.trim());
        current = '';
        i += 1;
        continue;
      }
    } else if (sql.slice(i, i + dollarTag.length) === dollarTag) {
      current += dollarTag;
      i += dollarTag.length;
      dollarTag = null;
      continue;
    }
    current += sql[i];
    i += 1;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

// 这份baseline脚本的本质是"最佳努力型schema自愈"——每条语句都应该是IF NOT EXISTS/
// ADD COLUMN IF NOT EXISTS这类幂等操作。之前用单次pool.query(整份文件)执行，
// Postgres把多语句字符串当一个隐式事务：文件里任何一条语句报错，前面所有已成功的
// CREATE TABLE/ALTER TABLE都会被回滚，等于一处笔误能让整份文件在所有环境永远不生效。
// 改成逐条执行+单条失败只警告不中断，符合这个函数"尽量修，修不了就跳过"的设计目的。
export async function ensureBaselineSchemaHealth(pool) {
  if (!pool?.query) return { ok: false, skipped: true };
  if (initialized) return { ok: true, cached: true };
  const sql = await fs.readFile(new URL('./migrations/101_baseline_schema_health.sql', import.meta.url), 'utf8');
  const statements = splitSqlStatements(sql);
  let failCount = 0;
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (e) {
      failCount += 1;
      log.warn({ msg: 'baseline_statement_failed', err: e?.message || String(e) });
    }
  }
  initialized = true;
  log.info({ msg: 'baseline_schema_health_ready', ok: statements.length - failCount, total: statements.length });
  return { ok: true, total: statements.length, failed: failCount };
}
