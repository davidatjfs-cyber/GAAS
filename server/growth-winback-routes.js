/**
 * Winback + touch-rules routes (extracted from growth-api.js — monolith split, first of 8).
 * registerGrowthWinbackRoutes(app, pool) — behavior-preserving move.
 */
import { sendAliyunSms } from './sms.js';
import { tenantContext, resolveTenantIdDefault } from './utils/database.js';
import {
  requireGrowthAuth,
  getGrowthOperator,
  getGrowthTenantId,
  resolveTenantIdForStore,
  pickWinbackTemplateByStore,
  freqDaysEnv,
  globalSmsCapped,
  isPhoneSuppressed,
  upsertCustomer,
  upsertDeliveryLog,
  insertGrowthEvent,
  handleSmsFailure,
  inSmsQuietHours,
  CAMPAIGN_TYPES,
  getTouchRulesAudience,
} from './growth-api.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

export function registerGrowthWinbackRoutes(app, pool) {
  // 沉睡客召回：小程序生成带短码的券后,调本接口由 HRMS 用阿里云发短信。
  // 仅用「小程序→HRMS」这一已验证方向;幂等按券码去重;发送结果写 growth_delivery_logs(带活动+券码)供算核销率/ROI。
  app.post('/api/growth/winback/send-sms', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const phone = cleanPhone(b.phone);
      const storeId = cleanText(b.store_id, 128);
      const code = cleanText(b.coupon_code || b.code, 64);
      const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan || b.value) || 0));
      const validUntil = cleanText(b.valid_until || b.date, 40); // 如「6月20日」或「2026-06-20」
      const campaignId = cleanText(b.campaign_id || b.scene, 128);
      const idempotencyKey = cleanText(b.idempotency_key, 255) || (code ? `winback_sms:${code}` : '');
      const tenantId = await resolveTenantIdForStore(pool, storeId);

      if (!phone) return res.status(400).json({ ok: false, error: 'missing_phone' });
      if (!code) return res.status(400).json({ ok: false, error: 'missing_coupon_code' });
      if (valueYuan <= 0) return res.status(400).json({ ok: false, error: 'missing_value' });
      if (!validUntil) return res.status(400).json({ ok: false, error: 'missing_valid_until' });

      const templateCode = pickWinbackTemplateByStore(storeId);
      if (!templateCode) return res.status(503).json({ ok: false, error: 'winback_template_not_configured' });

      return await tenantContext.run(tenantId, async () => {
      // 幂等：同一券码已发过 → 不重复发（防小程序重试导致客人收多条）
      if (idempotencyKey) {
        const dup = await pool.query(`SELECT status FROM growth_delivery_logs WHERE delivery_key = $1 LIMIT 1`, [idempotencyKey]);
        if (dup.rows.length && dup.rows[0].status === 'sent') {
          return res.json({ ok: true, deduped: true });
        }
      }
      // 触达频控(防骚扰核心):同一手机号 N 天内最多收 1 条召回短信。
      // 写在发送总入口,无论从哪发起(小程序/HRMS/对账)都统一拦截。N 经 env 配置,默认 30 天。
      const freqDays = freqDaysEnv('ALIYUN_SMS_WINBACK_FREQUENCY_DAYS', 30);
      if (freqDays > 0) {
        const recent = await pool.query(
          `SELECT 1 FROM growth_delivery_logs
            WHERE channel = 'sms' AND rule_key = 'winback_sms' AND status = 'sent'
              AND payload->>'phone' = $1 AND created_at > now() - ($2 || ' days')::interval
            LIMIT 1`,
          [phone, String(freqDays)]
        );
        if (recent.rows.length) {
          return res.json({ ok: true, skipped: true, reason: 'frequency_capped', frequency_days: freqDays });
        }
      }
      // 全局总闸：同一号码每周(默认7天)最多 1 条任意类型短信
      const gCap = await globalSmsCapped(pool, phone, tenantId);
      if (gCap) return res.json({ ok: true, skipped: true, reason: 'global_frequency_capped', frequency_days: gCap });
      // 永久抑制名单：停机/空号/黑名单号码不再发送
      if (await isPhoneSuppressed(pool, phone, tenantId)) return res.json({ ok: true, skipped: true, reason: 'suppressed' });
      const deliveryKey = idempotencyKey || `winback_sms:${phone}:${Date.now()}`;
      // 已报备模板仅 3 个变量 value/date/code（无 name，避免超 3 变量报备失败）。
      // 务必与模板严格一致，多传 name 会被阿里云判「参数不匹配」拒收。
      const templateParam = { value: String(valueYuan), date: validUntil, code };

      try {
        const sent = await sendAliyunSms({ phoneNumbers: phone, templateCode, templateParam });
        // 解析/登记客户，使发送日志与触达事件都带 customer_id，核销时可按人归因
        const winbackCustomer = await upsertCustomer(pool, { phone, store_id: storeId }, tenantId).catch(() => null);
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: campaignId || 'winback', rule_key: 'winback_sms',
          customer_id: winbackCustomer?.id || null, store_id: storeId, channel: 'sms', external_userid: '',
          provider_msg_id: sent.provider_msg_id, status: 'sent',
          payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId },
          result: sent.raw || {}
        }, tenantId);
        // 写 marketing_triggered 事件：让日指标按活动统计「发送量」，与后续 coupon_redeemed 配对算核销率/ROI。
        // 幂等键带短码，云函数重试不会重复计数。
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered',
          customer_id: winbackCustomer?.id || null,
          phone,
          external_userid: null,
          store_id: storeId,
          campaign_id: campaignId,
          channel: 'sms',
          coupon_id: code,
          idempotency_key: `marketing_triggered:winback_sms:${code}`,
          metadata: {
            rule_key: 'winback_sms',
            delivery_key: deliveryKey,
            provider_msg_id: sent.provider_msg_id,
            short_code: code,
            coupon_value_fen: valueYuan * 100,
            template_code: templateCode
          }
        }, tenantId);
        return res.json({ ok: true, provider_msg_id: sent.provider_msg_id });
      } catch (deliveryErr) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: campaignId || 'winback', rule_key: 'winback_sms',
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'failed',
          payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId },
          result: {}, error_message: deliveryErr?.message || 'sms_send_failed'
        }, tenantId);
        await handleSmsFailure(pool, phone, deliveryErr?.message, tenantId);
        return res.status(502).json({ ok: false, error: deliveryErr?.message || 'sms_send_failed' });
      }
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 召回预览/试算(不发送):返回命中人数、扣除频控后真正会发的人数、样例。发起前必看,防误群发。
  app.get('/api/growth/winback/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const storeId = cleanText(req.query.store_id, 128);
      const dormantDays = Math.max(1, Math.floor(Number(req.query.dormant_days) || 14));
      const minBalanceFen = Math.max(0, Math.floor((Number(req.query.min_balance_yuan) || 1) * 100));
      const freqDays = Math.max(0, Math.floor(Number(req.query.freq_days != null ? req.query.freq_days : (process.env.ALIYUN_SMS_WINBACK_FREQUENCY_DAYS || 30))));
      const params = [String(freqDays)];
      const clauses = ["m.phone IS NOT NULL AND m.phone <> ''", `m.balance_fen >= ${minBalanceFen}`,
        `(m.last_consume_date IS NULL OR m.last_consume_date <= (CURRENT_DATE - ${dormantDays}))`];
      if (storeId) { params.push(storeId); clauses.push(`m.store_id = $${params.length}`); }
      const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
        `SELECT m.card_no, m.member_name, m.phone, m.balance_fen, m.last_consume_date,
                (NOT EXISTS (SELECT 1 FROM growth_delivery_logs d
                   WHERE d.channel='sms' AND d.rule_key='winback_sms' AND d.status='sent'
                     AND d.payload->>'phone' = m.phone AND d.created_at > now() - ($1 || ' days')::interval)) AS sendable
           FROM growth_stored_value_members m
          WHERE ${clauses.join(' AND ')}
          ORDER BY m.balance_fen DESC LIMIT 5000`,
        params
      ));
      const matchCount = r.rows.length;
      const sendable = r.rows.filter((x) => x.sendable);
      const sample = sendable.slice(0, 10).map((x) => ({
        phone: x.phone ? (String(x.phone).slice(0, 3) + '****' + String(x.phone).slice(-4)) : '',
        balance_yuan: Math.round((x.balance_fen || 0) / 100),
        last_consume_date: x.last_consume_date
      }));
      return res.json({
        ok: true, dry_run: true,
        match_count: matchCount,
        capped_count: matchCount - sendable.length,
        sendable_count: sendable.length,
        frequency_days: freqDays,
        sample
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 【HRMS 集中发起】储值召回:发起时即解析并冻结目标名单(已过余额+沉睡+频控),写入待执行任务。
  app.post('/api/growth/winback/launch', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const storeId = cleanText(b.store_id, 128);
      const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan) || 0));
      const validDays = Math.max(1, Math.floor(Number(b.valid_days) || 14));
      const dormantDays = Math.max(1, Math.floor(Number(b.dormant_days) || 14));
      const minBalanceFen = Math.max(0, Math.floor((Number(b.min_balance_yuan) || 1) * 100));
      const maxTargets = Math.min(Math.max(Number(b.max_targets) || 500, 1), 2000);
      const freqDays = freqDaysEnv('ALIYUN_SMS_WINBACK_FREQUENCY_DAYS', 30);
      if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      if (valueYuan <= 0) return res.status(400).json({ ok: false, error: 'missing_value' });
      const launchResult = await tenantContext.run(getGrowthTenantId(req), async () => {
        const r = await pool.query(
          `SELECT card_no, member_name, phone FROM growth_stored_value_members m
            WHERE m.phone IS NOT NULL AND m.phone <> '' AND m.store_id = $2 AND m.balance_fen >= $3
              AND (m.last_consume_date IS NULL OR m.last_consume_date <= (CURRENT_DATE - ${dormantDays}))
              AND NOT EXISTS (SELECT 1 FROM growth_delivery_logs d
                WHERE d.channel='sms' AND d.rule_key='winback_sms' AND d.status='sent'
                  AND d.payload->>'phone' = m.phone AND d.created_at > now() - ($1 || ' days')::interval)
            ORDER BY m.balance_fen DESC LIMIT ${maxTargets}`,
          [String(freqDays), storeId, minBalanceFen]
        );
        const targets = r.rows.map((x) => ({ phone: x.phone, name: x.member_name || '', card_no: x.card_no }));
        if (!targets.length) return { job_id: null, target_count: 0, message: '没有符合条件的对象(余额/沉睡/频控筛选后为空)' };
        const campaignId = cleanText(b.campaign_id, 128) || ('winback_' + storeId + '_' + Date.now());
        const ins = await pool.query(
          `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, created_by, tenant_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'pending',$9,$10) RETURNING id`,
          [campaignId, storeId, valueYuan, validDays, dormantDays, minBalanceFen, JSON.stringify(targets), targets.length, cleanText(b.operator, 128) || 'hrms_admin', resolveTenantIdDefault()]
        );
        return { job_id: ins.rows[0].id, campaign_id: campaignId, target_count: targets.length };
      });
      return res.json({ ok: true, ...launchResult });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 小程序定时器拉取一个待执行任务(原子认领:置为 running,避免并发重复执行)
  app.get('/api/growth/winback/pending-jobs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      // 禁发时段(默认北京时间21:30-9:00)：不放出任务，pending 保持原状，窗口外自动续跑。
      // 此端点是小程序执行器唯一的任务入口，在这里拦截即覆盖全部发券短信。
      if (inSmsQuietHours()) return res.json({ ok: true, job: null, quiet_hours: true });
      // 小程序认领所有「带券码」任务：召回(winback) + 通用发券(各段key)。
      // 仅排除 stored_value_remind（无券无码，由 HRMS 后台 worker 直发）。
      // 认领待执行任务：pending 优先；另回收「卡死的 running」——小程序断点续跑会把未发完的
      // 任务置回 pending，但若其执行中崩溃/超时来不及回写，任务会滞留 running。超过 3 分钟未更新
      // 即视为僵死，重新认领续跑（已发出的人受 7 天频控保护不会重复发，按 result.processed 续跑不重复建券）。
      const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
        `UPDATE growth_campaign_jobs SET status='running', updated_at=now()
          WHERE id = (SELECT id FROM growth_campaign_jobs
                       WHERE kind <> 'stored_value_remind'
                         AND (status='pending' OR status='partial' OR (status='running' AND updated_at < now() - interval '3 minutes'))
                       ORDER BY created_at ASC LIMIT 1)
          RETURNING id, campaign_id, store_id, kind, value_yuan, valid_days, targets, result`
      ));
      return res.json({ ok: true, job: r.rows[0] || null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 小程序回写任务执行结果
  app.post('/api/growth/winback/job-result', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const jobId = Math.floor(Number(b.job_id) || 0);
      if (!jobId) return res.status(400).json({ ok: false, error: 'missing_job_id' });
      const sentN = Math.max(0, Math.floor(Number(b.sent) || 0));
      const failedN = Math.max(0, Math.floor(Number(b.failed) || 0));
      // 优先尊重小程序的 finished 信号(status='done'): processed>=total 时即使有失败也算完成。
      // 若小程序未报告 done，则按 sent/failed 推导：全失败=failed，混合=partial，全成功=done。
      const miniDone = cleanText(b.status || '', 20) === 'done';
      const computedStatus = miniDone ? 'done' : (sentN === 0 && failedN > 0 ? 'failed' : sentN > 0 && failedN > 0 ? 'partial' : 'done');
      await tenantContext.run(getGrowthTenantId(req), () => pool.query(
        `UPDATE growth_campaign_jobs SET sent=$2, failed=$3, status=$4, result=$5::jsonb, updated_at=now() WHERE id=$1`,
        [jobId, sentN, failedN, computedStatus, JSON.stringify(b.result || {})]
      ));
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 管理端查看近期召回任务及进度
  app.get('/api/growth/winback/jobs', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
        `SELECT id, campaign_id, store_id, kind, value_yuan, valid_days, dormant_days, total, sent, failed, status, created_by, created_at, updated_at
           FROM growth_campaign_jobs ORDER BY created_at DESC LIMIT ${limit}`
      ));
      return res.json({ ok: true, jobs: r.rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/growth/touch-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(`SELECT * FROM growth_touch_rules ORDER BY priority ASC, rule_key ASC LIMIT 100`));
    return res.json({ ok: true, rules: r.rows });
  });

  app.post('/api/growth/touch-rules', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const b = req.body || {};
    const ruleKey = cleanText(b.rule_key, 128);
    if (!ruleKey) return res.status(400).json({ ok: false, error: 'missing_rule_key' });
    const criteriaStr = JSON.stringify(b.criteria || {});
    const payloadStr = JSON.stringify(b.action_payload || {});
    const actionType = cleanText(b.action_type || 'send_message', 80);
    const { r, criteriaChanged } = await tenantContext.run(getGrowthTenantId(req), async () => {
      // 改了「目标人群/券额文案/动作类型」就要重新审核——避免审过的规则被人偷偷改条件后继续自动群发。
      const existing = await pool.query(`SELECT criteria, action_payload, action_type FROM growth_touch_rules WHERE rule_key = $1 LIMIT 1`, [ruleKey]);
      let keepApproval = false;
      let criteriaChangedInner = true;
      if (existing.rows.length) {
        const ex = existing.rows[0];
        criteriaChangedInner = JSON.stringify(ex.criteria || {}) !== criteriaStr;
        keepApproval =
          !criteriaChangedInner &&
          JSON.stringify(ex.action_payload || {}) === payloadStr &&
          (ex.action_type || '') === actionType;
      }
      const rRes = await pool.query(
        `INSERT INTO growth_touch_rules (rule_key, name, enabled, priority, auto_execute, criteria, action_type, action_payload, owner, note, tenant_id)
         VALUES ($1,$2,COALESCE($3,TRUE),$4,COALESCE($5,TRUE),$6::jsonb,$7,$8::jsonb,NULLIF($9,''),NULLIF($10,''),$12)
         ON CONFLICT (rule_key, tenant_id) DO UPDATE SET
           name = EXCLUDED.name,
           enabled = EXCLUDED.enabled,
           priority = EXCLUDED.priority,
           auto_execute = EXCLUDED.auto_execute,
           criteria = EXCLUDED.criteria,
           action_type = EXCLUDED.action_type,
           action_payload = EXCLUDED.action_payload,
           owner = COALESCE(EXCLUDED.owner, growth_touch_rules.owner),
           note = COALESCE(EXCLUDED.note, growth_touch_rules.note),
           approved_by = CASE WHEN $11 THEN growth_touch_rules.approved_by ELSE NULL END,
           approved_at = CASE WHEN $11 THEN growth_touch_rules.approved_at ELSE NULL END,
           updated_at = NOW()
         RETURNING *`,
        [
          ruleKey,
          cleanText(b.name || ruleKey, 255),
          b.enabled !== false,
          Math.max(1, Math.floor(Number(b.priority) || 100)),
          b.auto_execute !== false,
          criteriaStr,
          actionType,
          payloadStr,
          cleanText(b.owner || '', 128),
          cleanText(b.note || '', 1000),
          keepApproval,
          getGrowthTenantId(req)
        ]
      );
      return { r: rRes, criteriaChanged: criteriaChangedInner };
    });
    // 人群定向(criteria)变了才需重算覆盖人数；后台重算，不清空缓存、不阻塞本次保存，
    // 避免保存请求与5秒全表扫描抢连接池而卡住。频率/券面额/文案变更不影响覆盖人数。
    if (criteriaChanged && typeof globalThis.__refreshGrowthAudience === 'function') globalThis.__refreshGrowthAudience();
    return res.json({ ok: true, rule: r.rows[0] });
  });

  // 审核规则：记录审核人 + 时间。只有审核过的规则才允许引擎自动执行。
  app.post('/api/growth/touch-rules/:ruleKey/approve', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const ruleKey = cleanText(req.params.ruleKey, 128);
    const operator = getGrowthOperator(req);
    const owner = cleanText(req.body?.owner || '', 128);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      `UPDATE growth_touch_rules
         SET approved_by = $2, approved_at = NOW(),
             owner = COALESCE(NULLIF($3,''), owner),
             updated_at = NOW()
       WHERE rule_key = $1
       RETURNING *`,
      [ruleKey, operator.username || 'system', owner]
    ));
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'rule_not_found' });
    return res.json({ ok: true, rule: r.rows[0] });
  });

  // 撤销审核：撤销后该规则不再自动执行，仅生成待发动作供人工确认。
  app.post('/api/growth/touch-rules/:ruleKey/unapprove', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const ruleKey = cleanText(req.params.ruleKey, 128);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      `UPDATE growth_touch_rules SET approved_by = NULL, approved_at = NULL, updated_at = NOW() WHERE rule_key = $1 RETURNING *`,
      [ruleKey]
    ));
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'rule_not_found' });
    return res.json({ ok: true, rule: r.rows[0] });
  });

  // 规则维度闭环统计：本规则累计 已发送 / 已核销 / 核销率（delivery_logs + redemptions 经 action_key/rule_key 关联）。
  // days=0（或 all）= 全量累计，不按时间截断；否则为近 N 天窗口统计。
  app.get('/api/growth/touch-rules/stats', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const rawDays = String(req.query.days ?? '0').trim().toLowerCase();
    const days = (rawDays === '0' || rawDays === 'all' || rawDays === 'lifetime')
      ? 0
      : Math.min(Math.max(Number(req.query.days) || 0, 1), 365);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      // 注：核销成功后 Fix3 会把投递日志 status 由 'sent' 翻成 'redeemed'，
      // 故发送数须把已触达的各终态都计入，否则被核销的那条会从发送数里漏掉。
      // 归因键修正：投递日志的 rule_key 实际存的是 campaign_key（活动制规则），核销事件
      // metadata 里也是 campaign_key。故统一按「归因键 akey = COALESCE(campaign_key, rule_key)」
      // 聚合并 JOIN，否则活动制规则(主力)发送/核销全部漏算成 0（旧实现的真实 bug）。
      // 兼容旧数据：部分早期日志 rule_key 存的是 touch_rules.rule_key 而非 campaign_key，
      // 故按 rule 汇总时同时匹配 rule_key 与 campaign_key 并求和（不同键各计一次，不重复）。
      `WITH sent AS (
         SELECT rule_key AS akey,
                COUNT(*)::int AS sent_count,
                COUNT(*) FILTER (WHERE channel = 'sms')::int AS sms_sent_count
         FROM growth_delivery_logs
         WHERE status IN ('sent','delivered','read','clicked','redeemed')
           AND ($1::int <= 0 OR created_at >= NOW() - ($1::int || ' days')::interval)
         GROUP BY rule_key
       ),
       redeemed AS (
         SELECT COALESCE(NULLIF(metadata->>'campaign_key',''), NULLIF(metadata->>'rule_key','')) AS akey,
                COUNT(*)::int AS redeemed_count,
                COALESCE(SUM(amount_fen), 0)::bigint AS revenue_fen
         FROM growth_events
         WHERE event_type = 'coupon_redeemed'
           AND ($1::int <= 0 OR created_at >= NOW() - ($1::int || ' days')::interval)
           AND COALESCE(NULLIF(metadata->>'campaign_key',''), NULLIF(metadata->>'rule_key','')) IS NOT NULL
         GROUP BY 1
       )
       SELECT tr.rule_key,
              tr.action_payload->>'campaign_key' AS campaign_key,
              COALESCE(s.sent_count, 0) AS sent_count,
              COALESCE(s.sms_sent_count, 0) AS sms_sent_count,
              COALESCE(rd.redeemed_count, 0) AS redeemed_count,
              COALESCE(rd.revenue_fen, 0) AS revenue_fen
       FROM growth_touch_rules tr
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(s.sent_count), 0)::int AS sent_count,
                COALESCE(SUM(s.sms_sent_count), 0)::int AS sms_sent_count
         FROM sent s
         WHERE s.akey = tr.rule_key
            OR s.akey = COALESCE(NULLIF(tr.action_payload->>'campaign_key',''), tr.rule_key)
       ) s ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(rd.redeemed_count), 0)::int AS redeemed_count,
                COALESCE(SUM(rd.revenue_fen), 0)::bigint AS revenue_fen
         FROM redeemed rd
         WHERE rd.akey = tr.rule_key
            OR rd.akey = COALESCE(NULLIF(tr.action_payload->>'campaign_key',''), tr.rule_key)
       ) rd ON true`,
      [days]
    ));
    // 单条短信成本 0.05 元（5 分）；订阅消息 / 小程序渠道成本为 0。
    // ROI = 带来的营收 ÷ 投入成本；据此打分排序并给运营建议（不自动改投放，仅供决策）。
    const SMS_COST_FEN = 5;
    const stats = r.rows.map((row) => {
      const sent = Number(row.sent_count) || 0;
      const smsSent = Number(row.sms_sent_count) || 0;
      const redeemed = Number(row.redeemed_count) || 0;
      const revenueFen = Number(row.revenue_fen) || 0;
      const costFen = smsSent * SMS_COST_FEN;
      const redeemRate = sent > 0 ? redeemed / sent : null; // 0~1
      const roi = costFen > 0 ? revenueFen / costFen : null; // 营收/成本，成本为 0 时不适用
      const revenueMissing = redeemed > 0 && revenueFen === 0; // 核销了但实收未录入

      // 评分（0~100）：核销率为主（实收常缺失），有成本时再融合 ROI。
      let score = null;
      if (sent > 0) {
        const rateScore = Math.min(100, Math.round((redeemRate || 0) * 100 * 5)); // 20% 核销=满分
        if (costFen > 0) {
          const roiScore = Math.min(100, Math.round(((roi || 0) / 5) * 100)); // ROI≥5=满分
          score = Math.round(rateScore * 0.6 + roiScore * 0.4);
        } else {
          score = rateScore;
        }
      }

      // 文字建议
      let suggestion;
      if (sent === 0) {
        suggestion = '尚未发送，审核启用后可观察效果';
      } else if (redeemed === 0) {
        suggestion = '已发送但暂无核销，建议优化文案/券面额或更换目标人群';
      } else if (redeemRate < 0.05) {
        suggestion = '核销率偏低（<5%），建议收窄人群定向或提高券吸引力';
      } else if (redeemRate >= 0.15) {
        suggestion = '核销率优秀，建议保持并可适度加大投放';
      } else {
        suggestion = '核销率中等，可小幅优化文案或做面额 A/B 测试';
      }
      if (costFen > 0 && revenueFen > 0) {
        if (roi >= 3) suggestion += '；ROI 高，投入产出优';
        else if (roi < 1) suggestion += '；ROI<1 尚未回本，注意控制成本';
      }
      if (revenueMissing) {
        suggestion += '；注：本期实收金额未录入，ROI 暂按 0 计，建议核销时录入实收金额以精确核算';
      }

      // 券类型：活动模板含 value 变量=现金券，否则=免费菜/赠菜券。供「现金券 vs 免费菜」对比。
      const cfg = CAMPAIGN_TYPES[row.campaign_key];
      const couponKind = cfg ? (Array.isArray(cfg.vars) && cfg.vars.includes('value') ? 'cash' : 'gift') : 'unknown';
      return Object.assign({}, row, {
        sent_count: sent,
        sms_sent_count: smsSent,
        redeemed_count: redeemed,
        revenue_fen: revenueFen,
        cost_fen: costFen,
        roi: roi == null ? null : Math.round(roi * 100) / 100,
        coupon_kind: couponKind,
        score,
        suggestion
      });
    });
    // 券类型汇总（现金券 vs 免费菜券）：供管理员一眼看清哪类券核销更好。
    // 注意：样本不足或人群不同会让对比失真，前端展示需带「样本量/置信」提示，不可仅凭此切换全部投放。
    const byKind = {};
    for (const s of stats) {
      const k = s.coupon_kind;
      if (k !== 'cash' && k !== 'gift') continue;
      const b = byKind[k] || (byKind[k] = { sent: 0, redeemed: 0 });
      b.sent += s.sent_count; b.redeemed += s.redeemed_count;
    }
    for (const k of Object.keys(byKind)) {
      byKind[k].redeem_rate = byKind[k].sent > 0 ? Math.round(byKind[k].redeemed / byKind[k].sent * 10000) / 100 : null;
    }
    return res.json({ ok: true, days, cumulative: days <= 0, stats, coupon_kind_summary: byKind });
  });

  app.get('/api/growth/touch-rules/audience', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const audienceTenantId = getGrowthTenantId(req);
    const storeId = cleanText(req.query.store_id || '', 128);
    const forceRefresh = String(req.query.refresh || '') === '1';
    try {
      const result = await getTouchRulesAudience(audienceTenantId, storeId, forceRefresh);
      return res.json({ ok: true, ...result, store_id: storeId || null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'audience_failed' });
    }
  });
}
