/**
 * Phase ⑤：轻量需求治理池
 * 落实「单店不做 / 配置解决 / 共有评估 / 拒绝」——不做复杂工单系统。
 */
export const DEMAND_VERDICTS = {
  reject_single_store: { label: '单家客户需要：不做', enter_eng: false },
  config_solve: { label: '可通过配置解决', enter_eng: false },
  evaluate_common: { label: '多数餐厅共有：进入评估', enter_eng: false },
  prioritize_renewal: { label: '提升续费/降服务成本：优先', enter_eng: true },
  reject_complexity: { label: '只增加复杂度：拒绝', enter_eng: false },
};

let ensurePromise = null;

export async function ensureDemandTables(pool) {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenant_demand_requests (
        id BIGSERIAL PRIMARY KEY,
        tenant_id VARCHAR(80) NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        detail TEXT,
        source TEXT DEFAULT 'cs',
        verdict TEXT NOT NULL DEFAULT 'evaluate_common',
        status TEXT NOT NULL DEFAULT 'logged',
        enter_eng BOOLEAN NOT NULL DEFAULT FALSE,
        created_by TEXT,
        decided_by TEXT,
        decision_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tdr_tenant ON tenant_demand_requests (tenant_id, created_at DESC)`);
  })().catch((e) => { ensurePromise = null; throw e; });
  return ensurePromise;
}

export async function createDemandRequest(pool, body = {}) {
  await ensureDemandTables(pool);
  const title = String(body.title || '').trim();
  if (!title) return { ok: false, error: 'title_required' };
  let verdict = String(body.verdict || 'evaluate_common').trim();
  if (!DEMAND_VERDICTS[verdict]) verdict = 'evaluate_common';
  const enterEng = !!DEMAND_VERDICTS[verdict].enter_eng || !!body.enter_eng;
  const r = await pool.query(
    `INSERT INTO tenant_demand_requests
      (tenant_id, title, detail, source, verdict, status, enter_eng, created_by, decided_by, decision_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      String(body.tenant_id || '').trim(),
      title.slice(0, 200),
      String(body.detail || '').slice(0, 2000),
      String(body.source || 'cs').slice(0, 40),
      verdict,
      enterEng ? 'queued_eng' : (verdict.startsWith('reject') ? 'rejected' : 'logged'),
      enterEng,
      String(body.created_by || '').slice(0, 80),
      String(body.created_by || '').slice(0, 80),
      DEMAND_VERDICTS[verdict].label,
    ]
  );
  return { ok: true, item: r.rows[0], verdicts: DEMAND_VERDICTS };
}

export async function listDemandRequests(pool, opts = {}) {
  await ensureDemandTables(pool);
  const r = await pool.query(
    `SELECT * FROM tenant_demand_requests
      WHERE ($1::text='' OR tenant_id=$1)
      ORDER BY created_at DESC LIMIT 100`,
    [String(opts.tenant_id || '').trim()]
  );
  return { ok: true, items: r.rows || [], verdicts: DEMAND_VERDICTS };
}
