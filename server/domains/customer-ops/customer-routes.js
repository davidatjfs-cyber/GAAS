/**
 * Customer-ops customer profile routes (P5.4).
 */

export function registerCustomerOpsCustomerRoutes(app, deps) {
  const {
    pool, authRequired, basePath, getTenantId, ensureCustomerOpsTables,
    applySegmentCriteria,
  } = deps;
  // ── 模块2：360度客人档案 ─────────────────────────────────────────

  app.get(`${basePath}/customers`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const diagnosisId = Number(req.query.diagnosis_id || 0);
      const limit = Math.min(500, Number(req.query.limit || 200));
      const params = [tenantId];
      let where = 'tenant_id = $1';
      if (diagnosisId) { params.push(diagnosisId); where += ` AND diagnosis_id = $${params.length}`; }
      const r = await pool.query(`SELECT profile_json FROM customer_ops_profiles WHERE ${where} ORDER BY (profile_json->>'total_spend')::numeric DESC NULLS LAST LIMIT ${limit}`, params);
      res.json({ ok: true, customers: r.rows.map((x) => x.profile_json) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get(`${basePath}/customers/dashboard`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const diagnosisId = Number(req.query.diagnosis_id || 0);
      const params = [tenantId];
      let where = 'tenant_id = $1';
      if (diagnosisId) { params.push(diagnosisId); where += ` AND diagnosis_id = $${params.length}`; }
      // 只取最新一个diagnosis的所有profile
      if (!diagnosisId) {
        const latest = await pool.query(`SELECT id FROM customer_ops_diagnoses WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [tenantId]);
        if (latest.rows.length) { params.push(latest.rows[0].id); where += ` AND diagnosis_id = $${params.length}`; }
      }
      const r = await pool.query(`SELECT profile_json FROM customer_ops_profiles WHERE ${where}`, params);
      const profiles = r.rows.map((x) => x.profile_json || {});
      const total = profiles.length;
      const byLifecycle = {};
      const byValueTier = {};
      const byScene = {};
      let totalSpend = 0;
      let totalVip = 0;
      let totalDormant = 0;
      let totalWithPhone = 0;
      for (const c of profiles) {
        byLifecycle[c.lifecycle_stage] = (byLifecycle[c.lifecycle_stage] || 0) + 1;
        byValueTier[c.value_tier] = (byValueTier[c.value_tier] || 0) + 1;
        for (const tag of c.scene_tags || []) byScene[tag] = (byScene[tag] || 0) + 1;
        totalSpend += Number(c.total_spend || 0);
        if (c.value_tier === 'vip') totalVip++;
        if (c.lifecycle_stage === 'dormant') totalDormant++;
        if (c.phone) totalWithPhone++;
      }
      res.json({ ok: true, total, total_spend: Math.round(totalSpend), vip_count: totalVip, dormant_count: totalDormant, reachable_count: totalWithPhone, by_lifecycle: byLifecycle, by_value_tier: byValueTier, by_scene: byScene });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.post(`${basePath}/customers/filter`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const tenantId = getTenantId(req);
      const criteria = req.body?.criteria || {};
      const diagnosisId = Number(req.body?.diagnosis_id || 0);
      const params = [tenantId];
      let where = 'tenant_id = $1';
      if (diagnosisId) { params.push(diagnosisId); where += ` AND diagnosis_id = $${params.length}`; }
      else {
        const latest = await pool.query(`SELECT id FROM customer_ops_diagnoses WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [tenantId]);
        if (latest.rows.length) { params.push(latest.rows[0].id); where += ` AND diagnosis_id = $${params.length}`; }
      }
      const r = await pool.query(`SELECT profile_json FROM customer_ops_profiles WHERE ${where}`, params);
      const all = r.rows.map((x) => x.profile_json || {});
      const matched = applySegmentCriteria(all, criteria);
      res.json({ ok: true, total: all.length, matched: matched.length, customers: matched.slice(0, 200) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get(`${basePath}/customers/:customerId`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT profile_json FROM customer_ops_profiles WHERE tenant_id = $1 AND customer_id = $2 ORDER BY diagnosis_id DESC LIMIT 1`, [getTenantId(req), req.params.customerId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      res.json({ ok: true, customer: r.rows[0].profile_json });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  // 保存自定义客群分层
}
