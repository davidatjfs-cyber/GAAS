/**
 * Feishu bitable.record.changed async handler (Wave 4q — behavior-preserving extract from index.js ~8461–8639).
 * ctx 字段均为 index 本地函数或从 feishu-sync / utils/database 等模块注入。
 */
export async function processFeishuDataChange(event, logId, ctx) {
  const {
    pool,
    safeErrMessage,
    resolveTenantIdDefault,
    loadTenantFeishuBitableConfig,
    getFeishuTokenByConfig,
    getFeishuAccessToken,
    getFeishuBitableData,
    findConfigKeyByTableInfo,
    upsertFeishuGenericRecord,
    mapFeishuFieldToHrms,
    notifyAdminsDualWriteFailure,
  } = ctx;

  try {
    // 租户感知：tenant 由外层 tenantContext.run(webhookTenantId, ...) 设置。
    const tenantId = resolveTenantIdDefault();
    const tenantCfg = await loadTenantFeishuBitableConfig(tenantId).catch(() => null);
    // 优先用租户专属凭证，无租户配置时回退到全局环境变量（兜底'default'）。
    const accessToken = tenantCfg?.app_id
      ? await getFeishuTokenByConfig({ app_id: tenantCfg.app_id, app_secret: tenantCfg.app_secret }).catch(() =>
          getFeishuAccessToken()
        )
      : await getFeishuAccessToken();
    const appToken = event.app_token;
    const tableId = event.table_id;
    const recordId = event.record_id;

    // 获取记录详情
    const recordData = await getFeishuBitableData(appToken, tableId, accessToken);
    const record = recordData.items?.find((item) => item.record_id === recordId);

    if (!record) {
      throw new Error('Record not found in Feishu');
    }

    // Always upsert raw record into generic storage with configKey
    try {
      const configKey = findConfigKeyByTableInfo(appToken, tableId);
      await upsertFeishuGenericRecord({ appToken, tableId, record, configKey });
    } catch (e) {
      console.log('[processFeishuDataChange] generic upsert failed:', e?.message || e);
      void notifyAdminsDualWriteFailure(
        `飞书 Webhook → feishu_generic_records（table ${String(tableId || '').slice(0, 16)} record ${String(recordId || '').slice(0, 24)}）`,
        e
      );
    }

    // 桌访表：从租户配置取 table_id，回退到默认值（默认租户历史值）。
    const tableVisitTableId = tenantCfg?.tables?.table_visit?.table_id || 'tblpx5Efqc6eHo3L';
    const isTableVisit = String(tableId || '').trim() === tableVisitTableId;
    if (!isTableVisit) {
      await pool.query('update feishu_sync_logs set sync_status = $1, processed_at = now() where id = $2', [
        'success',
        logId,
      ]);
      return;
    }

    // 根据表格类型处理数据
    const hrmsData = mapFeishuFieldToHrms(record, 'table_visit');

    // 存储到HRMS系统（这里以桌访记录为例）
    if (hrmsData.date && hrmsData.store) {
      await pool.query(
        `insert into table_visit_records (
          date, store, brand, table_number, guest_count, amount, 
          has_reservation, dissatisfaction_dish, feedback,
          reservation_time, customer_type, order_type, service_rating, food_rating, environment_rating,
          waiter_name, promotion_info, weather, peak_hours, customer_complaint, complaint_resolution,
          satisfaction_level, repeat_customer, special_requests, payment_method, order_duration,
          table_turnover, dish_recommendations, allergic_info, celebration_type, visit_purpose,
          companion_info, customer_age, customer_gender, visit_frequency, preferred_dishes,
          unsatisfied_items, suggested_improvements, staff_performance, facility_issues,
          hygiene_rating, value_rating, ambiance_rating, noise_level, temperature,
          lighting, music_volume, seating_comfort, queue_time, service_speed, order_accuracy,
          staff_attitude, problem_resolution, manager_intervention, compensation_provided,
          follow_up_required, follow_up_details, additional_notes,
          rush_dish_content,
          feishu_record_id, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
          $41, $42, $43, $44, $45, $46, $47, $48, $49, $50,
          $51, $52, $53, $54, $55, $56, $57, $58, $59, $60, now()
        ) on conflict (feishu_record_id) do update set
          date = excluded.date,
          store = excluded.store,
          brand = excluded.brand,
          table_number = excluded.table_number,
          guest_count = excluded.guest_count,
          amount = excluded.amount,
          has_reservation = excluded.has_reservation,
          dissatisfaction_dish = excluded.dissatisfaction_dish,
          feedback = excluded.feedback,
          reservation_time = excluded.reservation_time,
          customer_type = excluded.customer_type,
          order_type = excluded.order_type,
          service_rating = excluded.service_rating,
          food_rating = excluded.food_rating,
          environment_rating = excluded.environment_rating,
          waiter_name = excluded.waiter_name,
          promotion_info = excluded.promotion_info,
          weather = excluded.weather,
          peak_hours = excluded.peak_hours,
          customer_complaint = excluded.customer_complaint,
          complaint_resolution = excluded.complaint_resolution,
          satisfaction_level = excluded.satisfaction_level,
          repeat_customer = excluded.repeat_customer,
          special_requests = excluded.special_requests,
          payment_method = excluded.payment_method,
          order_duration = excluded.order_duration,
          table_turnover = excluded.table_turnover,
          dish_recommendations = excluded.dish_recommendations,
          allergic_info = excluded.allergic_info,
          celebration_type = excluded.celebration_type,
          visit_purpose = excluded.visit_purpose,
          companion_info = excluded.companion_info,
          customer_age = excluded.customer_age,
          customer_gender = excluded.customer_gender,
          visit_frequency = excluded.visit_frequency,
          preferred_dishes = excluded.preferred_dishes,
          unsatisfied_items = excluded.unsatisfied_items,
          suggested_improvements = excluded.suggested_improvements,
          staff_performance = excluded.staff_performance,
          facility_issues = excluded.facility_issues,
          hygiene_rating = excluded.hygiene_rating,
          value_rating = excluded.value_rating,
          ambiance_rating = excluded.ambiance_rating,
          noise_level = excluded.noise_level,
          temperature = excluded.temperature,
          lighting = excluded.lighting,
          music_volume = excluded.music_volume,
          seating_comfort = excluded.seating_comfort,
          queue_time = excluded.queue_time,
          service_speed = excluded.service_speed,
          order_accuracy = excluded.order_accuracy,
          staff_attitude = excluded.staff_attitude,
          problem_resolution = excluded.problem_resolution,
          manager_intervention = excluded.manager_intervention,
          compensation_provided = excluded.compensation_provided,
          follow_up_required = excluded.follow_up_required,
          follow_up_details = excluded.follow_up_details,
          additional_notes = excluded.additional_notes,
          rush_dish_content = excluded.rush_dish_content,
          updated_at = now()`,
        [
          hrmsData.date,
          hrmsData.store,
          hrmsData.brand,
          hrmsData.tableNumber,
          hrmsData.guestCount,
          hrmsData.amount,
          hrmsData.hasReservation,
          hrmsData.dissatisfactionDish,
          hrmsData.feedback,
          hrmsData.reservationTime ? hrmsData.reservationTime.replace(/^(\d{1,2}):(\d{1,2})$/, '$1:$2:00') : null,
          hrmsData.customerType,
          hrmsData.orderType,
          hrmsData.serviceRating,
          hrmsData.foodRating,
          hrmsData.environmentRating,
          hrmsData.waiterName,
          hrmsData.promotionInfo,
          hrmsData.weather,
          hrmsData.peakHours,
          hrmsData.customerComplaint,
          hrmsData.complaintResolution,
          hrmsData.satisfactionLevel,
          hrmsData.repeatCustomer,
          hrmsData.specialRequests,
          hrmsData.paymentMethod,
          hrmsData.orderDuration,
          hrmsData.tableTurnover,
          hrmsData.dishRecommendations,
          hrmsData.allergicInfo,
          hrmsData.celebrationType,
          hrmsData.visitPurpose,
          hrmsData.companionInfo,
          hrmsData.customerAge,
          hrmsData.customerGender,
          hrmsData.visitFrequency,
          hrmsData.preferredDishes,
          hrmsData.unsatisfiedItems,
          hrmsData.suggestedImprovements,
          hrmsData.staffPerformance,
          hrmsData.facilityIssues,
          hrmsData.hygieneRating,
          hrmsData.valueRating,
          hrmsData.ambianceRating,
          hrmsData.noiseLevel,
          hrmsData.temperature,
          hrmsData.lighting,
          hrmsData.musicVolume,
          hrmsData.seatingComfort,
          hrmsData.queueTime,
          hrmsData.serviceSpeed,
          hrmsData.orderAccuracy,
          hrmsData.staffAttitude,
          hrmsData.problemResolution,
          hrmsData.managerIntervention,
          hrmsData.compensationProvided,
          hrmsData.followUpRequired,
          hrmsData.followUpDetails,
          hrmsData.additionalNotes,
          hrmsData.rushDishContent || null,
          hrmsData.recordId,
        ]
      );

      // 更新同步状态
      await pool.query('update feishu_sync_logs set sync_status = $1, processed_at = now() where id = $2', [
        'success',
        logId,
      ]);

      console.log('[Feishu Webhook] Data synced successfully:', hrmsData.recordId);
    } else {
      throw new Error('Missing required fields: date or store');
    }
  } catch (error) {
    await pool.query(
      'update feishu_sync_logs set sync_status = $1, error_message = $2, processed_at = now() where id = $3',
      ['failed', safeErrMessage(error), logId]
    );
    throw error;
  }
}
