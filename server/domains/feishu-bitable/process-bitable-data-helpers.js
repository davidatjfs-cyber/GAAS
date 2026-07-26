/**
 * Bitable typed record processors (P2 peel from agents.js).
 */
import { resolveTenantIdDefault } from '../../utils/database.js';

export async function processTableVisitData(deps, records) {
  const {
    pool,
    log,
    extractDissatisfactionDishFromFields,
    extractDissatisfactionReasonFromFields,
    normalizeBitableDateValue,
    normalizeCanonicalStoreName,
    extractBitableFieldText,
  } = deps;

  log.info(`[table_visit] processing ${records.length} records`);
  
  for (const record of records) {
    const fields = record.fields || {};
    
    // 解析桌访数据（根据实际字段调整）
    const tableVisitData = {
      recordId: record.record_id,
      createdTime: record.created_time,
      date: fields['记录日期'] || fields['提交时间'] || fields['日期'] || fields['营业日期'] || '',
      store: fields['门店'] || fields['所属门店'] || '',
      brand: fields['所属品牌'] || '',
      tableNumber: fields['桌号'] || '',
      customerCount: fields['就餐人数'] || fields['人数'] || 0,
      consumption: fields['消费金额'] || 0,
      hasReservation: fields['是否有预订'] || '',
      dissatisfactionDish: extractDissatisfactionDishFromFields(fields),
      remarks: fields['备注'] || '',
      submitter: fields['提交人'] || '',
      fields
    };
    
    log.info(`[table_visit] new record:`, tableVisitData);
    
    // 存储到数据库
    try {
      await pool().query(`
        INSERT INTO agent_messages (direction, channel, feishu_open_id, sender_username, sender_name, sender_role, routed_to, content_type, content, agent_data, record_id, tenant_id)
        VALUES ('in','feishu',$1,$2,$3,$4,'ops_supervisor','table_visit',$5,$6::jsonb,$7,$8)
        ON CONFLICT (record_id, content_type) WHERE record_id IS NOT NULL AND record_id != ''
        DO UPDATE SET content = EXCLUDED.content, agent_data = EXCLUDED.agent_data, updated_at = NOW()
      `, [
        tableVisitData.submitter?.id || '',
        tableVisitData.submitter?.name || '',
        tableVisitData.submitter?.name || '',
        'table_visit_submitter',
        `桌访数据提交 - ${tableVisitData.store} 桌${tableVisitData.tableNumber}`,
        JSON.stringify(tableVisitData),
        tableVisitData.recordId,
        resolveTenantIdDefault()
      ]);
      
      log.info(`[table_visit] saved record: ${tableVisitData.recordId}`);

      // 稳定同步：同时写入结构化表，便于BI精确查询
      const visitDate = normalizeBitableDateValue(
        fields['记录日期'] || fields['提交时间'] || fields['日期'] || fields['营业日期'],
        record.created_time
      );
      const visitStore = normalizeCanonicalStoreName(String(fields['门店'] || fields['所属门店'] || '').trim());
      if (visitDate && visitStore) {
        const rushText = String(extractBitableFieldText(fields['今天催菜内容']) || '').trim();
        await pool().query(
          `INSERT INTO table_visit_records (
            date, store, brand, table_number, guest_count, amount,
            has_reservation, dissatisfaction_dish, unsatisfied_items, feedback,
            rush_dish_content,
            feishu_record_id, updated_at, tenant_id
          ) VALUES (
            $1::date,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,
            $11,$12,NOW(),$13
          )
          ON CONFLICT (feishu_record_id, tenant_id) DO UPDATE SET
            date = EXCLUDED.date,
            store = EXCLUDED.store,
            brand = EXCLUDED.brand,
            table_number = EXCLUDED.table_number,
            guest_count = EXCLUDED.guest_count,
            amount = EXCLUDED.amount,
            has_reservation = EXCLUDED.has_reservation,
            dissatisfaction_dish = EXCLUDED.dissatisfaction_dish,
            unsatisfied_items = EXCLUDED.unsatisfied_items,
            feedback = EXCLUDED.feedback,
            rush_dish_content = EXCLUDED.rush_dish_content,
            updated_at = NOW()`,
          [
            visitDate,
            visitStore,
            String(fields['所属品牌'] || fields['品牌'] || '').trim(),
            String(fields['桌号'] || '').trim(),
            Number(fields['就餐人数'] || fields['人数'] || 0) || 0,
            Number(fields['消费金额'] || 0) || 0,
            String(fields['是否有预订'] || '').includes('是'),
            extractDissatisfactionDishFromFields(fields),
            extractDissatisfactionReasonFromFields(fields),
            String(fields['备注'] || '').trim(),
            rushText || null,
            String(record.record_id || '').trim(),
            resolveTenantIdDefault()
          ]
        );
      }
    } catch (e) {
      // 忽略重复记录错误
      if (!e?.message?.includes('duplicate')) {
        log.error(`[table_visit] save failed for ${tableVisitData.recordId}:`, e?.message);
      }
    }
  }
}

export async function processBadReviewData(deps, records) {
  const {
    pool,
    log,
    normalizeCanonicalStoreName,
  } = deps;

  for (const record of records) {
    try {
      const fields = record.fields || {};
      const recordId = record.record_id;
      const createdTime = record.created_time;
      const dateVal = fields['差评日期'] || fields['创建日期'] || createdTime;
      
      const tableData = {
        recordId: recordId,
        date: dateVal,
        store: normalizeCanonicalStoreName(String(fields['差评门店'] || fields['门店'] || fields['所属门店'] || '').trim()),
        platform: Array.isArray(fields['差评平台']) ? fields['差评平台'].join(',') : (fields['差评平台'] || ''),
        product: fields['差评产品'] || '',
        reason: fields['差评原因'] || '',
        keywords: fields['差评关键词'] || '',
        rating: fields['星级'] || '',
        extractedInfo: fields['提取信息'] || ''
      };
      
      await pool().query(`
        WITH updated AS (
          UPDATE agent_messages
          SET content = $1,
              agent_data = $2::jsonb,
              updated_at = CURRENT_TIMESTAMP
          WHERE record_id = $3
            AND content_type = 'negative_review'
            AND tenant_id = $4
          RETURNING id
        )
        INSERT INTO agent_messages (direction, channel, content_type, content, agent_data, record_id, tenant_id)
        SELECT 'in','feishu','negative_review',$1,$2::jsonb,$3,$4
        WHERE NOT EXISTS (SELECT 1 FROM updated)
      `, [
        `差评记录 - ${tableData.store}`,
        JSON.stringify(tableData),
        recordId,
        resolveTenantIdDefault()
      ]);
    } catch(e) {
      log.error('[bitable] bad review process error:', e?.message);
    }
  }
}

// 检查表数据处理（保持原有逻辑）

export async function processChecklistData(deps, records) {
  const {
    log,
  } = deps;

  log.info(`[checklist] processing ${records.length} records`);
  // ... 原有的检查表处理逻辑
}

// 根据配置类型处理数据

export async function processGenericData(deps, records, configKey) {
  const {
    pool,
    log,
  } = deps;

  for (const record of records) {
    log.info(`[bitable][${configKey}] generic record:`, record.record_id);
    
    try {
      await pool().query(`
        WITH updated AS (
          UPDATE agent_messages
          SET content = $1,
              agent_data = $2::jsonb,
              updated_at = NOW()
          WHERE record_id = $3
            AND content_type = 'generic_bitable'
            AND tenant_id = $4
          RETURNING id
        )
        INSERT INTO agent_messages (direction, channel, content_type, content, agent_data, record_id, tenant_id)
        SELECT 'in','feishu','generic_bitable',$1,$2::jsonb,$3,$4
        WHERE NOT EXISTS (SELECT 1 FROM updated)
      `, [
        `通用数据 - ${configKey}`,
        JSON.stringify({ configKey, recordId: record.record_id, fields: record.fields }),
        record.record_id,
        resolveTenantIdDefault()
      ]);
    } catch (e) {
      log.error(`[bitable][${configKey}] save generic record failed:`, e?.message);
    }
  }
}

// 收档报告数据处理

export async function processClosingReportData(deps, records) {
  const {
    pool,
    log,
  } = deps;

  for (const record of records) {
    log.info(`[bitable] closing report record:`, record.record_id);
    
    try {
      const fields = record.fields || {};
      await pool().query(`
        WITH updated AS (
          UPDATE agent_messages
          SET content = $1,
              agent_data = $2::jsonb,
              updated_at = CURRENT_TIMESTAMP
          WHERE record_id = $3
            AND content_type = 'closing_report'
            AND tenant_id = $4
          RETURNING id
        )
        INSERT INTO agent_messages (direction, channel, content_type, content, agent_data, record_id, tenant_id)
        SELECT 'in','feishu','closing_report',$1,$2::jsonb,$3,$4
        WHERE NOT EXISTS (SELECT 1 FROM updated)
      `, [
        '收档报告',
        JSON.stringify({ 
          type: 'closing_report', 
          recordId: record.record_id, 
          fields: {
            store: fields['门店'],
            date: fields['日期'],
            station: fields['档口'],
            responsible: fields['本档口值班负责人'],
            handover_time: fields['交接时间'],
            inventory_check: fields['本档口库存检查'],
            cleaning_status: fields['本档口清洁卫生'],
            equipment_status: fields['设备使用情况'],
            temperature_record: fields['温度记录'],
            handover_person: fields['交接人'],
            handover_receiver: fields['接收人'],
            issues: fields['异常情况说明'],
            submit_time: fields['提交时间']
          }
        }),
        record.record_id,
        resolveTenantIdDefault()
      ]);
    } catch (e) {
      log.error(`[bitable] save closing report record failed:`, e?.message);
    }
  }
}

// 开档报告数据处理

export async function processOpeningReportData(deps, records) {
  const {
    pool,
    log,
  } = deps;

  for (const record of records) {
    log.info(`[bitable] opening report record:`, record.record_id);
    
    try {
      const fields = record.fields || {};
      await pool().query(`
        WITH updated AS (
          UPDATE agent_messages
          SET content = $1,
              agent_data = $2::jsonb,
              updated_at = CURRENT_TIMESTAMP
          WHERE record_id = $3
            AND content_type = 'opening_report'
            AND tenant_id = $4
          RETURNING id
        )
        INSERT INTO agent_messages (direction, channel, content_type, content, agent_data, record_id, tenant_id)
        SELECT 'in','feishu','opening_report',$1,$2::jsonb,$3,$4
        WHERE NOT EXISTS (SELECT 1 FROM updated)
      `, [
        '开档报告',
        JSON.stringify({ 
          type: 'opening_report', 
          recordId: record.record_id, 
          fields: {
            store: fields['门店'],
            date: fields['日期'],
            station: fields['档口'],
            responsible: fields['本档口值班负责人'],
            preparation_time: fields['开档时间'],
            inventory_check: fields['本档口库存检查'],
            cleaning_status: fields['本档口清洁卫生'],
            equipment_status: fields['设备使用情况'],
            temperature_check: fields['温度检查'],
            staff_ready: fields['人员准备情况'],
            issues: fields['异常情况说明'],
            submit_time: fields['提交时间']
          }
        }),
        record.record_id,
        resolveTenantIdDefault()
      ]);
    } catch (e) {
      log.error(`[bitable] save opening report record failed:`, e?.message);
    }
  }
}

// 例会报告数据处理

export async function processMeetingReportData(deps, records) {
  const {
    pool,
    log,
  } = deps;

  for (const record of records) {
    log.info(`[bitable] meeting report record:`, record.record_id);
    
    try {
      const fields = record.fields || {};
      await pool().query(`
        WITH updated AS (
          UPDATE agent_messages
          SET content = $1,
              agent_data = $2::jsonb,
              updated_at = CURRENT_TIMESTAMP
          WHERE record_id = $3
            AND content_type = 'meeting_report'
            AND tenant_id = $4
          RETURNING id
        )
        INSERT INTO agent_messages (direction, channel, content_type, content, agent_data, record_id, tenant_id)
        SELECT 'in','feishu','meeting_report',$1,$2::jsonb,$3,$4
        WHERE NOT EXISTS (SELECT 1 FROM updated)
      `, [
        '例会报告',
        JSON.stringify({ 
          type: 'meeting_report', 
          recordId: record.record_id, 
          fields: {
            store: fields['门店'],
            date: fields['日期'],
            meeting_type: fields['会议类型'],
            organizer: fields['组织人'],
            participants: fields['参会人员'],
            meeting_time: fields['会议时间'],
            duration: fields['会议时长'],
            topics: fields['会议议题'],
            decisions: fields['决议事项'],
            action_items: fields['行动项'],
            next_meeting: fields['下次会议时间'],
            submit_time: fields['提交时间']
          }
        }),
        record.record_id,
        resolveTenantIdDefault()
      ]);
    } catch (e) {
      log.error(`[bitable] save meeting report record failed:`, e?.message);
    }
  }
}

// 原料收货报告数据处理

export async function processMaterialReportData(deps, records, brand) {
  const {
    pool,
    log,
  } = deps;

  for (const record of records) {
    log.info(`[bitable] material report record (${brand}):`, record.record_id);
    
    try {
      const fields = record.fields || {};
      await pool().query(`
        WITH updated AS (
          UPDATE agent_messages
          SET content = $1,
              agent_data = $2::jsonb,
              updated_at = CURRENT_TIMESTAMP
          WHERE record_id = $3
            AND content_type = 'material_report'
            AND tenant_id = $4
          RETURNING id
        )
        INSERT INTO agent_messages (direction, channel, content_type, content, agent_data, record_id, tenant_id)
        SELECT 'in','feishu','material_report',$1,$2::jsonb,$3,$4
        WHERE NOT EXISTS (SELECT 1 FROM updated)
      `, [
        `${brand}原料收货日报`,
        JSON.stringify({ 
          type: 'material_report', 
          recordId: record.record_id, 
          brand: brand,
          fields: {
            store: fields['门店'],
            date: fields['日期'],
            material_name: fields['原料名称'],
            supplier: fields['供应商'],
            quantity: fields['数量'],
            unit: fields['单位'],
            unit_price: fields['单价'],
            total_price: fields['总价'],
            quality_check: fields['质量检查'],
            storage_location: fields['存储位置'],
            receiver: fields['收货人'],
            delivery_person: fields['送货人'],
            notes: fields['备注'],
            submit_time: fields['提交时间']
          }
        }),
        record.record_id,
        resolveTenantIdDefault()
      ]);
    } catch (e) {
      log.error(`[bitable] save material report record failed:`, e?.message);
    }
  }
}
