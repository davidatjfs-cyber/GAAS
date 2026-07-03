/**
 * 数据新鲜度监控 — 具体数据源配置
 *
 * 这里的 maxStalenessHours 是按业务常识给的默认猜测，不是用户确认过的阈值：
 *   - pos_sales_detail / daily_reports：期望每个营业日都有数据，给到30小时留出跨天处理余量
 *   - feishu_generic_records：来自多张不同用途的飞书表，同步节奏不如POS/日报规律，放宽到48小时
 * 谁来收告警：复用 index.js#notifyAdminsDualWriteFailure 的收件人口径
 * （feishu_users 表里 role 属于 admin/hq_manager 的人），本模块不重新实现收件人查询。
 *
 * sales_raw已于2026-07-03下线，pos_sales_detail(视图, 底表pos_order_items)是现在的权威数据源，见CLAUDE.md。
 */

export const FRESHNESS_SOURCES = [
  { name: 'pos_sales_detail（POS销售）', table: 'pos_sales_detail', timeColumn: 'date', maxStalenessHours: 30 },
  { name: 'daily_reports（营业日报）', table: 'daily_reports', timeColumn: 'date', maxStalenessHours: 30 },
  { name: 'feishu_generic_records（飞书同步）', table: 'feishu_generic_records', timeColumn: 'updated_at', maxStalenessHours: 48 },
];
