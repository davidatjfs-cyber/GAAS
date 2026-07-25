/**
 * Agent Feishu / table-visit HTTP routes (Wave 4q — behavior-preserving extract from index.js).
 * getFeishuAccessToken / createFeishuBitableRecord / findConfigKeyByTableInfo / upsertFeishuGenericRecord:
 * index 本地函数，接线时从 index 注入 deps。
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'agent-data', handler: 'routes' });

export function registerAgentDataRoutes(app, authRequired, deps) {
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
  app.get('/api/agent/feishu-table-data', authRequired, async (req, res) => {
    try {
      const appToken = String(req.query?.appToken || '').trim();
      const tableId = String(req.query?.tableId || '').trim();
      const q = String(req.query?.q || '').trim();
      const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 500);
      const offset = Math.max(Number(req.query?.offset) || 0, 0);

      if (!appToken || !tableId) {
        return res.status(400).json({ error: 'missing_params', message: 'appToken/tableId required' });
      }

      const where = ['app_token = $1', 'table_id = $2'];
      const params = [appToken, tableId];
      if (q) {
        params.push(`%${q}%`);
        where.push(`fields::text ilike $${params.length}`);
      }
      params.push(req.tenantId || req.user?.tenant_id || 'default');
      where.push(`tenant_id = $${params.length}`);

      const whereSql = where.length ? `where ${where.join(' and ')}` : '';

      const countR = await pool.query(
        `select count(*)::int as cnt from feishu_generic_records ${whereSql}`,
        params
      );
      const total = Number(countR.rows?.[0]?.cnt || 0) || 0;

      params.push(limit, offset);
      const r = await pool.query(
        `select app_token, table_id, record_id, fields, updated_at
       from feishu_generic_records
       ${whereSql}
       order by updated_at desc
       limit $${params.length - 1} offset $${params.length}`,
        params
      );

      return res.json({
        items: r.rows || [],
        pagination: { limit, offset, total },
        query: { appToken, tableId, q: q || '' },
      });
    } catch (e) {
      log.error({ msg: 'agent_feishu_table_data_failed', err: e?.message || String(e) });
      return res.status(500).json({ error: 'server_error', message: 'internal_error' });
    }
  });

  // Agent/API: 直接写入飞书多维表格（单条或批量）
  app.post('/api/agent/feishu-table-write', authRequired, async (req, res) => {
    const role = String(req.user?.role || '').trim();
    if (!['admin', 'hq_manager', 'store_manager'].includes(role)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    try {
      const { appToken, tableId, appId, appSecret, fields, records } = req.body || {};
      if (!appToken || !tableId) {
        return res.status(400).json({ error: 'missing_app_token_or_table_id' });
      }

      const items = Array.isArray(records) ? records : fields && typeof fields === 'object' ? [fields] : [];

      if (!items.length) {
        return res.status(400).json({ error: 'missing_fields_or_records' });
      }
      if (items.length > 50) {
        return res.status(400).json({ error: 'too_many_records', message: 'max 50 records per request' });
      }

      const accessToken = await getFeishuAccessToken({ appId, appSecret });
      const createdRecordIds = [];
      const failedDetails = [];

      for (let i = 0; i < items.length; i++) {
        const row = items[i];
        try {
          if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new Error('invalid_fields');
          }

          const created = await createFeishuBitableRecord({
            appToken,
            tableId,
            fields: row,
            accessToken,
          });

          if (created?.record_id) {
            createdRecordIds.push(created.record_id);
          }

          try {
            if (created) {
              const configKey = findConfigKeyByTableInfo(appToken, tableId);
              await upsertFeishuGenericRecord({ appToken, tableId, record: created, configKey });
            }
          } catch (e) {
            // best effort local mirror; should not fail write call
          }
        } catch (err) {
          failedDetails.push({
            index: i,
            error: err?.message || String(err),
          });
        }
      }

      return res.json({
        success: true,
        total: items.length,
        created: createdRecordIds.length,
        failed: failedDetails.length,
        recordIds: createdRecordIds,
        failedDetails,
      });
    } catch (error) {
      log.error({ msg: 'agent_feishu_table_write_failed', err: error?.message || String(error) });
      return res.status(500).json({ error: 'server_error', message: safeErrMessage(error) });
    }
  });

  // Agent API - 查询桌访记录数据
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
      log.error({ msg: 'agent_table_visit_data_failed', err: error?.message || String(error) });
      res.status(500).json({
        success: false,
        error: 'server_error',
        message: safeErrMessage(error),
      });
    }
  });

  // Agent API - 获取桌访数据统计摘要
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
      log.error({ msg: 'agent_table_visit_summary_failed', err: error?.message || String(error) });
      res.status(500).json({
        success: false,
        error: 'server_error',
        message: safeErrMessage(error),
      });
    }
  });
}
