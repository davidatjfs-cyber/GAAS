import axios from 'axios';
import { executeGrowthActionRecord, resolveTenantIdForStore } from './growth-api.js';
import { getActiveTenantIds, tenantContext } from './utils/database.js';
import { refreshSalesGrowthSnapshot } from './domains/growth-pos/ingest.js';
import { registerGrowthAbRoutes } from './domains/growth-ab/routes.js';
import {
  evaluateAbTask,
  isAbManualInput,
  promoteAbWinner,
  refreshAbTestResults,
  safeDateOnly,
  todayShanghaiYmd,
} from './domains/growth-ab/service.js';
import { registerGrowthCouponRoutes } from './domains/growth-coupons/routes.js';
import { registerGrowthSyncFailureRoutes } from './domains/growth-sync-failures/routes.js';
import { registerGrowthWechatWorkRoutes } from './domains/growth-wechat-work/routes.js';
import { registerGrowthCampaignRoutes } from './domains/growth-campaigns/routes.js';
import { registerGrowthContentCalendarRoutes } from './domains/growth-content-calendar/routes.js';
import { registerGrowthContentRoutes } from './domains/growth-content/routes.js';
import {
  generateWeeklyContentSuggestion,
  pushWeeklySuggestionToFeishu,
} from './domains/growth-content/service.js';
import { registerGrowthPosRoutes } from './domains/growth-pos/routes.js';
import { registerGrowthChurnRoutes } from './domains/growth-churn/routes.js';
import { computeChurnScores } from './domains/growth-churn/service.js';
import { registerGrowthMenuHealthRoutes } from './domains/growth-menu-health/routes.js';
import { generateMenuHealthReport } from './domains/growth-menu-health/service.js';
import {
  authPhaseApi,
  cleanText,
  getPhaseApiTenantId,
} from './domains/growth-phase-auth.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'growth-phases' });


export async function ensurePhaseTables(pool) {
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

export { ingestPosOrders } from './domains/growth-pos/ingest.js';

/**
 * @param {import('express').Express} app
 * @param {any} pool
 * @param {{ getFeishuBitableData?: Function }} [deps]
 */
export function registerPhaseRoutes(app, pool, deps = {}) {
  function rqa(req, res) {
    const auth = authPhaseApi(req);
    if (!auth.ok) { res.status(auth.status).json({ ok: false, error: auth.error }); return false; }
    return true;
  }

  const phaseAuthDeps = {
    pool,
    requirePhaseAuth: rqa,
    getPhaseTenantId: getPhaseApiTenantId,
  };

  // Phase 1–3 → domains（#6：先测后搬；企微飞书依赖 getFeishuBitableData 注入，禁止反向 import index）
  registerGrowthCouponRoutes(app, phaseAuthDeps);
  registerGrowthSyncFailureRoutes(app, phaseAuthDeps);
  registerGrowthWechatWorkRoutes(app, {
    ...phaseAuthDeps,
    resolveTenantIdForStore,
    getFeishuBitableData:
      deps.getFeishuBitableData ||
      (async () => {
        throw new Error('getFeishuBitableData_not_injected');
      }),
  });
  registerGrowthCampaignRoutes(app, {
    ...phaseAuthDeps,
    executeGrowthActionRecord,
  });
  registerGrowthContentCalendarRoutes(app, phaseAuthDeps);
  registerGrowthContentRoutes(app, phaseAuthDeps);
  registerGrowthPosRoutes(app, phaseAuthDeps);
  registerGrowthChurnRoutes(app, phaseAuthDeps);
  registerGrowthMenuHealthRoutes(app, phaseAuthDeps);
  registerGrowthAbRoutes(app, phaseAuthDeps);

  let __growthAbCronLast = '';
  let __growthContentCronLast = '';
  let __growthChurnCronLast = '';
  let __growthMenuCronLast = '';
  let __growthSnapshotCronLast = '';
  if (!globalThis.__growthPhase45Timers) {
    globalThis.__growthPhase45Timers = true;
    setInterval(async () => {
      const nowYmd = todayShanghaiYmd();
      try {
        for (const taskTenantId of await getActiveTenantIds(pool)) {
          await tenantContext.run(taskTenantId, async () => {
            const running = await pool.query(`SELECT * FROM ab_test_tasks WHERE status = 'running' ORDER BY id DESC LIMIT 20`);
            for (const task of running.rows || []) {
            // 手动录入类(绑定模式 或 任何模板测试)跳过 POS 归因刷新；仅旧的 price_test 走自动归因。
            const manualInput = isAbManualInput(task);
            if (!manualInput) await refreshAbTestResults(pool, task, taskTenantId).catch(() => null);
            if (safeDateOnly(task.end_date) <= nowYmd) {
              const evaluated = await evaluateAbTask(pool, task, taskTenantId).catch(() => null);
              const evTask = evaluated?.task;
              // 测试期已满+判出明确赢家+尚未采用 → 自动写回正式规则并生效，闭环不再需要人工点击。
              if (evaluated?.finalized && evTask && evTask.status === 'completed' && !evTask.promoted_rule_key) {
                const w = String(evTask.winner || '').toUpperCase();
                if (w === 'A' || w === 'B') {
                  await promoteAbWinner(pool, evTask, 'auto', taskTenantId).catch((e) => log.warn({ msg: 'ab_auto_promote_failed', err: e?.message }));
                }
              }
            }
            }
          });
        }
      } catch (e) {
        log.warn({ msg: 'ab_cron_failed', err: e?.message });
      }
      try {
        const now = new Date(Date.now() + 8 * 3600000);
        const weekday = now.getUTCDay();
        const hour = now.getUTCHours();
        if (weekday === 1 && hour >= 1 && __growthContentCronLast !== nowYmd) {
          __growthContentCronLast = nowYmd;
          for (const storeTenantId of await getActiveTenantIds(pool)) {
            await tenantContext.run(storeTenantId, async () => {
              const stores = await pool.query(`SELECT DISTINCT store_code FROM pos_order_items WHERE biz_date >= CURRENT_DATE - INTERVAL '30 days' AND store_code IS NOT NULL AND store_code <> '' LIMIT 20`);
              for (const row of stores.rows || []) {
              const suggestion = await generateWeeklyContentSuggestion(pool, cleanText(row.store_code, 128), nowYmd, 'weekly_cron', storeTenantId).catch(() => null);
              if (suggestion) await pushWeeklySuggestionToFeishu(pool, suggestion).catch(() => null);
              }
            });
          }
        }
      } catch (e) {
        log.warn({ msg: 'weekly_content_cron_failed', err: e?.message });
      }
      // Phase 7a: weekly churn scoring (Monday 02:00 CST = UTC weekday 1, hour 18)
      try {
        const now = new Date(Date.now() + 8 * 3600000);
        const weekday = now.getUTCDay();
        const hour = now.getUTCHours();
        if (weekday === 1 && hour >= 18 && __growthChurnCronLast !== nowYmd) {
          __growthChurnCronLast = nowYmd;
          let totalStores = 0;
          for (const storeTenantId of await getActiveTenantIds(pool)) {
            await tenantContext.run(storeTenantId, async () => {
              const storeRows = await pool.query(
                `SELECT DISTINCT store_code FROM growth_churn_predictions
                  WHERE prediction_date >= CURRENT_DATE - INTERVAL '30 days'
                 UNION
                 SELECT DISTINCT COALESCE(gcp.store_id, gc.last_store_id, '') AS store_code
                   FROM growth_customer_profiles gcp
                   FULL JOIN growth_customers gc ON gc.id = gcp.customer_id
                  WHERE COALESCE(gcp.store_id, gc.last_store_id, '') <> ''
                  LIMIT 20`
              );
              totalStores += storeRows.rows.length;
              for (const row of storeRows.rows || []) {
                await computeChurnScores(pool, cleanText(row.store_code, 128), storeTenantId).catch(() => null);
              }
            }).catch(() => null);
          }
          log.info({ msg: 'weekly_churn_scores_computed', stores: totalStores });
        }
      } catch (e) {
        log.warn({ msg: 'churn_cron_failed', err: e?.message });
      }
      // Phase 7b: monthly menu health report (1st of month at 03:00 CST = UTC day 1 of month, hour 19)
      try {
        const now = new Date(Date.now() + 8 * 3600000);
        const dayOfMonth = now.getUTCDate();
        const hour = now.getUTCHours();
        const curMonth = nowYmd.slice(0, 7);
        if (dayOfMonth === 1 && hour >= 19 && __growthMenuCronLast !== curMonth) {
          __growthMenuCronLast = curMonth;
          let totalStores = 0;
          for (const storeTenantId of await getActiveTenantIds(pool)) {
            await tenantContext.run(storeTenantId, async () => {
              const storeRows = await pool.query(
                `SELECT DISTINCT store_code FROM pos_order_items
                  WHERE biz_date >= CURRENT_DATE - INTERVAL '60 days'
                    AND store_code IS NOT NULL AND store_code <> ''
                  LIMIT 20`
              );
              totalStores += storeRows.rows.length;
              for (const row of storeRows.rows || []) {
                await generateMenuHealthReport(pool, cleanText(row.store_code, 128), curMonth, storeTenantId).catch(() => null);
              }
            }).catch(() => null);
          }
          log.info({ msg: 'monthly_menu_health_reports_generated', stores: totalStores });
        }
      } catch (e) {
        log.warn({ msg: 'menu_health_cron_failed', err: e?.message });
      }
      // Daily snapshot safety-net: 02:15 CST = UTC 18:15 (runs even if pos-feishu-sync missed)
      try {
        const now = new Date(Date.now() + 8 * 3600000);
        const hour = now.getUTCHours();
        if (hour >= 18 && __growthSnapshotCronLast !== nowYmd) {
          __growthSnapshotCronLast = nowYmd;
          let totalRows = 0;
          for (const tenantId of await getActiveTenantIds(pool)) {
            const rows = await tenantContext.run(tenantId, () => refreshSalesGrowthSnapshot(pool, 3, tenantId)).catch(e => {
              log.error({ msg: 'snapshot_cron_tenant_error', tenant_id: tenantId, err: e.message });
              return 0;
            });
            totalRows += rows;
          }
          log.info({ msg: 'snapshot_daily_refresh', rows: totalRows });
        }
      } catch (e) {
        log.warn({ msg: 'snapshot_cron_failed', err: e?.message });
      }
    }, 10 * 60 * 1000);
  }

  // ── POS Feishu sync cron: daily at 01:10 Asia/Shanghai ──
  const POS_SYNC_CRON_KEY = 'pos_feishu_sync';
  let lastPosSyncDate = '';
  function shouldRunPosSync() {
    const now = new Date(Date.now() + 8 * 3600000);
    const today = now.toISOString().slice(0, 10);
    const hour = now.getUTCHours();
    return hour === 17 && today !== lastPosSyncDate; // UTC 17:00 = CST 01:00
  }
  setInterval(async () => {
    if (!shouldRunPosSync()) return;
    const now = new Date(Date.now() + 8 * 3600000);
    lastPosSyncDate = now.toISOString().slice(0, 10);
    log.info({ msg: 'pos_sync_cron_start', at: now.toISOString() });
    try {
      for (const tenantId of await getActiveTenantIds(pool)) {
        const resp = await axios.post(`http://127.0.0.1:${process.env.PORT || 3000}/api/growth/pos-feishu-sync`, {}, {
          headers: {
            'Authorization': 'Bearer ' + (process.env.MINIPROGRAM_SYNC_SECRET || ''),
            'Content-Type': 'application/json',
            'x-tenant-id': tenantId
          },
          timeout: 300000
        });
        const data = resp.data;
        if (data && data.ok) {
          log.info({ msg: 'pos_sync_cron_success', tenant_id: tenantId, orders: data.orders_synced, items: data.items_synced, customers_linked: data.customers_linked });
          continue;
        }
        throw new Error(`tenant=${tenantId} ${data?.error || 'unknown_error'}`);
      }
    } catch (e) {
      log.error({ msg: 'pos_sync_cron_failed', err: e.message });
      try {
        const failedTenant = String((e.message || '').match(/tenant=([A-Za-z0-9_-]+)/)?.[1] || '').trim();
        if (failedTenant) {
          await tenantContext.run(failedTenant, async () => {
            await pool.query(`INSERT INTO growth_sync_failures (source, event_type, payload, error_message, tenant_id) VALUES ($1,$2,$3,$4,$5)`,
              [POS_SYNC_CRON_KEY, 'daily_sync_failed', '{}', e.message || String(e), failedTenant]);
            await pool.query(`INSERT INTO growth_alerts (alert_key, alert_type, severity, title, message, suggested_action, status, tenant_id)
              VALUES ($1,$2,$3,$4,$5,$6,'open',$7)
              ON CONFLICT (alert_key, tenant_id) DO UPDATE SET severity=EXCLUDED.severity, message=EXCLUDED.message, suggested_action=EXCLUDED.suggested_action, status='open', updated_at=NOW()`,
              [`pos_sync_failed_${failedTenant}`, 'pos_sync_failed', 'high', 'POS数据同步失败', '每日凌晨POS飞书同步失败：' + (e.message || String(e)).slice(0, 200), '检查飞书应用权限、表字段、网络连接；手动调 POST /api/growth/pos-feishu-sync 重试', failedTenant]);
          });
        }
      } catch (_) { /* ignore */ }
    }
  }, 60 * 1000);
  log.info({ msg: 'pos_sync_cron_scheduled', schedule: 'daily ~01:10 CST' });
}
