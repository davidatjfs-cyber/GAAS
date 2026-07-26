/** Split from growth-phases.js ensurePhaseTables — P5.4. */

export async function ensureGrowthPhaseTables_1_4(pool) {
// Phase 1: growth_coupons + sync_failures
await pool.query(`
  CREATE TABLE IF NOT EXISTS growth_coupons (
    id BIGSERIAL PRIMARY KEY, coupon_id TEXT UNIQUE NOT NULL,
    name TEXT, type TEXT DEFAULT 'cash', value_fen INTEGER DEFAULT 0,
    price_fen INTEGER DEFAULT 0, valid_days INTEGER DEFAULT 30,
    stock INTEGER DEFAULT -1, usage_rule TEXT, dish_name TEXT,
    is_active BOOLEAN DEFAULT TRUE, store_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS growth_sync_failures (
    id BIGSERIAL PRIMARY KEY, source TEXT DEFAULT 'miniprogram',
    event_type TEXT, payload JSONB DEFAULT '{}'::jsonb, error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_sync_failures_created ON growth_sync_failures (created_at DESC)`);

// Phase 2: wechat_work_customers
await pool.query(`
  CREATE TABLE IF NOT EXISTS wechat_work_customers (
    id BIGSERIAL PRIMARY KEY, external_userid TEXT, name TEXT, phone TEXT,
    store_id TEXT, note TEXT, bind_customer_id BIGINT,
    import_batch TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_ww_store ON wechat_work_customers (store_id, created_at DESC)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_ww_phone ON wechat_work_customers (phone) WHERE phone IS NOT NULL AND phone <> ''`);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ww_external_userid ON wechat_work_customers (external_userid) WHERE external_userid IS NOT NULL AND external_userid <> ''`);

// Phase 3: campaign_plans
await pool.query(`
  CREATE TABLE IF NOT EXISTS growth_campaign_plans (
    id BIGSERIAL PRIMARY KEY, plan_id TEXT UNIQUE, store_id TEXT,
    campaign_id TEXT, title TEXT NOT NULL, channel TEXT,
    voucher_template_id TEXT, target_audience TEXT DEFAULT 'all',
    coupon_value_fen INTEGER DEFAULT 0,
    budget_fen INTEGER DEFAULT 0, status TEXT DEFAULT 'draft',
    planned_start TIMESTAMPTZ, planned_end TIMESTAMPTZ,
    created_by TEXT DEFAULT 'admin', created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`ALTER TABLE growth_campaign_plans ADD COLUMN IF NOT EXISTS coupon_value_fen INTEGER DEFAULT 0`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_plans_store ON growth_campaign_plans (store_id, status, created_at DESC)`);

// Phase 4: A/B tests + learnings
await pool.query(`
  CREATE TABLE IF NOT EXISTS ab_test_tasks (
    id BIGSERIAL PRIMARY KEY,
    test_name TEXT NOT NULL,
    store_code TEXT,
    test_type TEXT NOT NULL,
    target_metric TEXT NOT NULL,
    variant_a JSONB NOT NULL,
    variant_b JSONB NOT NULL,
    rotation_config JSONB DEFAULT '{"method":"time","a_days":[1,2,3],"b_days":[4,5,6,0]}'::jsonb,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    min_sample_size INTEGER DEFAULT 30,
    winner TEXT,
    winner_lift NUMERIC(5,2),
    ai_summary TEXT,
    status TEXT DEFAULT 'running',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_ab_test_tasks_store_status ON ab_test_tasks (store_code, status, created_at DESC)`);
// 闭环回路：记录该测试胜出变体已被采用为哪条自动营销规则（rule_key），供前端展示「已采用」。
await pool.query(`ALTER TABLE ab_test_tasks ADD COLUMN IF NOT EXISTS promoted_rule_key TEXT`).catch(() => {});
// 绑定模式：A/B 测试必须绑定一条已有的可投放规则（规则引擎 touch_rule / 支付发券 payment_rule）。
// target_kind ∈ {'touch_rule','payment_rule'}；target_rule_key = 被绑定规则的 rule_key。
// 绑定测试的结果走「手动录入」聚合（ab_test_results 累加），不走 POS 归因（POS 归因仅留给 price_test）。
await pool.query(`ALTER TABLE ab_test_tasks ADD COLUMN IF NOT EXISTS target_kind TEXT`).catch(() => {});
await pool.query(`ALTER TABLE ab_test_tasks ADD COLUMN IF NOT EXISTS target_rule_key TEXT`).catch(() => {});
// 模板化：mode('bound'|'channel') + 渠道 + 模板key + 指标schema快照(字段/主指标/辅助指标)。
await pool.query(`ALTER TABLE ab_test_tasks ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'bound'`).catch(() => {});
await pool.query(`ALTER TABLE ab_test_tasks ADD COLUMN IF NOT EXISTS channel TEXT`).catch(() => {});
await pool.query(`ALTER TABLE ab_test_tasks ADD COLUMN IF NOT EXISTS template_key TEXT`).catch(() => {});
await pool.query(`ALTER TABLE ab_test_tasks ADD COLUMN IF NOT EXISTS metrics_schema JSONB`).catch(() => {});
await pool.query(`
  CREATE TABLE IF NOT EXISTS ab_test_results (
    id BIGSERIAL PRIMARY KEY,
    test_id BIGINT REFERENCES ab_test_tasks(id) ON DELETE CASCADE,
    result_date DATE NOT NULL,
    variant TEXT NOT NULL,
    sent INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    orders INTEGER DEFAULT 0,
    redemptions INTEGER DEFAULT 0,
    revenue NUMERIC(10,2) DEFAULT 0,
    conversion_rate NUMERIC(6,4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(test_id, result_date, variant)
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_ab_test_results_test_date ON ab_test_results (test_id, result_date DESC, variant)`);
// 模板化：任意渠道字段以 JSON 存放（固定列仅保留给旧的 POS 归因/price_test 路径）。
await pool.query(`ALTER TABLE ab_test_results ADD COLUMN IF NOT EXISTS metrics_json JSONB`).catch(() => {});
await pool.query(`
  CREATE TABLE IF NOT EXISTS growth_learnings (
    id BIGSERIAL PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT,
    store_code TEXT,
    channel TEXT,
    scene TEXT,
    audience_tag TEXT,
    variable TEXT NOT NULL,
    winning_value TEXT NOT NULL,
    losing_value TEXT,
    effect_desc TEXT,
    sample_size INTEGER,
    confidence TEXT DEFAULT 'medium',
    valid_until DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_learnings_store ON growth_learnings (store_code, channel, created_at DESC)`);
}

export async function ensureGrowthPhaseTables_5_8(pool) {
// Phase 5: content suggestions + performance
await pool.query(`
  CREATE TABLE IF NOT EXISTS content_performance (
    id BIGSERIAL PRIMARY KEY,
    content_key TEXT UNIQUE,
    suggestion_id BIGINT,
    store_code TEXT,
    channel TEXT NOT NULL,
    scene TEXT,
    audience_tag TEXT,
    variable TEXT,
    content_title TEXT,
    content_body TEXT,
    winning_value TEXT,
    losing_value TEXT,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    orders INTEGER DEFAULT 0,
    redemptions INTEGER DEFAULT 0,
    revenue NUMERIC(10,2) DEFAULT 0,
    notes TEXT,
    recorded_by TEXT,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS content_key TEXT`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS suggestion_id BIGINT`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS scene TEXT`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS audience_tag TEXT`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS variable TEXT`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS content_body TEXT`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS winning_value TEXT`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS losing_value TEXT`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS redemptions INTEGER DEFAULT 0`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS revenue NUMERIC(10,2) DEFAULT 0`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS recorded_by TEXT`);
await pool.query(`ALTER TABLE content_performance ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_content_performance_key ON content_performance (content_key) WHERE content_key IS NOT NULL AND content_key <> ''`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_content_performance_store ON content_performance (store_code, channel, created_at DESC)`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS growth_content_suggestions (
    id BIGSERIAL PRIMARY KEY,
    suggestion_key TEXT UNIQUE NOT NULL,
    week_start DATE NOT NULL,
    store_code TEXT,
    summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    feishu_pushed_at TIMESTAMPTZ,
    generated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_growth_content_suggestions_week ON growth_content_suggestions (week_start DESC, store_code)`);

// Phase 6: unique dedup index on growth_learnings so ON CONFLICT works properly
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_growth_learnings_source
  ON growth_learnings (source_type, source_id)
  WHERE source_id IS NOT NULL AND source_id <> ''`);

// Phase 6b: verified flag — manual/seed data defaults false; real execution results are true
await pool.query(`ALTER TABLE growth_learnings ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT false`);

// Phase 7a: churn predictions
await pool.query(`
  CREATE TABLE IF NOT EXISTS growth_churn_predictions (
    id BIGSERIAL PRIMARY KEY,
    prediction_date DATE NOT NULL,
    store_code TEXT NOT NULL DEFAULT '',
    customer_id BIGINT NOT NULL,
    phone TEXT,
    customer_name TEXT,
    churn_score INTEGER DEFAULT 100,
    risk_level TEXT,
    factors JSONB DEFAULT '[]'::jsonb,
    last_visit_days INTEGER,
    avg_visit_cycle_days INTEGER,
    spend_trend_pct NUMERIC(6,2),
    visit_trend INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(prediction_date, store_code, customer_id)
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_churn_predictions_date_risk ON growth_churn_predictions (prediction_date DESC, store_code, risk_level)`);

// Phase 7b: menu health reports
await pool.query(`
  CREATE TABLE IF NOT EXISTS growth_menu_health_reports (
    id BIGSERIAL PRIMARY KEY,
    report_month TEXT NOT NULL,
    store_code TEXT NOT NULL DEFAULT '',
    report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    generated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(report_month, store_code)
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_menu_health_month ON growth_menu_health_reports (report_month DESC, store_code)`);

// Phase 8: content_calendar
await pool.query(`
  CREATE TABLE IF NOT EXISTS growth_content_calendar (
    id BIGSERIAL PRIMARY KEY, item_id TEXT UNIQUE, store_id TEXT,
    channel TEXT NOT NULL, publish_date DATE NOT NULL, title TEXT NOT NULL,
    content_brief TEXT, copy_text TEXT, image_url TEXT, campaign_id TEXT,
    qr_scene TEXT, status TEXT DEFAULT 'draft', assignee_username TEXT,
    result_scan_count INTEGER DEFAULT 0, result_revenue_fen INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_calendar_date ON growth_content_calendar (publish_date, store_id, channel)`);
}

export async function ensureGrowthPhaseTables_9(pool) {
// Phase 9: POS orders (from KeruYun via Feishu bitable)
// Column order matches KeruYun export: 编号,订单号,订单来源,营业日,下单时间,结账时间,订单状态,折前金额,总优惠金额,折后金额,支付方式,支付笔数,会员姓名,会员手机号,订单类型,桌台,就餐人数,就餐时长,+门店名称
await pool.query(`
  CREATE TABLE IF NOT EXISTS pos_orders (
    id BIGSERIAL PRIMARY KEY,
    seq_no TEXT,
    order_no TEXT NOT NULL,
    order_source TEXT,
    biz_date DATE,
    order_time TIMESTAMPTZ,
    checkout_time TIMESTAMPTZ,
    order_status TEXT,
    amount_before_discount NUMERIC DEFAULT 0,
    total_discount NUMERIC DEFAULT 0,
    amount_after_discount NUMERIC DEFAULT 0,
    payment_method TEXT,
    payment_count INTEGER DEFAULT 0,
    member_name TEXT,
    phone TEXT,
    order_type TEXT,
    table_no TEXT,
    diners INTEGER,
    duration TEXT,
    store_name TEXT,
    customer_id BIGINT,
    store_id TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_orders_no ON pos_orders (order_no)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_phone ON pos_orders (phone) WHERE phone IS NOT NULL AND phone <> ''`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_date ON pos_orders (biz_date DESC, store_id)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_customer ON pos_orders (customer_id) WHERE customer_id IS NOT NULL`);
await pool.query(`ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(80) NOT NULL DEFAULT 'default'`);
await pool.query(`ALTER TABLE pos_orders ADD COLUMN IF NOT EXISTS coupon_id TEXT`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_orders_coupon ON pos_orders (tenant_id, coupon_id) WHERE coupon_id IS NOT NULL AND coupon_id <> ''`);

// Column order matches KeruYun export: 营业日,门店编号,门店名称,订单号,商品编码,商品名称,规格,菜品标签,单价,数量,单位,前折金额,服务费分摊,菜品优惠,折后金额,商品中类,商品大类
await pool.query(`
  CREATE TABLE IF NOT EXISTS pos_order_items (
    id BIGSERIAL PRIMARY KEY,
    biz_date DATE,
    store_code TEXT,
    store_name TEXT,
    order_no TEXT NOT NULL,
    sku TEXT,
    dish_name TEXT,
    spec TEXT,
    tags TEXT,
    unit_price NUMERIC DEFAULT 0,
    qty NUMERIC DEFAULT 0,
    unit TEXT,
    amount_before_discount NUMERIC DEFAULT 0,
    service_fee NUMERIC DEFAULT 0,
    discount NUMERIC DEFAULT 0,
    amount_after_discount NUMERIC DEFAULT 0,
    category_mid TEXT,
    category TEXT,
    synced_at TIMESTAMPTZ DEFAULT NOW()
  )
`);
await pool.query(`
  DELETE FROM pos_order_items a
  USING pos_order_items b
  WHERE a.id > b.id
    AND a.biz_date IS NOT DISTINCT FROM b.biz_date
    AND a.store_code IS NOT DISTINCT FROM b.store_code
    AND a.order_no = b.order_no
    AND a.sku IS NOT DISTINCT FROM b.sku
    AND a.dish_name IS NOT DISTINCT FROM b.dish_name
    AND a.spec IS NOT DISTINCT FROM b.spec
    AND a.tags IS NOT DISTINCT FROM b.tags
    AND a.unit_price IS NOT DISTINCT FROM b.unit_price
    AND a.qty IS NOT DISTINCT FROM b.qty
    AND a.unit IS NOT DISTINCT FROM b.unit
    AND a.amount_before_discount IS NOT DISTINCT FROM b.amount_before_discount
    AND a.service_fee IS NOT DISTINCT FROM b.service_fee
    AND a.discount IS NOT DISTINCT FROM b.discount
    AND a.amount_after_discount IS NOT DISTINCT FROM b.amount_after_discount
    AND a.category_mid IS NOT DISTINCT FROM b.category_mid
    AND a.category IS NOT DISTINCT FROM b.category
`);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_items_dedupe ON pos_order_items (
  order_no,
  biz_date,
  store_code,
  COALESCE(sku, ''),
  COALESCE(dish_name, ''),
  COALESCE(spec, ''),
  COALESCE(tags, ''),
  unit_price,
  qty,
  COALESCE(unit, ''),
  amount_before_discount,
  service_fee,
  discount,
  amount_after_discount,
  COALESCE(category_mid, ''),
  COALESCE(category, '')
)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_items_order ON pos_order_items (order_no)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_items_dish ON pos_order_items (dish_name)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_pos_items_cat ON pos_order_items (category) WHERE category IS NOT NULL`);
}
