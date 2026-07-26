/**
 * Agent Feishu / table-visit HTTP routes (Wave 4q — behavior-preserving extract from index.js).
 * getFeishuAccessToken / createFeishuBitableRecord / findConfigKeyByTableInfo / upsertFeishuGenericRecord:
 * index 本地函数，接线时从 index 注入 deps。
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-data', handler: 'routes' });

export function registerAgentDataVisitDataRoutes(app, authRequired, deps) {
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

  app.get('/api/agent/table-visit-data', authRequired, async (req, res) => {
    try {
      const {
        startDate,
        endDate,
        store,
        satisfactionLevel,
        minRating,
        maxRating,
        limit = 100,
        offset = 0,
      } = req.query;

      let conditions = [];
      let params = [];
      let idx = 1;

      // 日期范围过滤
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

      // 门店过滤
      if (store) {
        conditions.push(`store = $${idx}`);
        params.push(store);
        idx++;
      }

      // 满意度等级过滤
      if (satisfactionLevel) {
        conditions.push(`satisfaction_level = $${idx}`);
        params.push(satisfactionLevel);
        idx++;
      }

      // 评分范围过滤
      if (minRating) {
        conditions.push(`service_rating >= $${idx} AND food_rating >= $${idx} AND environment_rating >= $${idx}`);
        params.push(parseInt(minRating, 10));
        idx++;
      }
      if (maxRating) {
        conditions.push(`service_rating <= $${idx} AND food_rating <= $${idx} AND environment_rating <= $${idx}`);
        params.push(parseInt(maxRating, 10));
        idx++;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const baseCond = conditions.length > 0 ? conditions.join(' AND ') : 'TRUE';
      const _whereWithSatisfaction = `WHERE ${baseCond} AND satisfaction_level IS NOT NULL AND satisfaction_level != ''`;
      const _whereWithWeather = `WHERE ${baseCond} AND weather IS NOT NULL AND weather != ''`;
      const limitClause = `LIMIT ${Math.min(parseInt(limit, 10) || 100, 1000)} OFFSET ${Math.max(parseInt(offset, 10) || 0, 0)}`;

      const query = `
      SELECT 
        id, date, store, brand, table_number, guest_count, amount,
        has_reservation, dissatisfaction_dish, feedback,
        reservation_time, customer_type, order_type,
        service_rating, food_rating, environment_rating,
        waiter_name, promotion_info, weather, peak_hours,
        customer_complaint, complaint_resolution, satisfaction_level,
        repeat_customer, special_requests, payment_method,
        order_duration, table_turnover, dish_recommendations,
        allergic_info, celebration_type, visit_purpose,
        companion_info, customer_age, customer_gender,
        visit_frequency, preferred_dishes, unsatisfied_items,
        suggested_improvements, staff_performance, facility_issues,
        hygiene_rating, value_rating, ambiance_rating,
        noise_level, temperature, lighting, music_volume,
        seating_comfort, queue_time, service_speed,
        order_accuracy, staff_attitude, problem_resolution,
        manager_intervention, compensation_provided,
        follow_up_required, follow_up_details, additional_notes,
        feishu_record_id, created_at, updated_at
      FROM table_visit_records 
      ${whereClause}
      ORDER BY date DESC, created_at DESC
      ${limitClause}
    `;

      const result = await pool.query(query, params);

      // 返回统计信息
      const statsQuery = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(CASE WHEN dissatisfaction_dish IS NOT NULL AND dissatisfaction_dish != '' THEN 1 END) as complaints,
        COUNT(CASE WHEN customer_complaint IS NOT NULL AND customer_complaint != '' THEN 1 END) as serious_complaints,
        AVG(service_rating) as avg_service_rating,
        AVG(food_rating) as avg_food_rating,
        AVG(environment_rating) as avg_environment_rating,
        AVG(amount) as avg_amount,
        SUM(guest_count) as total_guests
      FROM table_visit_records 
      ${whereClause}
    `;

      const statsResult = await pool.query(statsQuery, params);

      res.json({
        success: true,
        data: result.rows,
        stats: statsResult.rows[0] || {},
        pagination: {
          limit: parseInt(limit, 10) || 100,
          offset: parseInt(offset, 10) || 0,
          total: result.rowCount,
        },
      });
    } catch (error) {
      log.error({ msg: 'agent_table_visit_data_failed', request_id: req.requestId, err: error?.message || String(error) });
      res.status(500).json({
        success: false,
        error: 'server_error',
        message: safeErrMessage(error),
      });
    }
  });

  // Agent API - 获取桌访数据统计摘要
  // H1-FIX: 添加认证保护
}
