/**
 * Growth background workers — P5.4 extract from registerGrowthRoutes.
 */
export function startGrowthRemindWorkers(deps) {
  const {
    pool,
    log,
    runForActiveTenants,
    resolveTenantIdDefault,
    cleanText,
    cleanPhone,
    inSmsQuietHours,
    isPhoneSuppressed,
    globalSmsCapped,
    upsertDeliveryLog,
    insertGrowthEvent,
    sendAliyunSms,
    handleSmsFailure,
    upsertCustomer,
    resolveTenantIdForStore,
    pickBalanceTemplateByStore,
    isAliyunSmsAutoSendEnabled,
    freqDaysEnv,
    buildRemindTargetsQuery,
    autoBackfillSmsActions,
  } = deps;

  // 后台 worker：认领 pending 的储值余额提醒任务并由 HRMS 自身逐条下发(不经小程序)。
  // 每 30s 跑一次；同一时刻只处理一个任务，发送结果写 delivery_logs + marketing_triggered。
  async function processOneRemindJob() {
    if (inSmsQuietHours()) return; // 禁发时段：任务保持 pending，窗口外自动续跑
    const claim = await pool.query(
      `UPDATE growth_campaign_jobs SET status='running', updated_at=now()
        WHERE id = (SELECT id FROM growth_campaign_jobs WHERE status='pending' AND kind='stored_value_remind' ORDER BY created_at ASC LIMIT 1)
        RETURNING id, campaign_id, store_id, targets, result`
    );
    const job = claim.rows[0];
    if (!job) return;
    const storeId = cleanText(job.store_id, 128);
    const tenantId = await resolveTenantIdForStore(pool, storeId);
    const templateCode = cleanText(job.result?.template_code, 64) || pickBalanceTemplateByStore(storeId);
    const targets = Array.isArray(job.targets) ? job.targets : [];
    let sent = 0, failed = 0;
    if (!templateCode) {
      await pool.query(`UPDATE growth_campaign_jobs SET status='failed', failed=$2, result=result||$3::jsonb, updated_at=now() WHERE id=$1`,
        [job.id, targets.length, JSON.stringify({ error: 'balance_template_not_configured' })]);
      return;
    }
    for (const t of targets) {
      const phone = cleanPhone(t.phone);
      const balanceYuan = Math.max(0, Math.floor(Number(t.balance_yuan) || 0));
      if (!phone || balanceYuan <= 0) { failed++; continue; }
      const deliveryKey = `svremind:${job.id}:${phone}`;
      const templateParam = { balance: String(balanceYuan) };
      // 永久抑制名单：停机/空号/黑名单号码不再发送
      if (await isPhoneSuppressed(pool, phone, tenantId)) continue;
      // 全局总闸：同一号码每周(默认7天)最多 1 条任意类型短信
      const gCap = await globalSmsCapped(pool, phone, tenantId);
      if (gCap) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: job.campaign_id || 'svremind', rule_key: 'stored_value_remind',
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'skipped',
          payload: { phone, template_param: templateParam, campaign_id: job.campaign_id, reason: 'global_capped' },
          result: {}, error_message: '触发全局短信总闸(每周最多1条)，已跳过'
        }, tenantId).catch(() => null);
        continue;
      }
      try {
        const result = await sendAliyunSms({ phoneNumbers: phone, templateCode, templateParam });
        const cust = await upsertCustomer(pool, { phone, store_id: storeId }, tenantId).catch(() => null);
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: job.campaign_id || 'svremind', rule_key: 'stored_value_remind',
          customer_id: cust?.id || null, store_id: storeId, channel: 'sms', external_userid: '',
          provider_msg_id: result.provider_msg_id, status: 'sent',
          payload: { phone, template_param: templateParam, campaign_id: job.campaign_id }, result: result.raw || {}
        }, tenantId);
        await insertGrowthEvent(pool, {
          event_type: 'marketing_triggered', customer_id: cust?.id || null, phone, external_userid: null,
          store_id: storeId, campaign_id: job.campaign_id, channel: 'sms', coupon_id: null,
          idempotency_key: `marketing_triggered:svremind:${job.id}:${phone}`,
          metadata: { rule_key: 'stored_value_remind', delivery_key: deliveryKey, provider_msg_id: result.provider_msg_id, template_code: templateCode, template_param: templateParam }
        }, tenantId);
        sent++;
      } catch (err) {
        await upsertDeliveryLog(pool, {
          delivery_key: deliveryKey, action_key: job.campaign_id || 'svremind', rule_key: 'stored_value_remind',
          customer_id: null, store_id: storeId, channel: 'sms', external_userid: '', status: 'failed',
          payload: { phone, template_param: templateParam, campaign_id: job.campaign_id }, result: {},
          error_message: err?.message || 'sms_send_failed'
        }, tenantId).catch(() => null);
        await handleSmsFailure(pool, phone, err?.message, tenantId);
        failed++;
      }
    }
    await pool.query(`UPDATE growth_campaign_jobs SET sent=$2, failed=$3, status='done', updated_at=now() WHERE id=$1`,
      [job.id, sent, failed]);
  }
  if (!globalThis.__growthRemindWorker) {
    globalThis.__growthRemindWorker = true;
    setInterval(() => {
      runForActiveTenants(() => processOneRemindJob())
        .catch((e) => log.warn({ msg: 'svremind_worker_failed', err: e?.message }));
    }, 30 * 1000);
  }

  // 储值余额提醒·定时自动触发器：每日为每个有储值客的门店自动冻结一条 remind 任务，
  // 由上面的 processOneRemindJob worker 认领下发(只发 {balance}，无券无码)。
  // 治理门：仅在短信总闸(ALIYUN_SMS_ENABLED)开启时才冻结(开关默认关 → 全部静默)。
  // 口径与频控同 /remind/launch：余额≥min + 久未消费(dormant_days) + remind 类 N 天不重发 + 全局总闸。
  // 幂等：同店同日一条任务(campaign_id=auto_svremind_<store>_<日期>)，定时器多跑也不会重复冻结。
  async function enqueueAutoStoredValueReminds() {
    if (!isAliyunSmsAutoSendEnabled()) return { enqueued: 0, skipped: 'sms_switch_off' };
    // 治理门：把「储值余额提醒」收编为自动营销里的一条规则(rule_key='stored_value_remind')，
    // 必须 规则启用 + 已审核 + auto_execute 才自动跑(与其它活动制规则同一治理口径)。
    const rr = await pool.query(
      `SELECT enabled, approved_at, auto_execute, criteria FROM growth_touch_rules WHERE rule_key = 'stored_value_remind' LIMIT 1`
    );
    const rule = rr.rows[0];
    if (!rule || !rule.enabled || !rule.approved_at || rule.auto_execute === false) {
      return { enqueued: 0, skipped: 'governance' };
    }
    const crit = (rule.criteria && typeof rule.criteria === 'object') ? rule.criteria : {};
    const dormantDays = Math.max(0, Math.floor(Number(crit.dormant_days) || Number(process.env.ALIYUN_SMS_REMIND_AUTO_DORMANT_DAYS) || 30));
    const minBalanceFen = Math.max(0, Math.floor((Number(crit.min_balance_yuan) || Number(process.env.ALIYUN_SMS_REMIND_AUTO_MIN_BALANCE_YUAN) || 1) * 100));
    const maxTargets = Math.min(Math.max(Number(process.env.ALIYUN_SMS_REMIND_AUTO_MAX_TARGETS) || 1000, 1), 2000);
    const freqDays = freqDaysEnv('ALIYUN_SMS_REMIND_FREQUENCY_DAYS', 30);
    const today = new Date().toISOString().slice(0, 10);
    const stores = await pool.query(
      `SELECT DISTINCT store_id FROM growth_stored_value_members WHERE store_id IS NOT NULL AND store_id <> ''`
    );
    let enqueued = 0;
    for (const s of stores.rows) {
      const storeId = String(s.store_id || '').trim();
      if (!storeId) continue;
      const templateCode = pickBalanceTemplateByStore(storeId);
      if (!templateCode) continue; // 该门店余额模板未配置 → 跳过，防整批拒收
      const campaignId = `auto_svremind_${storeId}_${today}`;
      const exist = await pool.query(`SELECT 1 FROM growth_campaign_jobs WHERE campaign_id = $1 LIMIT 1`, [campaignId]);
      if (exist.rows.length) continue; // 当日已冻结
      const q = buildRemindTargetsQuery(storeId, dormantDays, minBalanceFen, freqDays, maxTargets);
      const r = await pool.query(q.sql, q.params);
      const targets = r.rows.map((x) => ({ phone: x.phone, name: x.member_name || '', card_no: x.card_no, balance_yuan: Math.round((x.balance_fen || 0) / 100) }));
      if (!targets.length) continue;
      await pool.query(
        `INSERT INTO growth_campaign_jobs (campaign_id, store_id, value_yuan, valid_days, dormant_days, min_balance_fen, targets, total, status, kind, created_by, result, tenant_id)
         VALUES ($1,$2,0,0,$3,$4,$5::jsonb,$6,'pending','stored_value_remind',$7,$8::jsonb,$9)`,
        [campaignId, storeId, dormantDays, minBalanceFen, JSON.stringify(targets), targets.length, 'auto_scheduler', JSON.stringify({ template_code: templateCode }), resolveTenantIdDefault()]
      );
      enqueued += targets.length;
    }
    return { enqueued };
  }
  if (!globalThis.__growthRemindAutoTimer) {
    globalThis.__growthRemindAutoTimer = setInterval(() => {
      runForActiveTenants(() => enqueueAutoStoredValueReminds()).catch((e) => log.warn({ msg: 'svremind_auto_enqueue_failed', err: e?.message }));
    }, 60 * 60 * 1000);
    setTimeout(() => {
      runForActiveTenants(() => enqueueAutoStoredValueReminds()).catch((e) => log.warn({ msg: 'svremind_initial_auto_enqueue_failed', err: e?.message }));
    }, 20000);
  }

  // T+7 SMS自动回填：每天跑一次；启动后延迟60s首跑（等DB连接稳定）
  if (!globalThis.__smsBackfillTimer) {
    globalThis.__smsBackfillTimer = setInterval(() => {
      runForActiveTenants(() => autoBackfillSmsActions(pool)).then((rows) => {
        const n = rows.reduce((sum, value) => sum + (Number(value) || 0), 0);
        if (n > 0) log.info({ msg: 'sms_backfill_auto', actions: n });
      }).catch((e) => log.warn({ msg: 'sms_backfill_failed', err: e?.message }));
    }, 24 * 60 * 60 * 1000);
    setTimeout(() => {
      runForActiveTenants(() => autoBackfillSmsActions(pool)).then((rows) => {
        const n = rows.reduce((sum, value) => sum + (Number(value) || 0), 0);
        if (n > 0) log.info({ msg: 'sms_backfill_initial', actions: n });
      }).catch((e) => log.warn({ msg: 'sms_backfill_initial_failed', err: e?.message }));
    }, 60000);
  }
}
