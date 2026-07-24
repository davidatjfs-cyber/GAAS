export async function ensureFeishuGenericRecordsTable(pool) {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists feishu_generic_records (
        id uuid primary key default gen_random_uuid(),
        app_token varchar(100) not null,
        table_id varchar(100) not null,
        record_id varchar(100) not null,
        config_key varchar(60),
        fields jsonb,
        raw jsonb,
        created_at timestamp default current_timestamp,
        updated_at timestamp default current_timestamp,
        unique (app_token, table_id, record_id)
      )`
    );
    await pool.query('alter table feishu_generic_records add column if not exists config_key varchar(60)');
    await pool.query('create index if not exists idx_feishu_generic_table on feishu_generic_records (app_token, table_id, updated_at desc)');
    await pool.query('create index if not exists idx_feishu_generic_record on feishu_generic_records (record_id)');
    await pool.query('create index if not exists idx_feishu_generic_config on feishu_generic_records (config_key, updated_at desc)');
  } catch (e) {
    console.error('[ensureFeishuGenericRecordsTable] Error:', e?.message || e);
    throw e;
  }
}

/**
 * 库级 NOTIFY：凡写入 feishu_generic_records（含 HRMS Webhook / Agent 轮询）且 fields/raw/config_key 实质变化即通知，
 * 与 HRMS LISTEN channel `bitable_records_updated` 对齐；payload 为 config_key 或兜底 table_id。
 */
export async function ensureFeishuGenericRecordsNotifyTrigger(pool, notifyAdminsDualWriteFailure) {
  // 注意：不能把 TG_OP 写在触发器 WHEN (...) 里 —— WHEN 是 SQL 表达式，会把 TG_OP 当成列名 tg_op 而报错。
  // 插入/更新是否实质变化在函数体内用 TG_OP / OLD / NEW 判断。
  const fnSql = `
CREATE OR REPLACE FUNCTION feishu_generic_records_bitable_notify() RETURNS trigger AS $$
DECLARE
  pl text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (
      OLD.fields IS DISTINCT FROM NEW.fields
      OR OLD.raw IS DISTINCT FROM NEW.raw
      OR OLD.config_key IS DISTINCT FROM NEW.config_key
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  pl := COALESCE(NULLIF(BTRIM(COALESCE(NEW.config_key, '')), ''), NULLIF(BTRIM(COALESCE(NEW.table_id, '')), ''));
  IF pl IS NULL OR pl = '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_notify('bitable_records_updated', pl);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`;
  const dropSql = 'DROP TRIGGER IF EXISTS trg_feishu_generic_records_bitable_notify ON feishu_generic_records';
  const trigBody = `
AFTER INSERT OR UPDATE OF fields, raw, config_key ON feishu_generic_records
FOR EACH ROW`;
  try {
    await pool.query(fnSql);
    await pool.query(dropSql);
    try {
      await pool.query(
        `CREATE TRIGGER trg_feishu_generic_records_bitable_notify ${trigBody} EXECUTE FUNCTION feishu_generic_records_bitable_notify();`
      );
    } catch (e1) {
      await pool.query(
        `CREATE TRIGGER trg_feishu_generic_records_bitable_notify ${trigBody} EXECUTE PROCEDURE feishu_generic_records_bitable_notify();`
      );
    }
    console.log('[schema] feishu_generic_records → pg_notify(bitable_records_updated) trigger ready');
  } catch (e) {
    console.error('[ensureFeishuGenericRecordsNotifyTrigger] Error:', e?.message || e);
    void notifyAdminsDualWriteFailure('feishu_generic_records（NOTIFY 触发器安装/更新失败）', e);
    throw e;
  }
}

export async function ensureFeishuSyncTable(pool, safeErrMessage) {
  try {
    await pool.query('create extension if not exists pgcrypto');
    await pool.query(
      `create table if not exists feishu_sync_logs (
        id uuid primary key default gen_random_uuid(),
        event_type varchar(50) not null,
        table_id varchar(100) not null,
        record_id varchar(100),
        data jsonb,
        sync_status varchar(20) not null default 'pending',
        error_message text,
        created_at timestamp default current_timestamp,
        processed_at timestamp
      )`
    );
    await pool.query(`create index if not exists idx_feishu_sync_status on feishu_sync_logs (sync_status)`);
    await pool.query(`create index if not exists idx_feishu_sync_table on feishu_sync_logs (table_id, created_at)`);
  } catch (e) {
    if (safeErrMessage(e).includes('already exists')) return;
    console.error('[ensureFeishuSyncTable] Error:', e?.message || e);
    throw e;
  }
}

// ─── Dedup: unique partial index on agent_messages ───────────────────────────
export async function ensureDedupIndexes(pool) {
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_messages_record_content
      ON agent_messages (record_id, content_type)
      WHERE record_id IS NOT NULL AND record_id != ''`);
  } catch (e) {
    // If duplicates already exist, clean them first then retry
    if (/duplicate key|could not create unique index/i.test(String(e?.message || ''))) {
      console.log('[dedup] cleaning existing duplicates in agent_messages...');
      try {
        await pool.query(`
          DELETE FROM agent_messages a USING agent_messages b
          WHERE a.record_id IS NOT NULL AND a.record_id != ''
            AND a.record_id = b.record_id AND a.content_type = b.content_type
            AND a.created_at < b.created_at`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_messages_record_content
          ON agent_messages (record_id, content_type)
          WHERE record_id IS NOT NULL AND record_id != ''`);
        console.log('[dedup] agent_messages unique index created after cleanup');
      } catch (e2) {
        console.warn('[dedup] could not create unique index:', e2?.message);
      }
    } else {
      console.warn('[dedup] index creation skipped:', e?.message);
    }
  }
}

export async function ensureTableVisitRecordsTable(pool, safeErrMessage) {
  try {
    await pool.query('create extension if not exists pgcrypto');

    // 首先检查表是否存在
    const tableExists = await pool.query(`
      select exists (
        select from information_schema.tables
        where table_schema = 'public'
        and table_name = 'table_visit_records'
      )
    `);

    if (!tableExists.rows[0].exists) {
      // 表不存在，创建完整的新表
      await pool.query(
        `create table table_visit_records (
          id uuid primary key default gen_random_uuid(),
          date date not null,
          store varchar(200) not null,
          brand varchar(120),
          table_number varchar(20),
          guest_count int default 0,
          amount decimal(10,2) default 0,
          has_reservation boolean default false,
          dissatisfaction_dish text,
          feedback text,

          -- 扩展字段（供agent分析使用）
          reservation_time time,
          customer_type varchar(50),
          order_type varchar(50),
          service_rating int default 0,
          food_rating int default 0,
          environment_rating int default 0,
          waiter_name varchar(100),
          promotion_info text,
          weather varchar(50),
          peak_hours boolean default false,
          customer_complaint text,
          complaint_resolution text,
          satisfaction_level varchar(20),
          repeat_customer boolean default false,
          special_requests text,
          payment_method varchar(50),
          order_duration int default 0,
          table_turnover int default 0,
          dish_recommendations text,
          allergic_info text,
          celebration_type varchar(50),
          visit_purpose varchar(100),
          companion_info text,
          customer_age varchar(20),
          customer_gender varchar(10),
          visit_frequency varchar(50),
          preferred_dishes text,
          unsatisfied_items text,
          suggested_improvements text,
          staff_performance text,
          facility_issues text,
          hygiene_rating int default 0,
          value_rating int default 0,
          ambiance_rating int default 0,
          noise_level varchar(20),
          temperature varchar(20),
          lighting varchar(20),
          music_volume varchar(20),
          seating_comfort varchar(20),
          queue_time int default 0,
          service_speed varchar(20),
          order_accuracy varchar(20),
          staff_attitude varchar(20),
          problem_resolution text,
          manager_intervention boolean default false,
          compensation_provided text,
          follow_up_required boolean default false,
          follow_up_details text,
          additional_notes text,

          feishu_record_id varchar(100) unique,
          created_at timestamp default current_timestamp,
          updated_at timestamp default current_timestamp
        )`
      );
    } else {
      // 表已存在，检查并添加缺失的字段
      const existingColumns = await pool.query(`
        select column_name, data_type
        from information_schema.columns
        where table_schema = 'public'
        and table_name = 'table_visit_records'
      `);
      const columnNames = existingColumns.rows.map(row => row.column_name);

      // 需要添加的字段定义
      const newColumns = [
        { name: 'reservation_time', type: 'time' },
        { name: 'customer_type', type: 'varchar(50)' },
        { name: 'order_type', type: 'varchar(50)' },
        { name: 'service_rating', type: 'int default 0' },
        { name: 'food_rating', type: 'int default 0' },
        { name: 'environment_rating', type: 'int default 0' },
        { name: 'waiter_name', type: 'varchar(100)' },
        { name: 'promotion_info', type: 'text' },
        { name: 'weather', type: 'varchar(50)' },
        { name: 'peak_hours', type: 'boolean default false' },
        { name: 'customer_complaint', type: 'text' },
        { name: 'complaint_resolution', type: 'text' },
        { name: 'satisfaction_level', type: 'varchar(20)' },
        { name: 'repeat_customer', type: 'boolean default false' },
        { name: 'special_requests', type: 'text' },
        { name: 'payment_method', type: 'varchar(50)' },
        { name: 'order_duration', type: 'int default 0' },
        { name: 'table_turnover', type: 'int default 0' },
        { name: 'dish_recommendations', type: 'text' },
        { name: 'allergic_info', type: 'text' },
        { name: 'celebration_type', type: 'varchar(50)' },
        { name: 'visit_purpose', type: 'varchar(100)' },
        { name: 'companion_info', type: 'text' },
        { name: 'customer_age', type: 'varchar(20)' },
        { name: 'customer_gender', type: 'varchar(10)' },
        { name: 'visit_frequency', type: 'varchar(50)' },
        { name: 'preferred_dishes', type: 'text' },
        { name: 'unsatisfied_items', type: 'text' },
        { name: 'suggested_improvements', type: 'text' },
        { name: 'staff_performance', type: 'text' },
        { name: 'facility_issues', type: 'text' },
        { name: 'hygiene_rating', type: 'int default 0' },
        { name: 'value_rating', type: 'int default 0' },
        { name: 'ambiance_rating', type: 'int default 0' },
        { name: 'noise_level', type: 'varchar(20)' },
        { name: 'temperature', type: 'varchar(20)' },
        { name: 'lighting', type: 'varchar(20)' },
        { name: 'music_volume', type: 'varchar(20)' },
        { name: 'seating_comfort', type: 'varchar(20)' },
        { name: 'queue_time', type: 'int default 0' },
        { name: 'service_speed', type: 'varchar(20)' },
        { name: 'order_accuracy', type: 'varchar(20)' },
        { name: 'staff_attitude', type: 'varchar(20)' },
        { name: 'problem_resolution', type: 'text' },
        { name: 'manager_intervention', type: 'boolean default false' },
        { name: 'compensation_provided', type: 'text' },
        { name: 'follow_up_required', type: 'boolean default false' },
        { name: 'follow_up_details', type: 'text' },
        { name: 'additional_notes', type: 'text' },
        { name: 'rush_dish_content', type: 'text' }
      ];

      for (const column of newColumns) {
        if (!columnNames.includes(column.name)) {
          try {
            await pool.query(`alter table table_visit_records add column ${column.name} ${column.type}`);
            console.log(`[ensureTableVisitRecordsTable] Added column: ${column.name}`);
          } catch (e) {
            console.log(`[ensureTableVisitRecordsTable] Failed to add column ${column.name}:`, e?.message || e);
          }
        }
      }
    }

    // 创建索引
    await pool.query(`create index if not exists idx_table_visit_date on table_visit_records (date)`);
    await pool.query(`create index if not exists idx_table_visit_store on table_visit_records (store)`);
    await pool.query(`create index if not exists idx_table_visit_feishu_id on table_visit_records (feishu_record_id)`);

    // 尝试创建新索引（如果字段存在的话）
    try {
      await pool.query(`create index if not exists idx_table_visit_satisfaction on table_visit_records (satisfaction_level)`);
    } catch (e) {
      console.log('[ensureTableVisitRecordsTable] Satisfaction index skipped (column may not exist)');
    }

    try {
      await pool.query(`create index if not exists idx_table_visit_rating on table_visit_records (service_rating, food_rating, environment_rating)`);
    } catch (e) {
      console.log('[ensureTableVisitRecordsTable] Rating index skipped (columns may not exist)');
    }

  } catch (e) {
    if (safeErrMessage(e).includes('already exists')) return;
    console.error('[ensureTableVisitRecordsTable] Error:', e?.message || e);
    throw e;
  }
}
