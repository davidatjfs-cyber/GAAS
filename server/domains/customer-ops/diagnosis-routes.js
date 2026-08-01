/**
 * Customer-ops diagnosis routes (P5.4).
 */
import path from 'path';
import { ingestPosOrders } from '../../growth-phases.js';
import { recomputeCustomerProfiles } from '../../growth-api.js';
import { syncOntologyDataFromProduction } from '../../ontology/real-data-sync.js';
import { runDailyDiagnosis } from '../../ontology/diagnosis-tree-service.js';
import { ensureGrowthOntologyCore } from '../../ontology/growth-ontology-schema.js';
import { tenantContext } from '../../utils/database.js';
import { analyzeOrders, normalizeWorkbook } from './workbook-analysis.js';
import { runPdfGenerator } from './ops-helpers.js';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'customer-ops', handler: 'diagnosis-routes' });

export function registerCustomerOpsDiagnosisRoutes(app, deps) {
  const {
    pool, authRequired, upload, uploadsDir, recordUploadOwnership, callLLM,
    basePath, getTenantId, ensureCustomerOpsTables,
    dedupeRecords, loadExistingSourceRecords, mergeDiagnostics, toPosOrderPayload,
    generateDiagnosisNarrative,
  } = deps;
  // ── 模块1：快速诊断 ──────────────────────────────────────────────

  app.post(`${basePath}/diagnosis/upload`, authRequired, upload.fields([{ name: 'files', maxCount: 20 }, { name: 'file', maxCount: 1 }]), async (req, res) => {
    try {
      const files = [...(req.files?.files || []), ...(req.files?.file || [])].filter(Boolean);
      if (!files.length) return res.status(400).json({ ok: false, error: 'no_file' });
      await ensureCustomerOpsTables(pool);
      await recordUploadOwnership(files.map((f) => f.filename), getTenantId(req), req.user?.username);
      const tenantId = getTenantId(req);
      const parsed = await Promise.all(files.map((file) => normalizeWorkbook(file.path, { sourceFile: file.originalname || file.filename })));
      const batchRecords = dedupeRecords(parsed.flatMap((x) => x.orders || []));
      const mergePrevious = String(req.body?.merge_previous ?? 'true') !== 'false';
      const existingRecords = mergePrevious ? await loadExistingSourceRecords(pool, tenantId) : [];
      const orders = dedupeRecords([...existingRecords, ...batchRecords]);
      const diagnostics = mergeDiagnostics(parsed.map((x) => x.diagnostics));
      diagnostics.batch_files = files.map((f) => f.originalname || f.filename);
      diagnostics.batch_records = batchRecords.length;
      diagnostics.historical_records = existingRecords.length;
      diagnostics.total_records_after_merge = orders.length;
      const report = analyzeOrders(orders, { storeName: req.body?.store_name || '', diagnostics });
      const ins = await pool.query(
        `INSERT INTO customer_ops_diagnoses (tenant_id, store_name, source_filename, report_json, created_by) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING id, created_at`,
        [tenantId, report.store_name, files.map((f) => f.originalname || f.filename).join('、'), JSON.stringify(report), req.user?.username || '']
      );
      const diagnosisId = ins.rows[0].id;
      for (const r of batchRecords) {
        await pool.query(
          `INSERT INTO customer_ops_source_records (tenant_id, diagnosis_id, source_filename, record_key, phone, member_no, record_kind, record_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (tenant_id, record_key) DO UPDATE SET diagnosis_id=EXCLUDED.diagnosis_id, source_filename=EXCLUDED.source_filename, phone=EXCLUDED.phone, member_no=EXCLUDED.member_no, record_kind=EXCLUDED.record_kind, record_json=EXCLUDED.record_json`,
          [tenantId, diagnosisId, r.sourceFile || '', r.recordKey || '', r.phone || '', r.memberNo || '', r.kind || 'unknown', JSON.stringify(r)]
        );
      }
      for (const c of report.customers) {
        await pool.query(
          `INSERT INTO customer_ops_profiles (tenant_id, diagnosis_id, customer_id, customer_key, phone, profile_json) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [tenantId, diagnosisId, c.customer_id, c.customer_key, c.phone || '', JSON.stringify(c)]
        );
      }
      let posSync = { orders_synced: 0, items_synced: 0 };
      let ontologySync = { profiles_recomputed: false, ontology_synced: false, issues: 0, opportunities: 0, stores_diagnosed: 0 };
      try {
        const posPayload = toPosOrderPayload(batchRecords);
        if (posPayload.orders.length) {
          const synced = await tenantContext.run(tenantId, () => ingestPosOrders(pool, tenantId, posPayload));
          posSync = { orders_synced: synced.ordersUpserted, items_synced: synced.itemsUpserted };
        }
        // 有新订单落库后，把「pos_orders -> growth_customer_profiles -> growth_ontology_* -> 每日诊断/机会清单」
        // 这条链路整体跑一遍，否则诊断服务读的表要等到下一次定时任务才会更新，客户上传完看到的仍是空数据。
        // 触达明细由 syncOntologyDataFromProduction 从 growth_delivery_logs 同步进 growth_ontology_touches。
        if (posSync.orders_synced > 0) {
          await tenantContext.run(tenantId, () => recomputeCustomerProfiles(pool, 90, tenantId));
          ontologySync.profiles_recomputed = true;
          await ensureGrowthOntologyCore(pool);
          await syncOntologyDataFromProduction(pool, tenantId);
          ontologySync.ontology_synced = true;
          // runDailyDiagnosis 是按单店跑的（不传 store_id 会直接返回 insufficient_data），
          // 所以要对本批数据涉及的每个门店各跑一次，而不是整租户跑一次。
          const storeIds = Array.from(new Set(posPayload.orders.map((o) => o.store_id).filter(Boolean)));
          for (const storeId of storeIds) {
            const diagResult = await runDailyDiagnosis(pool, { tenantId, storeId });
            ontologySync.issues += (diagResult?.issues || []).length;
            ontologySync.opportunities += (diagResult?.opportunities || []).length;
          }
          ontologySync.stores_diagnosed = storeIds.length;
        }
      } catch (e) {
        log.warn({ msg: 'customer_ops_pos_orders_ontology_sync_skipped', err: e?.message });
      }
      res.json({ ok: true, diagnosis_id: diagnosisId, imported_records: batchRecords.length, merged_records: orders.length, pos_sync: posSync, ontology_sync: ontologySync, report: { ...report, customers: undefined } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || 'diagnosis_failed' });
    }
  });

  app.get(`${basePath}/diagnosis/latest`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT id, store_name, source_filename, report_json, created_at FROM customer_ops_diagnoses WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`, [getTenantId(req)]);
      res.json({ ok: true, diagnosis: r.rows[0] || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message });
    }
  });

  app.get(`${basePath}/diagnosis/:id/pdf`, authRequired, async (req, res) => {
    try {
      await ensureCustomerOpsTables(pool);
      const r = await pool.query(`SELECT * FROM customer_ops_diagnoses WHERE id = $1 AND tenant_id = $2`, [req.params.id, getTenantId(req)]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      const report = r.rows[0].report_json;
      // 生成AI诊断叙述（失败不阻塞PDF生成）
      const narrative = callLLM ? await generateDiagnosisNarrative(report, callLLM).catch(() => null) : null;
      const reportWithNarrative = narrative ? { ...report, narrative } : report;
      const filename = `customer_ops_report_${req.params.id}.pdf`;
      const outputPath = path.join(uploadsDir, filename);
      await runPdfGenerator(reportWithNarrative, outputPath);
      await recordUploadOwnership(filename, getTenantId(req), req.user?.username);
      res.json({ ok: true, url: `/uploads/${filename}` });
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || 'pdf_failed' });
    }
  });

}
