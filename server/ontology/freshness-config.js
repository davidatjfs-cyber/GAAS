/**
 * 数据新鲜度监控 — 具体数据源配置
 *
 * 这里的 maxStalenessHours 是按业务常识给的默认猜测，不是用户确认过的阈值：
 *   - pos_sales_detail / daily_reports：timeColumn是DATE类型(不带时分秒)，checkFreshness按
 *     "now - 最后一天的00:00"算小时数，所以哪怕同步完全正常，当天数据要到打烊后才出现，
 *     临近午夜时"只有昨天的数据"也会算出接近48小时——阈值必须大于48才不会天天误报。
 *     2026-07-03上线当晚就在HRMS生产环境实测触发了一次误报(21:52时只有7/2的POS数据，
 *     但daily_reports已有7/3记录，说明经营本身没有延迟，纯粹是阈值算法没适配DATE列)。
 *   - feishu_generic_records：来自多张不同用途的飞书表，同步节奏不如POS/日报规律，放宽到48小时
 * 谁来收告警：复用 index.js#notifyAdminsDualWriteFailure 的收件人口径
 * （feishu_users 表里 role 属于 admin/hq_manager 的人），本模块不重新实现收件人查询。
 *
 * sales_raw已于2026-07-03下线，pos_sales_detail(视图, 底表pos_order_items)是现在的权威数据源，见CLAUDE.md。
 */

export const FRESHNESS_SOURCES = [
  { name: 'pos_sales_detail（POS销售）', table: 'pos_sales_detail', timeColumn: 'date', maxStalenessHours: 54 },
  { name: 'daily_reports（营业日报）', table: 'daily_reports', timeColumn: 'date', maxStalenessHours: 54 },
  { name: 'feishu_generic_records（飞书同步）', table: 'feishu_generic_records', timeColumn: 'updated_at', maxStalenessHours: 48 },
];
