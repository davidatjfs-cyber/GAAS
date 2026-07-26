/**
 * Agent Feishu / table-visit HTTP routes (Wave 4q — behavior-preserving extract from index.js).
 * getFeishuAccessToken / createFeishuBitableRecord / findConfigKeyByTableInfo / upsertFeishuGenericRecord:
 * index 本地函数，接线时从 index 注入 deps。
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-data', handler: 'routes' });

export function registerAgentDataVisitSummaryRoutes(app, authRequired, deps) {
  const {
    pool,
    safeErrMessage,
    getFeishuAccessToken,
    createFeishuBitableRecord,
    findConfigKeyByTableInfo,
    upsertFeishuGenericRecord,
  } = deps;

  // ─── Agent API - 通用查询飞书多维表数据（已落库的 generic records）
  // H1-FIX: 添加认证保护

  app.get('/api/agent/table-visit-summary', authRequired, async (req, res) => {
    try {
      const { startDate, endDate, store } = req.query;

      let conditions = [];
      let params = [];
      let idx = 1;

      if (startDate) {
        conditions.push(`date >= $${idx}::date`);
        params.push(startDate);
        idx++;
      }
      if (endDate) {
        conditions.push(`date <= $${idx}::date`);
        params.push(endDate);
        idx++;
      }
      if (store) {
        conditions.push(`store = $${idx}`);
        params.push(store);
        idx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const query = `
      SELECT 
        COUNT(*) as total_visits,
        COUNT(DISTINCT date) as active_days,
        COUNT(DISTINCT store) as active_stores,
        SUM(guest_count) as total_guests,
        SUM(amount) as total_revenue,
        AVG(amount) as avg_amount_per_visit,
        AVG(guest_count) as avg_guests_per_visit,
        COUNT(CASE WHEN has_reservation THEN 1 END) as reservation_count,
        COUNT(CASE WHEN dissatisfaction_dish IS NOT NULL AND dissatisfaction_dish != '' THEN 1 END) as dish_complaints,
        COUNT(CASE WHEN customer_complaint IS NOT NULL AND customer_complaint != '' THEN 1 END) as customer_complaints,
        COUNT(CASE WHEN repeat_customer THEN 1 END) as repeat_customers,
        AVG(service_rating) as avg_service_rating,
        AVG(food_rating) as avg_food_rating,
        AVG(environment_rating) as avg_environment_rating,
        AVG(hygiene_rating) as avg_hygiene_rating,
        AVG(value_rating) as avg_value_rating,
        AVG(ambiance_rating) as avg_ambiance_rating,
        COUNT(CASE WHEN manager_intervention THEN 1 END) as manager_interventions,
        COUNT(CASE WHEN follow_up_required THEN 1 END) as follow_ups_required
      FROM table_visit_records 
      ${whereClause}
    `;

      const result = await pool.query(query, params);

      // 满意度分布
      const satisfactionQuery = `
      SELECT satisfaction_level, COUNT(*) as count
      FROM table_visit_records 
      ${whereWithSatisfaction}
      GROUP BY satisfaction_level
      ORDER BY count DESC
    `;

      const satisfactionResult = await pool.query(satisfactionQuery, params);

      // 天气影响分析
      const weatherQuery = `
      SELECT weather, 
             COUNT(*) as visits,
             AVG(amount) as avg_amount,
             AVG(service_rating) as avg_service_rating
      FROM table_visit_records 
      ${whereWithWeather}
      GROUP BY weather
      ORDER BY visits DESC
    `;

      const weatherResult = await pool.query(weatherQuery, params);

      res.json({
        success: true,
        summary: result.rows[0] || {},
        satisfaction_distribution: satisfactionResult.rows || [],
        weather_impact: weatherResult.rows || [],
      });
    } catch (error) {
      log.error({ msg: 'agent_table_visit_summary_failed', request_id: req.requestId, err: error?.message || String(error) });
      res.status(500).json({
        success: false,
        error: 'server_error',
        message: safeErrMessage(error),
      });
    }
  });
}
