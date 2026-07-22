/**
 * Stored-value + campaign routes (extracted from growth-api.js — monolith split, second of 8).
 * registerGrowthStoredValueRoutes(app, pool) — behavior-preserving move.
 */
import { sendAliyunSms } from './sms.js';
import { tenantContext, resolveTenantIdDefault } from './utils/database.js';
import {
  requireGrowthAuth,
  getGrowthTenantId,
  resolveTenantIdForStore,
  CAMPAIGN_TYPES,
  freqDaysEnv,
  globalSmsCapped,
  isPhoneSuppressed,
  handleSmsFailure,
  upsertCustomer,
  upsertDeliveryLog,
  insertGrowthEvent,
  pickCampaignTemplate,
  pickCampaignSmsSign,
  formatSmsValidDate,
  pickBalanceTemplateByStore,
  buildCampaignTargetQuery,
  buildRemindTargetsQuery,
  mapStoreNameToId,
  bitText,
  bitNum,
  bitDateMs,
  bitPhone,
  readStoredValueBitableRecords,
  ABC_ROTATION_ORDER,
  ABC_STEP_DEFS,
  deriveAbcStep,
  pickAbcTemplate,
  countCampaignSent,
  campaignTouchCapped,
  marketingFatigueCapped,
} from './growth-api.js';

function cleanText(value, max = 255) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanPhone(value) {
  return cleanText(value, 32).replace(/[^0-9+]/g, '');
}

export function registerGrowthStoredValueRoutes(app, pool) {
  // 储值客户同步:从飞书「储值客户」表拉全部记录,按卡号聚合(当前余额=最新一行余额,
  // 最近消费日=交易类型含「消费」的最新营业日期),写入 growth_stored_value_members。
  // 你每周更新飞书表后,调用本接口(或我手动跑)即可同步。
  app.post('/api/growth/stored-value/sync', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const records = await readStoredValueBitableRecords();
      const byCard = new Map();
      for (const rec of records) {
        const f = (rec && rec.fields) || {};
        const card = bitText(f['卡号']).trim();
        if (!card) continue;
        const txnMs = bitDateMs(f['交易时间']) || bitDateMs(f['营业日期']) || 0;
        const type = bitText(f['交易类型']);
        const od = bitDateMs(f['营业日期']);
        const cur = byCard.get(card) || { card, latestMs: -1, consumeMs: 0, rechargeMs: 0 };
        if (txnMs >= cur.latestMs) {
          cur.latestMs = txnMs;
          cur.member_name = bitText(f['会员名称']).trim();
          cur.phone = bitPhone(f['手机号']);
          cur.level = bitText(f['会员等级'] || f['会员登记']).trim();   // 兼容旧字段名「会员登记」
          cur.tags = bitText(f['人群标签']).trim();
          cur.store_id = mapStoreNameToId(bitText(f['交易门店']) || bitText(f['开卡门店']));
          cur.balance_fen = Math.round((bitNum(f['交易后-储值余额']) || 0) * 100);
        }
        if (/消费|支付/.test(type) && od > cur.consumeMs) cur.consumeMs = od;
        if (/充值|储值$/.test(type) && od > cur.rechargeMs) cur.rechargeMs = od;
        byCard.set(card, cur);
      }
      const upserted = await tenantContext.run(getGrowthTenantId(req), async () => {
        let upsertedCount = 0;
        for (const m of byCard.values()) {
          await pool.query(
            `INSERT INTO growth_stored_value_members
               (card_no, member_name, phone, level, tags, store_id, balance_fen, last_consume_date, last_recharge_date, updated_at, tenant_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),$10)
             ON CONFLICT (card_no, tenant_id) DO UPDATE SET
               member_name=EXCLUDED.member_name, phone=EXCLUDED.phone, level=EXCLUDED.level,
               tags=EXCLUDED.tags, store_id=EXCLUDED.store_id, balance_fen=EXCLUDED.balance_fen,
               last_consume_date=EXCLUDED.last_consume_date, last_recharge_date=EXCLUDED.last_recharge_date, updated_at=NOW()`,
            [m.card, m.member_name || null, m.phone || null, m.level || null, m.tags || null, m.store_id || null,
             m.balance_fen || 0,
             m.consumeMs > 0 ? new Date(m.consumeMs) : null,
             m.rechargeMs > 0 ? new Date(m.rechargeMs) : null,
             resolveTenantIdDefault()]
          );
          upsertedCount++;
        }
        return upsertedCount;
      });
      return res.json({ ok: true, records: records.length, members: byCard.size, upserted });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 储值客户召回目标:有余额 + 久未消费(dormant_days),按门店,供 sendWinbackCampaign 取名单。
  app.get('/api/growth/stored-value/targets', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const storeId = cleanText(req.query.store_id, 128);
      const dormantDays = Math.max(1, Math.floor(Number(req.query.dormant_days) || 14));
      const minBalanceFen = Math.max(0, Math.floor((Number(req.query.min_balance_yuan) || 1) * 100));
      const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
      const params = [];
      const clauses = ["phone IS NOT NULL AND phone <> ''", `balance_fen >= ${minBalanceFen}`,
        `(last_consume_date IS NULL OR last_consume_date <= (CURRENT_DATE - ${dormantDays}))`];
      if (storeId) { params.push(storeId); clauses.push(`store_id = $${params.length}`); }
      params.push(limit);
      const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
        `SELECT card_no, member_name, phone, level, tags, store_id, balance_fen, last_consume_date
           FROM growth_stored_value_members
          WHERE ${clauses.join(' AND ')}
          ORDER BY balance_fen DESC LIMIT $${params.length}`,
        params
      ));
      return res.json({ ok: true, count: r.rows.length, targets: r.rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });






  // ── 通用「营销发券一键发起」(VIP/新客/活跃/长期流失)：profiles 人群 + 召回任务管道 ──
  // 与储值召回同理：HRMS 冻结名单 → 小程序执行(生成券码+写券+发短信)，券码可核销可统计。
  function parseCampaignCriteria(src) {
    const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? NaN : Math.floor(Number(v)));
    return {
      storeId: cleanText(src.store_id, 128),
      valueTier: cleanText(src.value_tier, 32),
      lifecycleStage: cleanText(src.lifecycle_stage, 32),
      minVisits: num(src.min_visits),
      maxVisits: num(src.max_visits),
      minDays: num(src.min_days),
      maxDays: num(src.max_days),
    };
  }

  app.post('/api/growth/campaign/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const campaignKey = cleanText(b.campaign_key, 64);
      if (!CAMPAIGN_TYPES[campaignKey]) return res.status(400).json({ ok: false, error: 'unknown_campaign_key' });
      const c = parseCampaignCriteria(b);
      const freqDays = Math.max(0, Math.floor(Number(b.freq_days != null ? b.freq_days : (process.env.ALIYUN_SMS_CAMPAIGN_FREQUENCY_DAYS || 30))));
      const q = buildCampaignTargetQuery({ ...c, ruleKey: campaignKey, freqDays, limit: 5000 });
      if (!q) return res.status(400).json({ ok: false, error: 'need_audience_filter' });
      const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(q.sql, q.params));
      const sendable = r.rows.filter((x) => x.sendable);
      const sample = sendable.slice(0, 10).map((x) => ({
        phone: x.phone ? (String(x.phone).slice(0, 3) + '****' + String(x.phone).slice(-4)) : '',
        name: x.name || '', visits: x.visits, days: x.days
      }));
      return res.json({
        ok: true, dry_run: true,
        match_count: r.rows.length,
        capped_count: r.rows.length - sendable.length,
        sendable_count: sendable.length,
        coupon_count: CAMPAIGN_TYPES[campaignKey].coupon_count,
        frequency_days: freqDays, sample
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/campaign/launch', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const campaignKey = cleanText(b.campaign_key, 64);
      const cfg = CAMPAIGN_TYPES[campaignKey];
      if (!cfg) return res.status(400).json({ ok: false, error: 'unknown_campaign_key' });
      const c = parseCampaignCriteria(b);
      if (!c.storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan) || 0));
      const validDays = Math.max(1, Math.floor(Number(b.valid_days) || 14));
      if (valueYuan <= 0) return res.status(400).json({ ok: false, error: 'missing_value' });
      // ABC轮换活动实际发送走 pickAbcTemplate(ABCGIFTA/B/C等新slot)，预检查必须与发送路径同源；
      // 老写法查 pickCampaignTemplate(VIP/ACTIVE等旧slot)只剩env残留兜底，env一清理就会误报503。
      const launchAbcOrder = ABC_ROTATION_ORDER[campaignKey];
      const launchTplOk = launchAbcOrder
        ? !!pickAbcTemplate(launchAbcOrder[0], c.storeId)
        : !!pickCampaignTemplate(campaignKey, c.storeId);
      if (!launchTplOk) return res.status(503).json({ ok: false, error: 'sms_template_not_configured' });
      const maxTargets = Math.min(Math.max(Number(b.max_targets) || 500, 1), 2000);
      const freqDays = freqDaysEnv('ALIYUN_SMS_CAMPAIGN_FREQUENCY_DAYS', 30);
      const q = buildCampaignTargetQuery({ ...c, ruleKey: campaignKey, freqDays, limit: maxTargets });
      if (!q) return res.status(400).json({ ok: false, error: 'need_audience_filter' });
      const launchResult = await tenantContext.run(getGrowthTenantId(req), async () => {
        const r = await pool.query(q.sql, q.params);
        const targets = r.rows.filter((x) => x.sendable).map((x) => ({ phone: x.phone, name: x.name || '' }));
        if (!targets.length) return { job_id: null, target_count: 0, message: '没有符合条件的对象(人群/频控筛选后为空)' };
        const campaignId = cleanText(b.campaign_id, 128) || (campaignKey + '_' + c.storeId + '_' + Date.now());
        const result = { campaign_key: campaignKey, coupon_count: cfg.coupon_count };
        const ins = await pool.query(
          `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result, tenant_id)
           VALUES ($1,$2,$3,$4,0,0,$5::jsonb,$6,'pending',$7,$8,$9::jsonb,$10) RETURNING id`,
          [campaignId, c.storeId, valueYuan, validDays, JSON.stringify(targets), targets.length, campaignKey, cleanText(b.operator, 128) || 'hrms_admin', JSON.stringify(result), resolveTenantIdDefault()]
        );
        return { job_id: ins.rows[0].id, campaign_id: campaignId, target_count: targets.length, coupon_count: cfg.coupon_count };
      });
      return res.json({ ok: true, ...launchResult });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 【通用发券短信发送】小程序 runWinbackJobs 生成短码+写券后回调本接口发短信。
  // 模板按 段key+门店 解析(pickCampaignTemplate)，templateParam 严格按 CAMPAIGN_TYPES[key].vars 拼装
  // (赠菜类只 date+code；长期流失 value+date+code)。多/少变量都会被阿里云整批拒收，故以 vars 为准。
  // 频控/幂等/落库/事件与 winback/send-sms 同构，但 rule_key=段key，核销可按活动归因统计。
  app.post('/api/growth/campaign/send-sms', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const campaignKey = cleanText(b.campaign_key, 64);
      const cfg = CAMPAIGN_TYPES[campaignKey];
      if (!cfg) return res.status(400).json({ ok: false, error: 'unknown_campaign_key' });
      const phone = cleanPhone(b.phone);
      const storeId = cleanText(b.store_id, 128);
      const code = cleanText(b.coupon_code || b.code, 64);
      const valueYuan = Math.max(0, Math.floor(Number(b.value_yuan || b.value) || 0));
      const validUntil = cleanText(b.valid_until || b.date, 40) || formatSmsValidDate(b.valid_days);
      const campaignId = cleanText(b.campaign_id || b.scene, 128);
      const idempotencyKey = cleanText(b.idempotency_key, 255) || (code ? `${campaignKey}:${code}` : '');
      const tenantId = await resolveTenantIdForStore(pool, storeId);

      if (!phone) return res.status(400).json({ ok: false, error: 'missing_phone' });

      return await tenantContext.run(tenantId, async () => {
      // ABC 6模板滚动：按该手机号在本活动下累计成功发送次数推导当前应发的模板步骤+降频阶梯天数。
      const abcOrder = ABC_ROTATION_ORDER[campaignKey];
      let effectiveVars = cfg.vars;
      let templateCode;
      let abcFreqDaysOverride = null;
      let abcStep = null;
      if (abcOrder) {
        const totalSent = await countCampaignSent(pool, campaignKey, phone, tenantId);
        const derived = deriveAbcStep(campaignKey, totalSent);
        if (derived.blacklisted) return res.json({ ok: true, skipped: true, reason: 'abc_blacklisted' });
        abcStep = derived.step;
        abcFreqDaysOverride = derived.freqDaysOverride;
        effectiveVars = ABC_STEP_DEFS[abcStep].vars;
        templateCode = pickAbcTemplate(abcStep, storeId);
      } else {
        templateCode = pickCampaignTemplate(campaignKey, storeId);
      }
      if (effectiveVars.includes('code') && !code) return res.status(400).json({ ok: false, error: 'missing_coupon_code' });
      if (effectiveVars.includes('value') && valueYuan <= 0) return res.status(400).json({ ok: false, error: 'missing_value' });
      if (!templateCode) return res.status(503).json({ ok: false, error: 'sms_template_not_configured' });

      // 幂等：同一券码已发过 → 不重复发
      if (idempotencyKey) {
        const dup = await pool.query(`SELECT status FROM growth_delivery_logs WHERE delivery_key = $1 LIMIT 1`, [idempotencyKey]);
        if (dup.rows.length && dup.rows[0].status === 'sent') return res.json({ ok: true, deduped: true });
      }
      // 触达频控：同一手机号 N 天内最多收 1 条本活动短信。ABC 轮换走完一轮后按降频阶梯
      // (15/30/45/60天)覆盖默认频率。
      const freqDays = abcFreqDaysOverride != null ? abcFreqDaysOverride : freqDaysEnv('ALIYUN_SMS_CAMPAIGN_FREQUENCY_DAYS', 30);
      if (freqDays > 0) {
        const recent = await pool.query(
          `SELECT 1 FROM growth_delivery_logs
            WHERE channel = 'sms' AND rule_key = $1 AND status = 'sent'
              AND payload->>'phone' = $2 AND created_at > now() - ($3 || ' days')::interval
            LIMIT 1`,
          [campaignKey, phone, String(freqDays)]
        );
        if (recent.rows.length) return res.json({ ok: true, skipped: true, reason: 'frequency_capped', frequency_days: freqDays });
      }
      // 全局总闸：同一号码每周(默认7天)最多 1 条任意类型短信
      const gCap = await globalSmsCapped(pool, phone, tenantId);
      if (gCap) return res.json({ ok: true, skipped: true, reason: 'global_frequency_capped', frequency_days: gCap });
      // 永久抑制名单：停机/空号/黑名单号码不再发送
      if (await isPhoneSuppressed(pool, phone, tenantId)) return res.json({ ok: true, skipped: true, reason: 'suppressed' });
      // 跨活动疲劳总闸：近90天最近到店后累计收满8条任意活动短信仍未回店 → 暂停所有营销
      if (await marketingFatigueCapped(pool, phone, tenantId)) return res.json({ ok: true, skipped: true, reason: 'marketing_fatigue' });
      // 触达上限：同活动累计发满 N 次(默认3)仍未回店 → 停发本活动。ABC 轮换自带 15/30/45/60天
      // 降频阶梯+红名单机制，不再叠加此上限。
      if (!abcOrder && await campaignTouchCapped(pool, campaignKey, phone, tenantId)) return res.json({ ok: true, skipped: true, reason: 'touch_capped' });
      const deliveryKey = idempotencyKey || `${campaignKey}:${phone}:${Date.now()}`;
      // 严格按 vars 拼模板参数：缺/多变量阿里云都判「参数不匹配」整批拒收。
      const templateParam = {};
      if (effectiveVars.includes('value')) templateParam.value = String(valueYuan);
      if (effectiveVars.includes('date')) templateParam.date = validUntil;
      if (effectiveVars.includes('code')) templateParam.code = code;

      try {
        const sent = await sendAliyunSms({ phoneNumbers: phone, templateCode, templateParam, signName: pickCampaignSmsSign(storeId) });
        const camCustomer = await upsertCustomer(pool, { phone, store_id: storeId }, tenantId).catch(() => null);
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: campaignId || campaignKey, rule_key: campaignKey,
          customer_id: camCustomer?.id || null, store_id: storeId, channel: 'sms', external_userid: '',
          provider_msg_id: sent.provider_msg_id, status: 'sent',
          payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId, campaign_key: campaignKey },
          result: sent.raw || {}
        }, tenantId);
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered',
          customer_id: camCustomer?.id || null, phone, external_userid: null, store_id: storeId,
          campaign_id: campaignId, channel: 'sms', coupon_id: code,
          idempotency_key: `marketing_triggered:${campaignKey}:${code || phone}`,
          metadata: {
            rule_key: campaignKey, delivery_key: deliveryKey, provider_msg_id: sent.provider_msg_id,
            short_code: code, coupon_value_fen: valueYuan * 100, template_code: templateCode
          }
        }, tenantId);
        return res.json({ ok: true, provider_msg_id: sent.provider_msg_id });
      } catch (deliveryErr) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: campaignId || campaignKey, rule_key: campaignKey,
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'failed',
          payload: { phone, template_param: templateParam, coupon_code: code, campaign_id: campaignId, campaign_key: campaignKey },
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

  app.post('/api/growth/stored-value/remind/preview', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const storeId = cleanText(b.store_id, 128);
      const dormantDays = Math.max(0, Math.floor(Number(b.dormant_days) || 30));
      const minBalanceFen = Math.max(0, Math.floor((Number(b.min_balance_yuan) || 1) * 100));
      const maxTargets = Math.min(Math.max(Number(b.max_targets) || 1000, 1), 2000);
      const freqDays = freqDaysEnv('ALIYUN_SMS_REMIND_FREQUENCY_DAYS', 30);
      if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      const q = buildRemindTargetsQuery(storeId, dormantDays, minBalanceFen, freqDays, maxTargets);
      const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(q.sql, q.params));
      return res.json({
        ok: true,
        target_count: r.rows.length,
        sample: r.rows.slice(0, 5).map((x) => ({ name: x.member_name || '', balance_yuan: Math.round((x.balance_fen || 0) / 100) }))
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post('/api/growth/stored-value/remind/launch', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    try {
      const b = req.body || {};
      const storeId = cleanText(b.store_id, 128);
      const dormantDays = Math.max(0, Math.floor(Number(b.dormant_days) || 30));
      const minBalanceFen = Math.max(0, Math.floor((Number(b.min_balance_yuan) || 1) * 100));
      const maxTargets = Math.min(Math.max(Number(b.max_targets) || 1000, 1), 2000);
      const freqDays = freqDaysEnv('ALIYUN_SMS_REMIND_FREQUENCY_DAYS', 30);
      const templateCode = cleanText(b.sms_template_code, 64) || pickBalanceTemplateByStore(storeId);
      if (!storeId) return res.status(400).json({ ok: false, error: 'missing_store_id' });
      if (!templateCode) return res.status(503).json({ ok: false, error: 'balance_template_not_configured' });
      const q = buildRemindTargetsQuery(storeId, dormantDays, minBalanceFen, freqDays, maxTargets);
      const launchResult = await tenantContext.run(getGrowthTenantId(req), async () => {
        const r = await pool.query(q.sql, q.params);
        // 冻结目标(含发起时点余额快照)，发送时直接用，无需重查。
        const targets = r.rows.map((x) => ({ phone: x.phone, name: x.member_name || '', card_no: x.card_no, balance_yuan: Math.round((x.balance_fen || 0) / 100) }));
        if (!targets.length) return { job_id: null, target_count: 0, message: '没有符合条件的对象(余额/沉睡/频控筛选后为空)' };
        const campaignId = cleanText(b.campaign_id, 128) || ('svremind_' + storeId + '_' + Date.now());
        const ins = await pool.query(
          `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result, tenant_id)
           VALUES ($1,$2,0,0,$3,$4,$5::jsonb,$6,'pending','stored_value_remind',$7,$8::jsonb,$9) RETURNING id`,
          [campaignId, storeId, dormantDays, minBalanceFen, JSON.stringify(targets), targets.length, cleanText(b.operator, 128) || 'hrms_admin', JSON.stringify({ template_code: templateCode }), resolveTenantIdDefault()]
        );
        return { job_id: ins.rows[0].id, campaign_id: campaignId, target_count: targets.length };
      });
      return res.json({ ok: true, ...launchResult });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.get('/api/growth/campaigns/:campaignId/funnel', async (req, res) => {
    if (!requireGrowthAuth(req, res)) return;
    const campaignId = cleanText(req.params.campaignId, 128);
    const r = await tenantContext.run(getGrowthTenantId(req), () => pool.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM growth_events
       WHERE campaign_id = $1
       GROUP BY event_type
       ORDER BY event_type`,
      [campaignId]
    ));
    return res.json({ ok: true, campaign_id: campaignId, counts: r.rows });
  });
}
