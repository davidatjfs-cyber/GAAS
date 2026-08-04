/**
 * 黄金基准集草稿：从真实桌访/差评挑选 20 个代表案例，输出 JSON 到 stdout。
 * 用途：给业务专家/店长确认"选哪些真实事件进基准集"，再逐条补四层标注。
 * 用法（本地联生产库）：DATABASE_URL=... node scripts/customer-twin-golden-draft.mjs > draft.json
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const tv = await pool.query(
      `SELECT id, date, store, satisfaction_level, repeat_customer,
              feedback, customer_complaint, dissatisfaction_dish, guest_count, amount
         FROM table_visit_records
        WHERE (feedback IS NOT NULL AND length(feedback) > 0)
           OR (customer_complaint IS NOT NULL AND length(customer_complaint) > 0)
        ORDER BY (length(feedback) + length(customer_complaint)) DESC, date DESC
        LIMIT 10`
    );
    const br = await pool.query(
      `SELECT id, agent_data
         FROM agent_messages
        WHERE content_type = 'negative_review' AND agent_data ? 'reason'
        ORDER BY created_at DESC
        LIMIT 10`
    );
    const cases = [];
    for (const row of tv.rows) {
      cases.push({
        case_id: `G_TV_${String(row.id).padStart(4, '0')}`,
        source: 'table_visit_records',
        source_record_id: String(row.id),
        store: row.store,
        date: row.date ? String(row.date) : '',
        satisfaction_level: row.satisfaction_level,
        repeat_customer: row.repeat_customer,
        feedback: row.feedback || '',
        customer_complaint: row.customer_complaint || '',
        dissatisfaction_dish: row.dissatisfaction_dish || '',
        guest_count: row.guest_count,
        amount: row.amount,
      });
    }
    for (const row of br.rows) {
      const d = row.agent_data || {};
      const rawReason = String(d.reason || '').trim();
      if (!rawReason || /不属于差评|无差评|该评价为好评|^无$/.test(rawReason)) continue;
      cases.push({
        case_id: `G_BR_${String(row.id).slice(0, 8)}`,
        source: 'agent_messages',
        source_record_id: String(row.id),
        store: d.store || '',
        date: d.date || '',
        platform: d.platform || '',
        rating: d.rating || '',
        product: d.product || '',
        reason: d.reason || '',
        keywords: d.keywords || '',
      });
    }
    console.log(JSON.stringify({ count: cases.length, cases }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
