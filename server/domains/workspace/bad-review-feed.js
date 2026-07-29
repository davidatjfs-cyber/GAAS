/**
 * 差评展示（首页第9项，用户中途加的）：合并两个数据源——
 * - bad_reviews：平台差评（大众点评等），有 date/store/content/platform/rating，没有具体时间
 * - table_visit_records：桌访记录，有 date/store/feedback/dissatisfaction_dish/reservation_time
 *   （已用 8.153.95.62 demo 库真实表结构核实过这些列存在）
 * 两个表字段不对齐，这里统一成 { store, date, time, content, source } 的时间线格式。
 * 支持按门店/日期区间检索。
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'workspace', handler: 'bad-review-feed' });

export async function getBadReviewFeed(pool, tenantId, { store = '', startDate = '', endDate = '', limit = 30 } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  try {
    const platformParams = [tenantId];
    let platformWhere = '';
    if (store) { platformParams.push(store); platformWhere += ` AND store = $${platformParams.length}`; }
    if (startDate) { platformParams.push(startDate); platformWhere += ` AND date >= $${platformParams.length}`; }
    if (endDate) { platformParams.push(endDate); platformWhere += ` AND date <= $${platformParams.length}`; }

    const visitParams = [tenantId];
    let visitWhere = '';
    if (store) { visitParams.push(store); visitWhere += ` AND store = $${visitParams.length}`; }
    if (startDate) { visitParams.push(startDate); visitWhere += ` AND date >= $${visitParams.length}`; }
    if (endDate) { visitParams.push(endDate); visitWhere += ` AND date <= $${visitParams.length}`; }

    const [platformR, visitR] = await Promise.all([
      pool.query(
        `SELECT store, date, content, platform, rating
           FROM bad_reviews
          WHERE tenant_id = $1${platformWhere}
          ORDER BY date DESC LIMIT ${lim}`,
        platformParams
      ),
      pool.query(
        `SELECT store, date, reservation_time, feedback, dissatisfaction_dish, service_rating, food_rating, environment_rating
           FROM table_visit_records
          WHERE tenant_id = $1 AND (COALESCE(feedback,'') <> '' OR COALESCE(dissatisfaction_dish,'') <> '')${visitWhere}
          ORDER BY date DESC LIMIT ${lim}`,
        visitParams
      ),
    ]);

    const platformItems = (platformR.rows || []).map((row) => ({
      store: row.store,
      date: row.date,
      time: null,
      content: row.content,
      source: '平台差评' + (row.platform ? '·' + row.platform : ''),
      rating: row.rating,
    }));
    const visitItems = (visitR.rows || []).map((row) => ({
      store: row.store,
      date: row.date,
      time: row.reservation_time,
      content: row.feedback || row.dissatisfaction_dish,
      source: '桌访记录',
      rating: null,
    }));

    return [...platformItems, ...visitItems]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, lim);
  } catch (e) {
    log.error({ msg: 'bad_review_feed_failed', err: e?.message || String(e) });
    return [];
  }
}
