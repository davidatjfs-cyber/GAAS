/**
 * 遗留未使用辅助函数（厨房/原料/例会报告计数）。
 * 从 new-scoring-model.js 原样搬迁：这些函数在拆分前的原文件里就未被任何地方调用
 * （原文件里是模块私有函数），按项目纪律「不删除非本次改动引入的死代码」原样保留。
 * 拆分后所在文件不在 legacy no-unused-vars 白名单内（该白名单只保留给巨石文件），
 * 因此这里改为具名导出以满足新文件的 no-unused-vars=error 闸门；未改变任何行为
 * （原本也没有任何调用方）。
 */
import { pool } from '../../utils/database.js';
import { periodDateRange } from './store-match-helpers.js';
import { scoringStoreExactKeys } from './store-match-helpers.js';

// 获取厨房报告数量
export async function getKitchenReportsCount(store, period, reportType) {
  const { startDate, endDate } = periodDateRange(period);
  const keys = scoringStoreExactKeys(store);
  if (!keys.length) return 0;

  const result = await pool().query(
    `SELECT COUNT(*)::int AS count FROM kitchen_reports
     WHERE store = ANY($1::text[])
       AND report_date >= $2::date AND report_date <= $3::date AND report_type = $4`,
    [keys, startDate, endDate, reportType]
  );

  return Number(result.rows[0]?.count || 0);
}

// 获取原料收货报告数量
export async function getMaterialReceivingReportsCount(store, period) {
  const { startDate, endDate } = periodDateRange(period);
  const keys = scoringStoreExactKeys(store);
  if (!keys.length) return 0;

  const result = await pool().query(
    `SELECT COUNT(*)::int AS count FROM material_receiving_reports
     WHERE store = ANY($1::text[])
       AND report_date >= $2::date AND report_date <= $3::date`,
    [keys, startDate, endDate]
  );

  return Number(result.rows[0]?.count || 0);
}

// 获取门店例会报告
export async function getStoreMeetingReports(store, period) {
  const { startDate, endDate } = periodDateRange(period);
  const keys = scoringStoreExactKeys(store);
  if (!keys.length) return [];

  const result = await pool().query(
    `SELECT submitted, meeting_score FROM store_meeting_reports
     WHERE store = ANY($1::text[])
       AND meeting_date >= $2::date AND meeting_date <= $3::date`,
    [keys, startDate, endDate]
  );

  return result.rows || [];
}

/** 全库该月是否有厨房/收货同步数据（用于区分「未接表」与「真缺交」） */
export async function hasGlobalKitchenOrMaterialInPeriod(period) {
  const { startDate, endDate } = periodDateRange(period);
  const r = await pool().query(
    `SELECT
       (SELECT COUNT(*)::int FROM kitchen_reports WHERE report_date >= $1::date AND report_date <= $2::date) AS kc,
       (SELECT COUNT(*)::int FROM material_receiving_reports WHERE report_date >= $1::date AND report_date <= $2::date) AS mc`,
    [startDate, endDate]
  );
  const row = r.rows?.[0] || {};
  return (Number(row.kc) || 0) > 0 || (Number(row.mc) || 0) > 0;
}

export async function hasGlobalMeetingReportsInPeriod(period) {
  const { startDate, endDate } = periodDateRange(period);
  const r = await pool().query(
    `SELECT COUNT(*)::int AS c FROM store_meeting_reports
     WHERE meeting_date >= $1::date AND meeting_date <= $2::date`,
    [startDate, endDate]
  );
  return (Number(r.rows[0]?.c) || 0) > 0;
}
