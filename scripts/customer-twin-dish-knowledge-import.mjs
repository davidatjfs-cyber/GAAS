/**
 * 菜品知识卡导入（权威来源：/Users/xieding/产品介绍卡 下的 洪潮/马己仙 两份 md）
 * 规则：
 * - 每张卡 = 一条知识记录（category=菜品知识，tags=菜品知识/菜品介绍/品牌，audience=all）
 * - 成本列保持【待确认成本】，不写入门店可见内容
 * - 黑金叉烧：应用业务确认的准确说法（老抽加糖自然上色，焦糖色称黑金，不加色素）
 * - 虾生/鱼生：标注蘸料待补充
 * 用法：node scripts/customer-twin-dish-knowledge-import.mjs --dir=路径 [--write] [--limit=N]
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs() {
  const args = process.argv.slice(2);
  let dir = '/Users/xieding/产品介绍卡';
  let write = false;
  let limit = 0;
  for (const a of args) {
    if (a.startsWith('--dir=')) dir = a.slice(6);
    if (a === '--write') write = true;
    if (a.startsWith('--limit=')) limit = Number(a.slice(8)) || 0;
  }
  return { dir, write, limit };
}

function parseCards(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  const cards = [];
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    const lines = text.split('\n');
    let current = null;
    for (const line of lines) {
      const m = line.match(/^##\s+(\d+)\.\s*(.+?)\s*｜\s*(洪潮|马己仙)\s*$/);
      if (m) {
        if (current) cards.push(current);
        current = { title: `${m[2].trim()}｜${m[3]}`, brand: m[3], name: m[2].trim(), body: [] };
      } else if (current) {
        current.body.push(line);
      }
    }
    if (current) cards.push(current);
  }
  return cards;
}

function applyFixes(card) {
  let content = card.body.join('\n').trim();
  if (card.name.includes('黑金叉烧')) {
    content = content.replace(
      '“黑金”主要是这道菜的产品命名和色泽、风味表达。',
      '“黑金”不是色素：叉烧腌制不加色素，通过老抽加糖自然上色，烤制出来的焦糖色称为黑金。'
    );
  }
  if (/(虾生|鱼生)/.test(card.name) && !content.includes('蘸料')) {
    content += '\n\n> 备注：蘸料说明待门店确认后补充。';
  }
  return content;
}

async function main() {
  const { dir, write, limit } = parseArgs();
  const cards = parseCards(dir);
  console.log('解析卡片数:', cards.length);
  const batch = limit > 0 ? cards.slice(0, limit) : cards;
  if (!write) {
    console.log('dry-run：', batch.map((c) => c.title).join(' / '));
    return;
  }
  const { default: pg } = await import('pg');
  if (!process.env.DATABASE_URL) throw new Error('缺少 DATABASE_URL');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let inserted = 0;
  let updated = 0;
  for (const card of batch) {
    const content = applyFixes(card);
    const tags = ['菜品知识', '菜品介绍', card.brand];
    const exists = await pool.query('SELECT id FROM knowledge_base WHERE title = $1 LIMIT 1', [card.title]);
    if (exists.rows.length) {
      await pool.query(
        `UPDATE knowledge_base
            SET content = $2, category = '菜品知识', tags = $3::text[],
                audience = '{"type":"all"}'::jsonb, enabled = TRUE, updated_at = NOW()
          WHERE id = $1`,
        [exists.rows[0].id, content, tags]
      );
      updated += 1;
    } else {
      await pool.query(
        `INSERT INTO knowledge_base (title, content, category, tags, enabled, audience, version, tenant_id)
         VALUES ($1, $2, '菜品知识', $3::text[], TRUE, '{"type":"all"}'::jsonb, '1', 'default')`,
        [card.title, content, tags]
      );
      inserted += 1;
    }
  }
  await pool.end();
  const report = { write: true, batch: batch.length, inserted, updated };
  console.log(JSON.stringify(report));
  const docsDir = join(process.cwd(), 'docs');
  try {
    writeFileSync(join(docsDir, 'customer-twin-dish-knowledge-import-report.json'), JSON.stringify(report, null, 2) + '\n');
  } catch (_) { /* docs 目录不存在时跳过 */ }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
