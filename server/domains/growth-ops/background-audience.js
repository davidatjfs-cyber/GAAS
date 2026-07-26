/**
 * Growth background workers — P5.4 extract from registerGrowthRoutes.
 */
export function startGrowthAudienceWorkers(deps) {
  const {
    pool,
    runForActiveTenants,
    tenantContext,
    resolveTenantIdDefault,
    cleanText,
    cleanPhone,
    setTouchRulesAudienceGetter,
    loadSegmentPhoneSet,
    fetchGenericRuleCandidates,
  } = deps;

  // 每条规则当前「涉及会员数」（命中人群且可触达：有企微外部联系人或手机号）。
  // 用于前台展示活动覆盖范围，让管理员审核前清楚知道这次会发给多少人。
  //
  // 性能要点：这是一次全量人群扫描(冷启动约5秒，占用一个数据库连接)。绝不能放在
  // 用户请求(尤其是"保存规则")的同步路径上——否则该扫描会和保存抢连接池，让保存也卡5秒，
  // 表现为"一改发送频率/有效期就死机"。因此这里改为：后台定时刷新缓存，HTTP 请求只读缓存、
  // 永不同步触发重算(仅服务刚启动、缓存还空时兜底算一次)。
  const __touchRulesAudienceCache = new Map();
  const __touchRulesAudienceComputing = new Map();

  function audienceCacheKey(tenantId, storeId = '') {
    return `${resolveTenantIdDefault(tenantId)}::${cleanText(storeId, 128) || 'ALL'}`;
  }

  function invalidateTouchRulesAudienceCache(tenantId = resolveTenantIdDefault()) {
    const prefix = `${resolveTenantIdDefault(tenantId)}::`;
    for (const key of __touchRulesAudienceCache.keys()) {
      if (key.startsWith(prefix)) __touchRulesAudienceCache.delete(key);
    }
  }

  async function computeTouchRulesAudience(options = {}) {
    const storeFilter = cleanText(options.storeId || '', 128);
    const rulesResult = await pool.query(`SELECT * FROM growth_touch_rules ORDER BY rule_key ASC`);
    const audience = {};
    // 性能：通用人群表只扫一次，19 条规则在内存复用过滤，避免逐规则各扫 13k 行(旧版~30s)。
    // 生日规则(loyal_birthday_month) / 余额规则(channel=balance)人群口径不同，仍各自单独查询(均很轻)。
    let genericRows = null;
    const segmentCache = new Map(); // segment_key → 手机号Set，多条同标签规则复用
    for (const rule of (rulesResult.rows || [])) {
      try {
        // 储值余额提醒(channel=balance)的人群在 growth_stored_value_members，不在 customer_profiles，
        // 口径=有手机号 + 余额≥min + 久未消费(dormant_days)，与短信直发目标一致。
        if (String((rule.action_payload || {}).channel || '') === 'balance') {
          const crit = (rule.criteria && typeof rule.criteria === 'object') ? rule.criteria : {};
          const dormantDays = Math.max(0, Math.floor(Number(crit.dormant_days) || 30));
          const minBalanceFen = Math.max(0, Math.floor((Number(crit.min_balance_yuan) || 1) * 100));
          const br = await pool.query(
            `SELECT count(*)::int AS n FROM growth_stored_value_members m
               WHERE m.phone IS NOT NULL AND m.phone <> '' AND m.balance_fen >= $1
                 AND (m.last_consume_date IS NULL OR m.last_consume_date <= (CURRENT_DATE - ${dormantDays}))`,
            [minBalanceFen]
          );
          const n = Number(br.rows?.[0]?.n) || 0;
          audience[rule.rule_key] = { total: n, sms: n, subscribe: 0, member: 0, wecom: 0 };
          continue;
        }
        let candidates;
        if (rule.rule_key === 'loyal_birthday_month') {
          // 生日规则有独立(轻量 LIMIT 500)查询口径，仍走原函数
          candidates = await loadRuleCandidates(pool, rule);
        } else {
          if (!genericRows) genericRows = await fetchGenericRuleCandidates(pool);
          // 时段标签规则：取该 segment 的手机号集合(按 segment_key 缓存，避免重复查询)
          const segKey = (rule.criteria || {}).segment_key || '';
          let segSet = null;
          if (segKey) {
            if (!segmentCache.has(segKey)) segmentCache.set(segKey, await loadSegmentPhoneSet(pool, segKey));
            segSet = segmentCache.get(segKey);
          }
          candidates = filterGenericRuleCandidates(genericRows, rule, segSet, storeFilter);
        }
        // 分渠道覆盖：短信=有手机号；订阅消息/小程序站内券=有 openid（上限，订阅另受授权限制）；企微=有外部联系人。
        let sms = 0, subscribe = 0, member = 0, wecom = 0;
        for (const c of (candidates || [])) {
          if (cleanPhone(c.phone)) sms++;
          if (cleanText(c.openid || '', 128)) { subscribe++; member++; }
          if (c.external_userid) wecom++;
        }
        audience[rule.rule_key] = { total: (candidates || []).length, sms, subscribe, member, wecom };
      } catch (e) {
        audience[rule.rule_key] = null; // 计算失败标记为未知，不阻断
      }
    }
    return audience;
  }
  // 后台刷新缓存（去重并发；按 tenant+store 分桶，避免切换门店仍命中全店缓存）。
  function refreshTouchRulesAudienceCache(tenantId = resolveTenantIdDefault(), storeId = '') {
    const effectiveTenantId = resolveTenantIdDefault(tenantId);
    const cacheKey = audienceCacheKey(effectiveTenantId, storeId);
    if (__touchRulesAudienceComputing.has(cacheKey)) return __touchRulesAudienceComputing.get(cacheKey);
    const pending = computeTouchRulesAudience({ storeId })
      .then((a) => {
        __touchRulesAudienceCache.set(cacheKey, { data: a, at: Date.now() });
        return a;
      })
      .finally(() => { __touchRulesAudienceComputing.delete(cacheKey); });
    __touchRulesAudienceComputing.set(cacheKey, pending);
    return pending;
  }
  // 供拆分出的 growth-winback-routes.js 的 /api/growth/touch-rules/audience 路由读取同一份缓存。
  setTouchRulesAudienceGetter(async (tenantId, storeId, forceRefresh) => {
    const cacheKey = audienceCacheKey(tenantId, storeId);
    const cachedAudience = __touchRulesAudienceCache.get(cacheKey);
    if (!forceRefresh && cachedAudience?.data) {
      const stale = Date.now() - cachedAudience.at > 180000;
      if (stale) tenantContext.run(tenantId, () => refreshTouchRulesAudienceCache(tenantId, storeId)).catch(() => {});
      return { audience: cachedAudience.data, cached: true, stale };
    }
    const a = await tenantContext.run(tenantId, () => refreshTouchRulesAudienceCache(tenantId, storeId));
    return { audience: a };
  });
  // 暴露给 POST 规则改动后触发后台重算（见 /api/growth/touch-rules）。
  globalThis.__refreshGrowthAudience = (tenantId) => {
    invalidateTouchRulesAudienceCache(tenantId);
    tenantContext.run(resolveTenantIdDefault(tenantId), () => refreshTouchRulesAudienceCache(tenantId)).catch(() => {});
  };
  // 服务启动后预热一次，并每 10 分钟后台刷新，确保 HTTP 请求始终命中缓存、不阻塞。
  if (!globalThis.__growthAudienceTimer) {
    setTimeout(() => runForActiveTenants((tenantId) => refreshTouchRulesAudienceCache(tenantId)).catch(() => {}), 15000);
    globalThis.__growthAudienceTimer = setInterval(() => {
      runForActiveTenants((tenantId) => refreshTouchRulesAudienceCache(tenantId)).catch(() => {});
    }, 10 * 60 * 1000);
  }
}
