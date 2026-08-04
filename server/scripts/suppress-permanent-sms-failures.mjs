#!/usr/bin/env node
/**
 * 一次性回填：把历史投递日志里已出现「阿里云永久失败」的号码批量写入 growth_sms_suppression，
 * 让所有自动发送路径（活动规则 / 储值提醒 / 召回 / 手动活动）立即跳过这些号码，
 * 不再每次都发、每次都收到「黑名单管控 / 已退订 / 停机 / 空号 / 格式错误」类拒收。
 *
 * 幂等：ON CONFLICT (phone, tenant_id) DO UPDATE，可重复执行。
 * 判定口径与运行时 handleSmsFailure 完全一致（共用 isSmsPermanentFailure）。
 *
 * 用法：
 *   DATABASE_URL=postgres://... node suppress-permanent-sms-failures.mjs [--days 90]
 */
import pg from 'pg';
import { isSmsPermanentFailure } from '../domains/growth-campaigns/helpers.js';

function parseArgs(argv) {
  const daysIdx = argv.indexOf('--days');
  const raw = daysIdx >= 0 ? Number(argv[daysIdx + 1]) : 90;
  return { days: Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 90 };
}

async function main() {
  const { days } = parseArgs(process.argv.slice(2));
  const pool = new pg.Pool({
    connectionString:
      process.env.DATABASE_URL || 'postgres://hrms:Abc1234567!@127.0.0.1:5432/hrms',
    max: 4,
  });
  try {
    const r = await pool.query(
      `SELECT payload->>'phone' AS phone,
              tenant_id,
              array_agg(DISTINCT error_message) AS errors,
              count(*)::int AS fails,
              max(created_at) AS last_fail
         FROM growth_delivery_logs
        WHERE channel = 'sms' AND status = 'failed'
          AND created_at > now() - ($1 || ' days')::interval
          AND payload->>'phone' IS NOT NULL AND payload->>'phone' <> ''
        GROUP BY 1, 2`,
      [String(days)]
    );
    // 窗口内任意一次为永久失败即抑制（避免最近一次是网络/余额等临时错误时漏掉曾退订/停机的号码）。
    const permanent = (r.rows || [])
      .map((x) => {
        const permError = (x.errors || []).filter(Boolean).find(isSmsPermanentFailure);
        return permError ? { ...x, permError } : null;
      })
      .filter(Boolean);
    const byError = new Map();
    for (const row of permanent) {
      const key = String(row.permError || 'unknown').slice(0, 40);
      byError.set(key, (byError.get(key) || 0) + 1);
    }
    let upserted = 0;
    for (const row of permanent) {
      await pool.query(
        `INSERT INTO growth_sms_suppression (phone, reason, error_message, tenant_id)
         VALUES ($1, 'permanent_failure', $2, $3)
         ON CONFLICT (phone, tenant_id) DO UPDATE
           SET error_message = EXCLUDED.error_message, updated_at = NOW()`,
        [String(row.phone).trim(), String(row.permError || '').slice(0, 500), row.tenant_id]
      );
      upserted++;
    }
    const total = await pool.query(`SELECT count(*)::int AS n FROM growth_sms_suppression`);
    console.log(
      JSON.stringify(
        {
          window_days: days,
          failed_logs_scanned: (r.rows || []).reduce((s, x) => s + (Number(x.fails) || 0), 0),
          failed_phones_scanned: (r.rows || []).length,
          permanent_phones_upserted: upserted,
          suppression_total_rows: total.rows[0]?.n || 0,
          by_error: Object.fromEntries(byError),
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
