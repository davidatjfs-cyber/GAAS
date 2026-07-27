/**
 * 新评分模型 — 门店评级与员工评分
 *
 * 月度口径（与 agents-service `monthly-comprehensive-rating` 对齐）：
 * - 绩效分 total_score：`agent_scores` / `anomaly_rollups_v2` 当月各自然周 `total_score` 算术平均（BI 异常触发后的周汇总）。
 * - 工作态度：`master_tasks` 且 `hr_performance_recorded = true` 的备案未完成（distinct task_id）。
 * - 工作执行力：除洪潮店长（企微新增 = HRMS 营业日报当月汇总）外，均只读 `agent_messages`（开档/收档/原料/例会均由飞书轮询写入该表，口径统一）。出品经理月度按「自然日是否档口齐+原料齐」计未达标天数，与 agents 月评一致。
 * - 工作能力：出品 = `monthly_margins` 实收毛利率 vs 目标；店长 = 营业日报 **每月 9 日** `dianping_rating`（与 agents 店长能力一致）。
 *
 * 本文件为薄编排层：实际逻辑已拆分至 server/domains/store-scoring/*。
 * 各拆分模块直接使用 utils/database.js 的 pool() 单例（本文件原本也是如此，
 * 无需像 hq-planner 那样注入 ctx），因此这里只做 re-export，保持既有 import 路径不变。
 */

export { EMPLOYEE_RATING_PENDING, STORE_RATING_CONFIG, BONUS_CONFIG, EMPLOYEE_SCORE_CONFIG } from './domains/store-scoring/config.js';
export { calculateStoreRating } from './domains/store-scoring/store-rating.js';
export { getMonthlyAnomalyRollupAverageScore, calculateEmployeeScore } from './domains/store-scoring/employee-score.js';
export { calculateExecutionRating } from './domains/store-scoring/execution-rating.js';
export { calculateAttitudeRating, calculateAbilityRating, getIncompleteTaskCount } from './domains/store-scoring/attitude-ability-rating.js';
export { calculateBonus } from './domains/store-scoring/bonus.js';
