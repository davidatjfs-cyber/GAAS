/**
 * Inventory forecast + sales-raw dish-alias — pure business logic (no req/res).
 * Returns { ok, status?, error?, message?, ...payload }.
 */
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { childLogger } from '../../utils/logger.js';
import {
  parsePredictForecastInput,
  loadPredictForecastHistory,
  buildPredictForecastOutput,
  persistPredictForecastState,
} from './predict-forecast-helpers.js';

const log = childLogger({ domain: 'inventory-forecast', handler: 'service' });

export async function listHistory(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const bizType = ctx.normalizeForecastBizType(input.query?.bizType);
    const slot = ctx.normalizeForecastSlot(input.query?.slot);
    const start = ctx.safeDateOnly(input.query?.start);
    const end = ctx.safeDateOnly(input.query?.end);
    const qStore = String(input.query?.store || '').trim();
    const limit = Math.max(1, Math.min(1000, Number(input.query?.limit || 300) || 300));

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      const today = new Date().toISOString().slice(0, 10);
      const salesRawItems = await ctx.loadInventoryForecastHistoryFromSalesRaw({
        storeScope: [store],
        bizType,
        slot,
        startDate: start || ctx.shiftForecastDate(end || today, -180),
        endDate: end || today
      });
      const items = salesRawItems.slice(0, limit);
      return { ok: true,
        store,
        bizType: bizType || '',
        slot: slot || '',
        storageSource: salesRawItems.length ? 'pos_sales_detail' : 'inventoryForecastHistory',
        items
      };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function clearHistory(ctx, input) {

    const role = String(input.role || '').trim();
    if (role !== 'admin') return { ok: false, status: 403, error: 'admin_only' };
    try {
      const state0 = (await ctx.getSharedState()) || {};
      const qStore = String(input.query?.store || input.body?.store || '').trim();
      const prevCount = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory.length : 0;
      if (qStore) {
        state0.inventoryForecastHistory = (state0.inventoryForecastHistory || []).filter((x) => String(x?.store || '').trim() !== qStore);
        state0.inventoryForecastPredictions = (state0.inventoryForecastPredictions || []).filter((x) => String(x?.store || '').trim() !== qStore);
        state0.inventoryForecastEvaluations = (state0.inventoryForecastEvaluations || []).filter((x) => String(x?.store || '').trim() !== qStore);
      } else {
        state0.inventoryForecastHistory = [];
        state0.inventoryForecastPredictions = [];
        state0.inventoryForecastEvaluations = [];
      }
      await ctx.saveSharedState(state0);
      const afterCount = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory.length : 0;
      // 严禁在此删除 sales_raw：无 store 参数时曾误执行 DELETE FROM sales_raw 全表，导致生产数据被清空。
      return { ok: true, cleared: prevCount - afterCount, remaining: afterCount, store: qStore || '(all)' };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function batchHistory(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const bizType = ctx.normalizeForecastBizType(input.body?.bizType);
    const slot = ctx.normalizeForecastSlot(input.body?.slot);
    if (!bizType) return { ok: false, status: 400, error: 'invalid_biz_type' };
    if (!slot) return { ok: false, status: 400, error: 'invalid_slot' };
    const rowsRaw = Array.isArray(input.body?.rows) ? input.body.rows : [];
    if (!rowsRaw.length) return { ok: false, status: 400, error: 'missing_rows' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const storeBody = String(input.body?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : storeBody;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };
      const ret = ctx.upsertInventoryForecastHistoryInState(state0, { store, bizType, slot, rowsRaw, username });
      await ctx.saveSharedState(ret.state);

      return {
        ok: true,
        store,
        bizType,
        slot,
        inserted: ret.inserted,
        updated: ret.updated,
        skipped: ret.skipped,
        accepted: ret.accepted,
        evaluated: ret.evaluated
      };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function uploadHistoryFile(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const qStore = String(input.body?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      const file = input.file || null;
      if (!file?.path) return { ok: false, status: 400, error: 'missing_file' };
      const ext = String(path.extname(String(file.originalname || file.path || '')).toLowerCase()).trim();
      const mime = String(file.mimetype || '').toLowerCase();
      const selectedBizType = ctx.normalizeForecastBizType(input.body?.bizType) || '';
      if (!selectedBizType) return { ok: false, status: 400, error: 'invalid_biz_type', message: '请选择业务类型（外卖/堂食）后再上传。' };
      // Strict mode: do not inject selected bizType as parser fallback, otherwise we cannot detect wrong-file uploads.
      const fallbackBizType = '';
      const fallbackDateFromName = ctx.inferForecastUploadDateFromFilename(String(file.originalname || file.path || ''));
      let parsedRows = [];
      let parseMode = '';
      const parseErrors = [];
      let __debugMatrixSample = [];
      // Save a copy for debugging
      try { fs.copyFileSync(file.path, path.join(ctx.uploadsDir, '__last_inventory_upload' + ext)); } catch (e) { /* ignore */ }
      const tryParseExcel = () => {
        const wb = XLSX.readFile(file.path, { raw: false });
        const sheetNames = Array.isArray(wb.SheetNames) ? wb.SheetNames : [];
        if (!sheetNames.length) throw new Error('empty_sheets');
        for (let si = 0; si < sheetNames.length; si += 1) {
          const sn = String(sheetNames[si] || '').trim();
          if (!sn) continue;
          const ws = wb.Sheets[sn];
          if (!ws) continue;
          const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
          if (!__debugMatrixSample.length && matrix.length) {
            __debugMatrixSample = matrix.slice(0, 12).map(r => Array.isArray(r) ? r.map(c => String(c ?? '').slice(0, 40)) : []);
            log.debug({
              msg: 'inventory_upload_excel_matrix_sample',
              rows: __debugMatrixSample.length,
              sample: JSON.stringify(__debugMatrixSample).slice(0, 500),
            });
          }
          const out = ctx.parseInventoryForecastRowsFromTableMatrix(matrix, fallbackBizType, {
            fallbackDate: fallbackDateFromName,
            allowTodayFallbackDate: true
          });
          if (out.length) return out;
        }
        return [];
      };
      const tryParseCsv = () => {
        const rawText = fs.readFileSync(file.path, 'utf8');
        const matrix = String(rawText || '')
          .replace(/^﻿/, '')
          .split(/\r?\n/)
          .map((line) => String(line || '').trim())
          .filter(Boolean)
          .map((line) => String(line).split(','));
        return ctx.parseInventoryForecastRowsFromTableMatrix(matrix, fallbackBizType, {
          fallbackDate: fallbackDateFromName,
          allowTodayFallbackDate: true
        });
      };

      const extLooksExcel = ext === '.xlsx' || ext === '.xls';
      const extLooksPdf = ext === '.pdf';
      const mimeLooksExcel = mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('sheet');
      const mimeLooksPdf = mime.includes('application/pdf') || mime.includes('/pdf');
      const unknownType = !ext;

      if (extLooksExcel || mimeLooksExcel || unknownType) {
        parseMode = parseMode ? `${parseMode}|excel_attempt` : 'excel_attempt';
        try {
          parsedRows = tryParseExcel();
          if (parsedRows.length) parseMode = 'excel';
        } catch (e) {
          parseErrors.push(`excel:${String(e?.message || e)}`);
        }
      }
      if (!parsedRows.length) {
        if (extLooksPdf || mimeLooksPdf) {
          parseMode = parseMode ? `${parseMode}|pdf_attempt` : 'pdf_attempt';
          try {
            log.debug({ msg: 'inventory_upload_pdftotext_attempt', path: file.path });
            parsedRows = ctx.parseInventoryForecastRowsFromPdfPath(file.path, fallbackBizType, {
              fallbackDate: fallbackDateFromName,
              allowTodayFallbackDate: true
            });
            log.debug({ msg: 'inventory_upload_pdftotext_rows', rows: parsedRows.length });
            if (!parsedRows.length) {
              log.debug({ msg: 'inventory_upload_pdf_buffer_attempt' });
              const pdfBuffer = fs.readFileSync(file.path);
              parsedRows = ctx.parseInventoryForecastRowsFromPdfBuffer(pdfBuffer, fallbackBizType, {
                fallbackDate: fallbackDateFromName,
                allowTodayFallbackDate: true
              });
              log.debug({ msg: 'inventory_upload_pdf_buffer_rows', rows: parsedRows.length });
            }
            if (parsedRows.length) parseMode = 'pdf';
          } catch (e) {
            log.warn({ msg: 'inventory_upload_pdf_parse_failed', err: String(e?.message || e) });
            parseErrors.push(`pdf:${String(e?.message || e)}`);
          }
        }
      }
      if (!parsedRows.length) {
        parseMode = parseMode ? `${parseMode}|csv_attempt` : 'csv_attempt';
        try {
          parsedRows = tryParseCsv();
          if (parsedRows.length) parseMode = 'csv';
        } catch (e) {
          parseErrors.push(`csv:${String(e?.message || e)}`);
        }
      }
      if (!parsedRows.length && !(extLooksExcel || mimeLooksExcel || unknownType)) {
        // For explicit non-excel extensions, still give Excel parser one last chance.
        parseMode = parseMode ? `${parseMode}|excel_fallback_attempt` : 'excel_fallback_attempt';
        try {
          parsedRows = tryParseExcel();
          if (parsedRows.length) parseMode = 'excel_fallback';
        } catch (e) {
          parseErrors.push(`excel_fallback:${String(e?.message || e)}`);
        }
      }
      if (!parsedRows.length) {
        const debugMsg = `文件:${String(file.originalname || 'unknown')} ext:${ext || 'none'} mime:${mime || 'none'} 模式:${parseMode || 'none'}${parseErrors.length ? ` 错误:${String(parseErrors[0] || '').slice(0, 80)}` : ''}`;
        return { ok: false, status: 400,
          error: 'invalid_rows',
          message: `未识别到有效明细，请确认模板包含【菜品名称、销售数量】以及【餐/时段名称 或 下单时间/结账时间】并有有效数据行；${debugMsg}`,
          hint: {
            slotRule: '10-14午市,14-17下午茶,17-22晚市（可由下单时间/结账时间自动推导）',
            requiredHeaders: ['菜品名称', '销售数量'],
            optionalHeaders: ['销售金额/销售收入/折前营收/折前营业额', '实际收入/实收营业额/菜品收入/折后营收', '优惠金额', '销售类型', '营业日期', '下单时间/订单时间', '结账时间', '天气']
          },
          debug: {
            originalName: String(file.originalname || ''),
            ext,
            mime,
            size: Number(file.size || 0),
            parseMode: parseMode || 'none',
            parseErrors: parseErrors.slice(0, 3),
            matrixSample: __debugMatrixSample.slice(0, 8)
          }
        };
      }

      // Always use user-selected bizType — user controls store & bizType, system only validates field structure
      log.info({
        msg: 'inventory_upload_apply_biz_type',
        biz_type: selectedBizType,
        rows: parsedRows.length,
      });
      parsedRows.forEach((row) => { row.bizType = selectedBizType; });

      // Store validation: also trust user selection, just log if file has different store info
      const fileStores = Array.from(new Set(parsedRows
        .map((row) => ctx.normalizeForecastStoreName(row?.store))
        .filter(Boolean)));
      if (fileStores.length) {
        const selectedStoreKey = ctx.normalizeForecastStoreKey(store);
        const fileStoreKeys = Array.from(new Set(fileStores.map((x) => ctx.normalizeForecastStoreKey(x)).filter(Boolean)));
        if (fileStoreKeys.length && fileStoreKeys[0] !== selectedStoreKey) {
          log.info({
            msg: 'inventory_upload_store_override',
            file_stores: fileStores.slice(0, 5),
            selected_store: store,
          });
        }
        // No longer reject — trust user selection for store too
      }

      const existingDateSet = new Set(
        (Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [])
          .filter((x) => String(x?.store || '').trim() === store)
          .filter((x) => String(x?.bizType || '').trim() === selectedBizType)
          .map((x) => String(x?.date || '').trim())
          .filter(Boolean)
      );
      const uploadDateSet = new Set(parsedRows.map((x) => String(x?.date || '').trim()).filter(Boolean));
      const duplicatedDates = Array.from(uploadDateSet).filter((d) => existingDateSet.has(d)).sort();
      if (duplicatedDates.length) {
        const label = selectedBizType === 'takeaway' ? '外卖' : '堂食';
        return { ok: false, status: 409,
          error: 'date_already_exists',
          message: `${label}历史中已存在以下营业日期，已阻止重复上传：${duplicatedDates.slice(0, 8).join('、')}${duplicatedDates.length > 8 ? ' 等' : ''}`,
          duplicatedDates
        };
      }

      const byGroup = new Map();
      parsedRows.forEach((row) => {
        const bizType = ctx.normalizeForecastBizType(row?.bizType);
        const slot = ctx.normalizeForecastSlot(row?.slot);
        if (!bizType || !slot) return;
        const key = `${bizType}||${slot}`;
        const list = byGroup.get(key) || [];
        list.push({
          date: row?.date,
          weather: row?.weather,
          isHoliday: row?.isHoliday,
          expectedRevenue: row?.expectedRevenue,
          actualRevenue: row?.actualRevenue || 0,
          totalDiscount: row?.totalDiscount || 0,
          productQuantities: row?.productQuantities
        });
        byGroup.set(key, list);
      });
      if (!byGroup.size) return { ok: false, status: 400, error: 'no_valid_group' };

      const groupedBreakdown = Array.from(byGroup.entries()).map(([key, list]) => {
        const [bizType, slot] = String(key || '').split('||');
        return { bizType: bizType || '', slot: slot || '', rows: Array.isArray(list) ? list.length : 0 };
      });

      let nextState = state0;
      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let accepted = 0;
      let evaluated = 0;
      for (const [key, list] of byGroup.entries()) {
        const [bizType, slot] = String(key || '').split('||');
        const ret = ctx.upsertInventoryForecastHistoryInState(nextState, { store, bizType, slot, rowsRaw: list, username });
        nextState = ret.state;
        inserted += Number(ret.inserted || 0);
        updated += Number(ret.updated || 0);
        skipped += Number(ret.skipped || 0);
        accepted += Number(ret.accepted || 0);
        evaluated += Number(ret.evaluated || 0);
      }
      await ctx.saveSharedState(nextState);
      return {
        ok: true,
        store,
        parsedRows: parsedRows.length,
        grouped: byGroup.size,
        groupedBreakdown,
        inserted,
        updated,
        skipped,
        accepted,
        evaluated
      };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function uploadHistoryImage(_ctx, _input) {

    return { ok: false, status: 410,
      error: 'image_upload_disabled',
      message: '图片上传功能已下线，请使用 Excel 或 PDF 上传历史数据。'
    };
  
}

export async function uploadSalesRaw(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };
    // sales_raw表已于2026-07-03下线，手工上传销售明细的流程被pos_order_items自动同步取代，
    // 不再需要人工上传。（文件清理由 routes finally 负责）
    return { ok: false, status: 410,
      error: 'sales_raw_retired',
      message: '销售明细已改为自动同步（pos_order_items/pos_sales_detail），不再需要手工上传销售明细文件。'
    };
}

export async function listDishAliases(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可查看菜名别名规则' };
    try {
      const store = String(input.query?.store || '*').trim() || '*';
      const bizType = ctx.normalizeDishAliasBizType(input.query?.bizType || '*');
      const where = ['enabled = TRUE'];
      const params = [];
      if (store !== '*') {
        params.push(store);
        where.push(`(store = $${params.length} OR store = '*')`);
      }
      if (bizType !== '*') {
        params.push(bizType);
        where.push(`(biz_type = $${params.length} OR biz_type = '*')`);
      }
      const r = await ctx.pool.query(
        `SELECT id, store, biz_type, alias_name, canonical_name, enabled, updated_at
         FROM dish_name_aliases
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY updated_at DESC, id DESC
         LIMIT 2000`,
        params
      );
      return { ok: true, items: r.rows || [] };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function createDishAlias(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可配置菜名别名规则' };
    try {
      const store = String(input.body?.store || '*').trim() || '*';
      const bizType = ctx.normalizeDishAliasBizType(input.body?.bizType || '*');
      const aliasName = String(input.body?.aliasName || '').trim();
      const canonicalName = String(input.body?.canonicalName || '').trim();
      if (!aliasName || !canonicalName) return { ok: false, status: 400, error: 'missing_params', message: 'aliasName/canonicalName 必填' };
      const r = await ctx.pool.query(
        `INSERT INTO dish_name_aliases (store, biz_type, alias_name, canonical_name, enabled, created_by, updated_by, updated_at, tenant_id)
         VALUES ($1,$2,$3,$4,TRUE,$5,$5,NOW(),$6)
         ON CONFLICT (store, biz_type, alias_name, tenant_id)
         DO UPDATE SET canonical_name = EXCLUDED.canonical_name, enabled = TRUE, updated_by = EXCLUDED.updated_by, updated_at = NOW()
         RETURNING id, store, biz_type, alias_name, canonical_name, enabled, updated_at`,
        [store, bizType, aliasName, canonicalName, username, ctx.resolveTenantIdDefault()]
      );
      return { ok: true, item: r.rows?.[0] || null };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function updateDishAlias(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可修改菜名别名规则' };
    try {
      const id = Number(input.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return { ok: false, status: 400, error: 'invalid_id' };

      const aliasName = String(input.body?.aliasName || '').trim();
      const canonicalName = String(input.body?.canonicalName || '').trim();
      const enabled = input.body?.enabled === undefined ? null : !!input.body.enabled;
      const sets = [];
      const vals = [];

      if (aliasName) {
        vals.push(aliasName);
        sets.push(`alias_name = $${vals.length}`);
      }
      if (canonicalName) {
        vals.push(canonicalName);
        sets.push(`canonical_name = $${vals.length}`);
      }
      if (enabled !== null) {
        vals.push(enabled);
        sets.push(`enabled = $${vals.length}`);
      }
      vals.push(username);
      sets.push(`updated_by = $${vals.length}`);
      sets.push(`updated_at = NOW()`);
      vals.push(id);

      if (!sets.length) return { ok: false, status: 400, error: 'nothing_to_update' };
      const r = await ctx.pool.query(
        `UPDATE dish_name_aliases
         SET ${sets.join(', ')}
         WHERE id = $${vals.length}
         RETURNING id, store, biz_type, alias_name, canonical_name, enabled, updated_at`,
        vals
      );
      if (!r.rows?.length) return { ok: false, status: 404, error: 'not_found' };
      return { ok: true, item: r.rows[0] };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function deleteDishAlias(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可删除菜名别名规则' };
    try {
      const id = Number(input.params?.id || 0);
      if (!Number.isFinite(id) || id <= 0) return { ok: false, status: 400, error: 'invalid_id' };
      const r = await ctx.pool.query(
        `UPDATE dish_name_aliases
         SET enabled = FALSE, updated_by = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id`,
        [username, id]
      );
      if (!r.rows?.length) return { ok: false, status: 404, error: 'not_found' };
      return { ok: true};
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function listCoreProducts(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const qStore = String(input.query?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      const all = Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts : [];
      const items = all.filter(x => String(x?.store || '').trim() === store);
      return { ok: true, store, items };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function createCoreProduct(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const product = String(input.body?.product || '').trim();
    const targetQty = Number(input.body?.targetQty || 0);
    if (!product) return { ok: false, status: 400, error: 'missing_product' };
    if (!Number.isFinite(targetQty) || targetQty <= 0) return { ok: false, status: 400, error: 'invalid_target_qty' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const qStore = String(input.body?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      const all = Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts.slice() : [];
      const key = `${store}||${product}`;
      const keyOf = (x) => `${String(x?.store || '').trim()}||${String(x?.product || '').trim()}`;
      const idx = all.findIndex(x => keyOf(x) === key);
      const now = ctx.hrmsNowISO();
      const item = {
        id: idx >= 0 ? (all[idx]?.id || randomUUID()) : randomUUID(),
        store,
        product,
        targetQty: Number(targetQty.toFixed(1)),
        createdAt: idx >= 0 ? (all[idx]?.createdAt || now) : now,
        createdBy: idx >= 0 ? (all[idx]?.createdBy || username) : username,
        updatedAt: now,
        updatedBy: username
      };
      if (idx >= 0) all.splice(idx, 1, item);
      else all.unshift(item);

      await ctx.saveSharedState({ ...state0, forecastCoreProducts: all.slice(0, 2000) });
      return { ok: true, item };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function deleteCoreProduct(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const id = String(input.params?.id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const all = Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts.slice() : [];
      const idx = all.findIndex(x => String(x?.id || '').trim() === id);
      if (idx < 0) return { ok: false, status: 404, error: 'not_found' };
      all.splice(idx, 1);
      await ctx.saveSharedState({ ...state0, forecastCoreProducts: all });
      return { ok: true};
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function listProductAliases(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可查看别名规则' };
    try {
      const state0 = (await ctx.getSharedState()) || {};
      const scope = ctx.resolveForecastScope(state0, username, role, input.query?.store, input.query?.brandId);
      if (!scope.brandId) return { ok: false, status: 400, error: 'missing_brand' };
      let items = Array.isArray(state0.forecastProductAliasRules) ? state0.forecastProductAliasRules.slice() : [];
      items = items.filter((x) => {
        const rid = ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
        return rid === scope.brandId;
      });
      items.sort((a, b) => String(a?.canonical || '').localeCompare(String(b?.canonical || ''), 'zh-Hans-CN'));
      return { ok: true, brandId: scope.brandId, brandName: scope.brandName, items };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function createProductAlias(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可配置别名规则' };
    const canonical = String(input.body?.canonical || '').trim();
    const aliases = Array.isArray(input.body?.aliases) ? input.body.aliases : [];
    if (!canonical) return { ok: false, status: 400, error: 'missing_canonical' };
    try {
      const state0 = (await ctx.getSharedState()) || {};
      const scope = ctx.resolveForecastScope(state0, username, role, input.body?.store, input.body?.brandId);
      if (!scope.brandId) return { ok: false, status: 400, error: 'missing_brand' };

      const now = ctx.hrmsNowISO();
      const all = Array.isArray(state0.forecastProductAliasRules) ? state0.forecastProductAliasRules.slice() : [];
      const normalizedTokens = [canonical, ...aliases]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .map((x) => ({ raw: x, norm: ctx.normalizeProductName(x) }))
        .filter((x) => x.norm);
      if (!normalizedTokens.length) return { ok: false, status: 400, error: 'invalid_aliases' };

      const storeItems = all.filter((x) => {
        const rid = ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
        return rid === scope.brandId;
      });
      const used = new Map();
      storeItems.forEach((it) => {
        const names = [String(it?.canonical || '').trim(), ...(Array.isArray(it?.aliases) ? it.aliases : [])];
        names.forEach((name) => {
          const norm = ctx.normalizeProductName(name);
          if (!norm) return;
          used.set(norm, String(it?.id || ''));
        });
      });
      const conflict = normalizedTokens.find((x) => used.has(x.norm));
      if (conflict) return { ok: false, status: 400, error: 'duplicate_alias', message: `名称「${conflict.raw}」已被其他规则使用` };

      const item = {
        id: randomUUID(),
        brandId: scope.brandId,
        brandName: scope.brandName,
        store: scope.storeScope[0] || scope.store || '',
        canonical,
        aliases: Array.from(new Set(aliases.map((x) => String(x || '').trim()).filter(Boolean))),
        createdAt: now,
        createdBy: username,
        updatedAt: now,
        updatedBy: username
      };
      all.unshift(item);
      await ctx.saveSharedState({ ...state0, forecastProductAliasRules: all.slice(0, 4000) });
      return { ok: true, item };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function updateProductAlias(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可修改别名规则' };
    const id = String(input.params?.id || '').trim();
    const canonical = String(input.body?.canonical || '').trim();
    const aliases = Array.isArray(input.body?.aliases) ? input.body.aliases : [];
    if (!id) return { ok: false, status: 400, error: 'missing_id' };
    if (!canonical) return { ok: false, status: 400, error: 'missing_canonical' };
    try {
      const state0 = (await ctx.getSharedState()) || {};
      const all = Array.isArray(state0.forecastProductAliasRules) ? state0.forecastProductAliasRules.slice() : [];
      const idx = all.findIndex((x) => String(x?.id || '').trim() === id);
      if (idx < 0) return { ok: false, status: 404, error: 'not_found' };

      const existing = all[idx];
      const store = String(existing?.store || '').trim();
      const brandId = ctx.normalizeBrandId(existing?.brandId || ctx.resolveStoreBrandContext(state0, store).brandId);
      const brandName = String(existing?.brandName || ctx.resolveStoreBrandContext(state0, store).brandName || '').trim();
      const now = ctx.hrmsNowISO();
      const normalizedTokens = [canonical, ...aliases]
        .map((x) => String(x || '').trim())
        .filter(Boolean)
        .map((x) => ({ raw: x, norm: ctx.normalizeProductName(x) }))
        .filter((x) => x.norm);
      if (!normalizedTokens.length) return { ok: false, status: 400, error: 'invalid_aliases' };

      const used = new Map();
      all
        .filter((x) => String(x?.id || '').trim() !== id)
        .filter((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === brandId)
        .forEach((it) => {
          const names = [String(it?.canonical || '').trim(), ...(Array.isArray(it?.aliases) ? it.aliases : [])];
          names.forEach((name) => {
            const norm = ctx.normalizeProductName(name);
            if (!norm) return;
            used.set(norm, String(it?.id || ''));
          });
        });
      const conflict = normalizedTokens.find((x) => used.has(x.norm));
      if (conflict) return { ok: false, status: 400, error: 'duplicate_alias', message: `名称「${conflict.raw}」已被其他规则使用` };

      all[idx] = {
        ...existing,
        brandId,
        brandName,
        canonical,
        aliases: Array.from(new Set(aliases.map((x) => String(x || '').trim()).filter(Boolean))),
        updatedAt: now,
        updatedBy: username
      };
      await ctx.saveSharedState({ ...state0, forecastProductAliasRules: all });
      return { ok: true, item: all[idx] };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function deleteProductAlias(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可删除别名规则' };
    const id = String(input.params?.id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };
    try {
      const state0 = (await ctx.getSharedState()) || {};
      const all = Array.isArray(state0.forecastProductAliasRules) ? state0.forecastProductAliasRules.slice() : [];
      const idx = all.findIndex((x) => String(x?.id || '').trim() === id);
      if (idx < 0) return { ok: false, status: 404, error: 'not_found' };
      all.splice(idx, 1);
      await ctx.saveSharedState({ ...state0, forecastProductAliasRules: all });
      return { ok: true};
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function getCoreProductSales(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const startDate = ctx.safeDateOnly(input.query?.startDate || input.query?.start);
    const endDate = ctx.safeDateOnly(input.query?.endDate || input.query?.end);
    if (!startDate || !endDate) return { ok: false, status: 400, error: 'missing_date_range' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const qStore = String(input.query?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      // Get core products for this store
      const coreProducts = (Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts : [])
        .filter(x => String(x?.store || '').trim() === store);
      if (!coreProducts.length) return { ok: true, store, startDate, endDate, items: [], message: '暂无核心产品配置' };

      const aliasLookup = ctx.buildForecastProductAliasLookup(state0, store);

      // Build normalized name → core product mapping
      const coreMap = new Map();
      coreProducts.forEach(cp => {
        const resolved = ctx.resolveForecastProductName(cp.product, aliasLookup);
        if (resolved.key) coreMap.set(resolved.key, cp);
      });

      // Aggregate actual sales from history within date range
      const historyRows = (Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [])
        .filter(x => String(x?.store || '').trim() === store)
        .filter(x => ctx.inDateRange(String(x?.date || '').trim(), startDate, endDate));

      // Count unique dates in range for daily target calculation
      const uniqueDates = new Set();
      historyRows.forEach(x => { const d = ctx.safeDateOnly(x?.date); if (d) uniqueDates.add(d); });
      const dayCount = uniqueDates.size || 1;

      // Aggregate quantities by normalized product name
      const salesAgg = new Map();
      historyRows.forEach(row => {
        const products = row?.productQuantities && typeof row.productQuantities === 'object' ? row.productQuantities : {};
        Object.entries(products).forEach(([product, qtyRaw]) => {
          const qty = Number(qtyRaw || 0);
          if (qty <= 0) return;
          const resolved = ctx.resolveForecastProductName(product, aliasLookup);
          if (!resolved.key) return;
          // Only count if it matches a core product
          if (!coreMap.has(resolved.key)) return;
          salesAgg.set(resolved.key, (salesAgg.get(resolved.key) || 0) + qty);
        });
      });

      // Build result items
      const items = coreProducts.map(cp => {
        const resolved = ctx.resolveForecastProductName(cp.product, aliasLookup);
        const actualQty = salesAgg.get(resolved.key) || 0;
        const dailyTarget = Number(cp.targetQty || 0);
        const totalTarget = dailyTarget * dayCount;
        const achievementRate = totalTarget > 0 ? Number((actualQty / totalTarget).toFixed(4)) : 0;
        return {
          id: cp.id,
          product: cp.product,
          normalizedName: resolved.key,
          dailyTarget,
          totalTarget: Number(totalTarget.toFixed(1)),
          actualQty: Number(actualQty.toFixed(1)),
          achievementRate,
          achievementPct: Number((achievementRate * 100).toFixed(1)),
          dayCount
        };
      });

      items.sort((a, b) => b.achievementRate - a.achievementRate);
      return { ok: true, store, startDate, endDate, dayCount, items };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function getAnalytics(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const qStore = String(input.query?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      const bizType = ctx.normalizeForecastBizType(input.query?.bizType);
      const startDate = ctx.safeDateOnly(input.query?.startDate);
      const endDate = ctx.safeDateOnly(input.query?.endDate);

      let filtered = [];
      if (startDate && endDate) {
        const salesRawRows = await ctx.loadInventoryForecastHistoryFromSalesRaw({
          storeScope: [store],
          bizType,
          startDate,
          endDate
        });
        filtered = salesRawRows.filter(x => String(x?.store || '').trim() === store);
      }
      if (bizType) filtered = filtered.filter(x => String(x?.bizType || '').trim() === bizType);
      if (startDate) filtered = filtered.filter(x => String(x?.date || '').trim() >= startDate);
      if (endDate) filtered = filtered.filter(x => String(x?.date || '').trim() <= endDate);

      const aliasLookup = ctx.buildForecastProductAliasLookup(state0, store);
      const productStats = new Map();
      filtered.forEach(row => {
        const pqs = row?.productQuantities || {};
        const rev = Number(row?.expectedRevenue || 0);
        const totalQtyOfRow = Object.entries(pqs)
          .filter(([name]) => !ctx.isExcludedForecastProduct(name))
          .reduce((a, [, q]) => a + Number(q || 0), 0);
        Object.entries(pqs).forEach(([product, qty]) => {
          if (ctx.isExcludedForecastProduct(product)) return;
          const resolved = ctx.resolveForecastProductName(product, aliasLookup);
          if (!resolved.key) return;
          if (!productStats.has(resolved.key)) {
            productStats.set(resolved.key, { product: resolved.display, totalQty: 0, totalRevenue: 0, occurrences: 0 });
          }
          const st = productStats.get(resolved.key);
          st.totalQty += Number(qty || 0);
          st.totalRevenue += rev > 0 && totalQtyOfRow > 0 ? (Number(qty || 0) / totalQtyOfRow) * rev : 0;
          st.occurrences += 1;
        });
      });

      const stats = Array.from(productStats.values()).map(s => ({
        product: s.product,
        totalQty: Number(s.totalQty.toFixed(1)),
        totalRevenue: Number(s.totalRevenue.toFixed(2)),
        avgQty: Number((s.totalQty / s.occurrences).toFixed(1)),
        occurrences: s.occurrences
      }));

      const top20ByQty = stats.slice().sort((a, b) => b.totalQty - a.totalQty).slice(0, 20);
      const top20ByRevenue = stats.slice().sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 20);
      const bottom10ByRevenue = stats.filter(s => s.totalRevenue > 0).sort((a, b) => a.totalRevenue - b.totalRevenue).slice(0, 10);
      const coreTargets = (Array.isArray(state0.forecastCoreProducts) ? state0.forecastCoreProducts : [])
        .filter((x) => String(x?.store || '').trim() === store)
        .filter((x) => !ctx.isExcludedForecastProduct(x?.product));
      const statByProduct = new Map(stats.map((x) => [ctx.normalizeProductName(x.product), x]));
      const coreTargetStats = coreTargets.map((t) => {
        const product = String(t?.product || '').trim();
        const targetQty = Number(t?.targetQty || 0);
        const actualQty = Number(statByProduct.get(ctx.normalizeProductName(product))?.totalQty || 0);
        const completionRate = targetQty > 0 ? Math.max(0, Number((actualQty / targetQty).toFixed(4))) : 0;
        return {
          product,
          targetQty: Number(targetQty.toFixed(1)),
          actualQty: Number(actualQty.toFixed(1)),
          gapQty: Number((targetQty - actualQty).toFixed(1)),
          completionRate: Number((completionRate * 100).toFixed(1))
        };
      }).sort((a, b) => b.completionRate - a.completionRate);

      return { ok: true,
        store,
        bizType: bizType || 'all',
        startDate: startDate || '',
        endDate: endDate || '',
        sampleCount: filtered.length,
        top20ByQty,
        top20ByRevenue,
        bottom10ByRevenue,
        coreTargetStats
      };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function estimateRevenue(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const date = ctx.safeDateOnly(input.body?.date);
    const weather = ctx.normalizeForecastWeather(input.body?.weather);
    const isHoliday = !!(input.body?.isHoliday === true || input.body?.isHoliday === 1 || input.body?.isHoliday === '1' || String(input.body?.isHoliday || '').trim().toLowerCase() === 'true' || String(input.body?.isHoliday || '').trim() === '是');
    if (!date) return { ok: false, status: 400, error: 'missing_date' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const qStore = String(input.body?.store || '').trim();
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      const all = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [];
      const historyRows = all
        .filter((x) => String(x?.store || '').trim() === store)
        .filter((x) => {
          const d = String(x?.date || '').trim();
          return !d || d <= date;
        })
        .slice(0, 1200);

      // 补充 POS订单明细 数据提高预测准确度（扩至90天以覆盖1月正常数据）
      // 配置门店名→真实 POS 门店名解析，避免命名体系不一致导致补充数据为空。
      const nsk = (await ctx.resolvePosStoreKeys([store]))[0] || String(store||'').trim().toLowerCase().replace(/\s+/g,'');
      const targetDow0 = (() => { try { const td=new Date(date+'T00:00:00'); return Number.isFinite(td.getTime())?td.getDay():-1; } catch(e){return -1;} })();
      const targetIsNormalWd0 = targetDow0>=1 && targetDow0<=5 && !isHoliday && !ctx.isCNYPeriod(date) && !ctx.isKnownPublicHoliday(date);
      // For normal-weekday targets: strip CNY/holiday records from stored history
      // so sales_raw normal-January data can fill in those dates instead.
      if (targetIsNormalWd0) {
        for (let i = historyRows.length - 1; i >= 0; i--) {
          const d = ctx.safeDateOnly(historyRows[i]?.date);
          if (d && (ctx.isCNYPeriod(d) || ctx.isKnownPublicHoliday(d))) { historyRows.splice(i, 1); }
        }
      }
      try {
        // 按堂食/外卖分别补充近90天日营收，口径与上方一致用折前(sales_amount)，避免把外卖营收误记到堂食、或混用折后口径。
        const srR = await ctx.pool.query(`SELECT s.date::text AS date, s.biz_type, ROUND(SUM(COALESCE(s.sales_amount,0))::numeric,2) AS day_revenue FROM pos_sales_detail s WHERE lower(regexp_replace(coalesce(s.store,''),'\\s+','','g'))=$1 AND s.date<=$2::date AND s.date>=($2::date-INTERVAL '90 days') GROUP BY s.date, s.biz_type ORDER BY s.date DESC`,[nsk,date]);
        const exD=new Set(historyRows.map(r=>`${safeDateOnly(r?.date)}||${normalizeForecastBizType(r?.bizType)}`));
        for(const sr of(srR.rows||[])){
          const d=ctx.safeDateOnly(sr.date),biz=ctx.normalizeForecastBizType(sr.biz_type),rev=Number(sr.day_revenue)||0;
          if(!d||!biz||rev<=0||exD.has(`${d}||${biz}`))continue;
          const srIsCNY=ctx.isCNYPeriod(d),srIsHol=ctx.isKnownPublicHoliday(d);
          // For normal-weekday targets: skip CNY and public-holiday source days entirely
          if(targetIsNormalWd0 && (srIsCNY||srIsHol)) continue;
          historyRows.push({date:d,bizType:biz,slot:'',expectedRevenue:rev,isHoliday:srIsCNY||srIsHol});
        }
      } catch(e){ /* ignore */ }

      const target = { date, weather, isHoliday };
      const estimate = ctx.estimateRevenueByHistory(historyRows, target, store);
      return { ok: true, store, target, estimate };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function listGrossProfitProfiles(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const qBizType = ctx.normalizeForecastBizType(input.query?.bizType);
    try {
      const state0 = (await ctx.getSharedState()) || {};
      const scope = ctx.resolveForecastScope(state0, username, role, input.query?.store, input.query?.brandId);
      if (!scope.brandId || !scope.storeScope.length) return { ok: false, status: 400, error: 'missing_brand_or_store_scope' };

      let items = Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles.slice() : [];
      items = items.filter((x) => {
        const rid = ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
        return rid === scope.brandId;
      });
      if (qBizType) items = items.filter((x) => String(x?.bizType || '').trim() === qBizType || !String(x?.bizType || '').trim());

      // 合并飞书菜品库成本数据（dish_library_costs）
      try {
        const storeKeys = scope.storeScope.map(s => ctx.normalizeStoreKey(s));
        // 按品牌过滤成本，避免两品牌同名菜成本互相污染（品牌从 scope/门店名前缀可靠推断；'*' 为通用兜底）。
        const dlBrand = ctx.forecastBrandToken(`${scope.brandName||''}${(scope.storeScope||[]).join('')}`);
        const dlParams = [storeKeys];
        let dlBrandClause = '';
        if (dlBrand) { dlParams.push(dlBrand); dlBrandClause = ` AND (brand=$${dlParams.length} OR brand='*')`; }
        const dlR = await ctx.pool.query(`SELECT biz_type,dish_name,dish_price,unit_cost FROM dish_library_costs WHERE enabled=TRUE AND (lower(regexp_replace(coalesce(store,''),'\\s+','','g'))=ANY($1) OR store='*')${dlBrandClause}`, dlParams);
        const existingKeys = new Set(items.map(x => `${normalizeForecastBizType(x?.bizType)||''}||${normalizeProductName(String(x?.product||'').trim())}`));
        for (const r of (dlR.rows||[])) {
          const biz = ctx.normalizeForecastBizType(r.biz_type) || '';
          const name = String(r.dish_name||'').trim();
          const nameNorm = ctx.normalizeProductName(name);
          const cost = ctx.safeNumber(r.unit_cost);
          if (!nameNorm || !Number.isFinite(cost) || cost < 0) continue;
          const ek = `${biz}||${nameNorm}`;
          if (!existingKeys.has(ek)) {
            items.push({ product: name, bizType: biz, costPerUnit: Number(cost.toFixed(4)), source: 'feishu_bitable' });
            existingKeys.add(ek);
          }
        }
      } catch (e) { log.error({ msg: 'inventory_profiles_dish_costs_merge_failed', err: e?.message || String(e) }); }

      items.sort((a, b) => String(a?.product || '').localeCompare(String(b?.product || ''), 'zh-Hans-CN'));

      // Enrich with avg price from history for margin rate computation
      const today = new Date().toISOString().slice(0, 10);
      const salesRawHistoryRows = await ctx.loadInventoryForecastHistoryFromSalesRaw({
        storeScope: scope.storeScope,
        bizType: qBizType || '',
        startDate: ctx.shiftForecastDate(today, -180),
        endDate: today
      });
      const stateHistoryRows = (Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [])
        .filter((x) => scope.storeScope.includes(String(x?.store || '').trim()))
        .filter((x) => !qBizType || String(x?.bizType || '').trim() === qBizType)
        .slice(0, 5000);
      const historyRows = ctx.mergePreferredForecastHistoryRows(salesRawHistoryRows, stateHistoryRows, 5000);
      const aliasLookup = ctx.buildForecastProductAliasLookup(state0, { store: scope.store, brandId: scope.brandId });
      const priceMap = ctx.computeAvgPricePerProduct(historyRows, scope.storeScope, aliasLookup);
      const enriched = items.map((x) => {
        const avgPrice = priceMap.get(ctx.resolveForecastProductName(String(x?.product || '').trim(), aliasLookup).key) || 0;
        const cost = Number(x?.costPerUnit || 0);
        const gpu = Number.isFinite(x?.grossPerUnit) ? x.grossPerUnit : (avgPrice > cost && cost > 0 ? avgPrice - cost : 0);
        const marginRate = avgPrice > 0 && cost > 0 ? Number((1 - cost / avgPrice).toFixed(4)) : (gpu > 0 && avgPrice > 0 ? Number((gpu / avgPrice).toFixed(4)) : 0);
        return { ...x, avgPrice: Number(avgPrice.toFixed(2)), marginRate };
      });
      return { ok: true, store: scope.store || '', brandId: scope.brandId, brandName: scope.brandName, bizType: qBizType || '', items: enriched };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function upsertGrossProfitProfiles(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可配置产品毛利' };

    // Support single item add: {store, product, costPerUnit} or batch: {store, items:[...]}
    const singleProduct = String(input.body?.product || '').trim();
    const itemsRaw = singleProduct
      ? [{ product: singleProduct, costPerUnit: input.body?.costPerUnit, grossPerUnit: input.body?.grossPerUnit, bizType: input.body?.bizType }]
      : (Array.isArray(input.body?.items) ? input.body.items : []);
    const replace = !!input.body?.replace;
    if (!itemsRaw.length) return { ok: false, status: 400, error: 'missing_items' };
    try {
      const state0 = (await ctx.getSharedState()) || {};
      const scope = ctx.resolveForecastScope(state0, username, role, input.body?.store, input.body?.brandId);
      if (!scope.brandId || !scope.storeScope.length) return { ok: false, status: 400, error: 'missing_brand_or_store_scope' };

      const now = ctx.hrmsNowISO();
      const normalizedItems = itemsRaw.map(ctx.normalizeGrossProfitProfileItem).filter(Boolean);
      if (!normalizedItems.length) return { ok: false, status: 400, error: 'invalid_items' };

      // Compute avg prices for cost→gross conversion
      const today = new Date().toISOString().slice(0, 10);
      const salesRawHistoryRows = await ctx.loadInventoryForecastHistoryFromSalesRaw({
        storeScope: scope.storeScope,
        startDate: ctx.shiftForecastDate(today, -180),
        endDate: today
      });
      const stateHistoryRows = (Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [])
        .filter((x) => scope.storeScope.includes(String(x?.store || '').trim()))
        .slice(0, 5000);
      const historyRows = ctx.mergePreferredForecastHistoryRows(salesRawHistoryRows, stateHistoryRows, 5000);
      const aliasLookup = ctx.buildForecastProductAliasLookup(state0, { store: scope.store, brandId: scope.brandId });
      const priceMap = ctx.computeAvgPricePerProduct(historyRows, scope.storeScope, aliasLookup);

      let all = Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles.slice() : [];
      if (replace) {
        all = all.filter((x) => {
          const rid = ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId);
          return rid !== scope.brandId;
        });
      }

      // Check product uniqueness within this store (product name must be unique)
      const existingProducts = new Map();
      all
        .filter((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === scope.brandId)
        .forEach((x) => existingProducts.set(String(x?.product || '').trim(), x));

      const keyOf = (x) => `${normalizeBrandId(x?.brandId || resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId)}||${String(x?.product || '').trim()}`;
      const map = new Map(all.map((x) => [keyOf(x), x]));

      normalizedItems.forEach((it) => {
        const canonicalProduct = ctx.resolveForecastProductName(it.product, aliasLookup).display;
        const key = `${scope.brandId}||${canonicalProduct}`;
        const prev = map.get(key);
        const avgPrice = priceMap.get(ctx.resolveForecastProductName(canonicalProduct, aliasLookup).key) || 0;
        let gpu = it.grossPerUnit;
        if ((!Number.isFinite(gpu) || gpu === undefined) && Number.isFinite(it.costPerUnit)) {
          gpu = avgPrice > it.costPerUnit ? Number((avgPrice - it.costPerUnit).toFixed(4)) : 0;
        }
        map.set(key, {
          ...(prev || {}),
          id: prev?.id || randomUUID(),
          store: prev?.store || scope.storeScope[0] || scope.store || '',
          brandId: scope.brandId,
          brandName: scope.brandName,
          bizType: it.bizType || '',
          product: canonicalProduct,
          costPerUnit: Number.isFinite(it.costPerUnit) ? it.costPerUnit : (prev?.costPerUnit || undefined),
          grossPerUnit: Number.isFinite(gpu) ? Number(gpu.toFixed(4)) : (prev?.grossPerUnit || 0),
          createdAt: prev?.createdAt || now,
          createdBy: prev?.createdBy || username,
          updatedAt: now,
          updatedBy: username
        });
      });

      const nextItems = Array.from(map.values()).slice(0, 8000);
      await ctx.saveSharedState({ ...state0, forecastGrossProfitProfiles: nextItems });
      return { ok: true, brandId: scope.brandId, brandName: scope.brandName, count: normalizedItems.length, total: nextItems.filter((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === scope.brandId).length };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function updateGrossProfitProfile(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可修改产品毛利' };

    const id = String(input.params?.id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      let all = Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles.slice() : [];
      const idx = all.findIndex((x) => String(x?.id || '').trim() === id);
      if (idx < 0) return { ok: false, status: 404, error: 'not_found' };

      const existing = all[idx];
      const store = String(existing?.store || '').trim();
      const brandId = ctx.normalizeBrandId(existing?.brandId || ctx.resolveStoreBrandContext(state0, store).brandId);
      const brandName = String(existing?.brandName || ctx.resolveStoreBrandContext(state0, store).brandName || '').trim();
      const storeScope = ctx.getStoreNamesByBrand(state0, brandId);
      const now = ctx.hrmsNowISO();

      // Updatable fields
      const aliasLookup = ctx.buildForecastProductAliasLookup(state0, { store, brandId });
      const newProductRaw = String(input.body?.product || '').trim() || existing.product;
      const newProduct = ctx.resolveForecastProductName(newProductRaw, aliasLookup).display;
      const newCost = input.body?.costPerUnit !== undefined ? ctx.safeNumber(input.body.costPerUnit) : existing.costPerUnit;
      const newBizType = input.body?.bizType !== undefined ? (ctx.normalizeForecastBizType(input.body.bizType) || '') : (existing.bizType || '');

      // Check uniqueness if product name changed
      if (newProduct !== existing.product) {
        const dup = all.find((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === brandId && String(x?.product || '').trim() === newProduct && String(x?.id || '') !== id);
        if (dup) return { ok: false, status: 400, error: 'duplicate_product', message: `产品「${newProduct}」已存在` };
      }

      // Compute grossPerUnit from cost + avg price
      const historyRows = Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [];
      const priceMap = ctx.computeAvgPricePerProduct(historyRows, storeScope.length ? storeScope : [store], aliasLookup);
      const avgPrice = priceMap.get(ctx.resolveForecastProductName(newProduct, aliasLookup).key) || 0;
      let gpu = existing.grossPerUnit || 0;
      if (Number.isFinite(newCost) && newCost >= 0) {
        gpu = avgPrice > newCost ? Number((avgPrice - newCost).toFixed(4)) : 0;
      }

      all[idx] = {
        ...existing,
        brandId,
        brandName,
        product: newProduct,
        bizType: newBizType,
        costPerUnit: Number.isFinite(newCost) ? newCost : existing.costPerUnit,
        grossPerUnit: Number.isFinite(gpu) ? Number(gpu.toFixed(4)) : 0,
        updatedAt: now,
        updatedBy: username
      };

      await ctx.saveSharedState({ ...state0, forecastGrossProfitProfiles: all });
      return { ok: true, item: all[idx] };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function deleteGrossProfitProfile(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canManageGrossProfitProfiles(role)) return { ok: false, status: 403, error: 'forbidden', message: '仅管理员可删除产品毛利' };

    const id = String(input.params?.id || '').trim();
    if (!id) return { ok: false, status: 400, error: 'missing_id' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      let all = Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles.slice() : [];
      const before = all.length;
      all = all.filter((x) => String(x?.id || '').trim() !== id);
      if (all.length === before) return { ok: false, status: 404, error: 'not_found' };
      await ctx.saveSharedState({ ...state0, forecastGrossProfitProfiles: all });
      return { ok: true};
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function estimateGrossMargin(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const date = ctx.safeDateOnly(input.body?.date);
    const startDate = ctx.safeDateOnly(input.body?.startDate || date);
    const endDate = ctx.safeDateOnly(input.body?.endDate || date || input.body?.startDate);
    const bizType = ctx.normalizeForecastBizType(input.body?.bizType);
    if (!startDate || !endDate) return { ok: false, status: 400, error: 'missing_date_range' };

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const scope = ctx.resolveForecastScope(state0, username, role, input.body?.store, input.body?.brandId);
      if (!scope.brandId || !scope.storeScope.length) return { ok: false, status: 400, error: 'missing_brand_or_store_scope' };

      const salesRawHistoryRows = await ctx.loadInventoryForecastHistoryFromSalesRaw({
        storeScope: scope.storeScope,
        bizType,
        startDate,
        endDate
      });
      const stateHistoryRows = (Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [])
        .filter((x) => scope.storeScope.includes(String(x?.store || '').trim()))
        .filter((x) => !bizType || String(x?.bizType || '').trim() === bizType)
        .filter((x) => ctx.inDateRange(String(x?.date || '').trim(), startDate, endDate))
        .slice(0, 5000);
      const historyRows = ctx.mergePreferredForecastHistoryRows(salesRawHistoryRows, stateHistoryRows, 5000);
      let profiles = (Array.isArray(state0.forecastGrossProfitProfiles) ? state0.forecastGrossProfitProfiles : [])
        .filter((x) => ctx.normalizeBrandId(x?.brandId || ctx.resolveStoreBrandContext(state0, String(x?.store || '').trim()).brandId) === scope.brandId)
        .slice(0, 5000);
      // 合并飞书菜品库成本
      try {
        const sk = scope.storeScope.map(s => ctx.normalizeStoreKey(s));
        // 按品牌过滤成本，避免两品牌同名菜成本互相污染。
        const dlBrand = ctx.forecastBrandToken(`${scope.brandName||''}${(scope.storeScope||[]).join('')}`);
        const dlParams = [sk];
        let dlBrandClause = '';
        if (dlBrand) { dlParams.push(dlBrand); dlBrandClause = ` AND (brand=$${dlParams.length} OR brand='*')`; }
        const dlR = await ctx.pool.query(`SELECT biz_type,dish_name,unit_cost FROM dish_library_costs WHERE enabled=TRUE AND (lower(regexp_replace(coalesce(store,''),'\\s+','','g'))=ANY($1) OR store='*')${dlBrandClause}`, dlParams);
        const ek = new Set(profiles.map(x => `${normalizeForecastBizType(x?.bizType)||''}||${normalizeProductName(String(x?.product||'').trim())}`));
        for (const r of (dlR.rows||[])) { const b=ctx.normalizeForecastBizType(r.biz_type)||''; const n=String(r.dish_name||'').trim(); const nNorm=ctx.normalizeProductName(n); const c=ctx.safeNumber(r.unit_cost); if(!nNorm||!Number.isFinite(c)||c<0) continue; const k=`${b}||${nNorm}`; if(!ek.has(k)){profiles.push({product:n,bizType:b,costPerUnit:Number(c.toFixed(4))});ek.add(k);} }
      } catch (e) { log.error({ msg: 'inventory_margin_dish_costs_merge_failed', err: e?.message || String(e) }); }
      const aliasLookup = ctx.buildForecastProductAliasLookup(state0, { store: scope.store, brandId: scope.brandId });

      const estimate = ctx.estimateGrossMarginByHistory({
        historyRows,
        profiles,
        startDate,
        endDate,
        bizType,
        storeScope: scope.storeScope,
        aliasLookup
      });
      return { ok: true,
        store: scope.store || '',
        brandId: scope.brandId,
        brandName: scope.brandName,
        bizType: bizType || '',
        startDate,
        endDate,
        estimate
      };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function getAccuracy(ctx, input) {

    const username = String(input.username || '').trim();
    const role = String(input.role || '').trim();
    if (!username) return { ok: false, status: 400, error: 'missing_user' };
    if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };

    const qStore = String(input.query?.store || '').trim();
    const bizType = ctx.normalizeForecastBizType(input.query?.bizType);
    const slot = ctx.normalizeForecastSlot(input.query?.slot);
    const start = ctx.safeDateOnly(input.query?.start);
    const end = ctx.safeDateOnly(input.query?.end);
    const limit = Math.max(1, Math.min(1200, Number(input.query?.limit || 300) || 300));

    try {
      const state0 = (await ctx.getSharedState()) || {};
      const myStore = ctx.pickMyStoreFromState(state0, username);
      const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
      if (!store) return { ok: false, status: 400, error: 'missing_store' };

      let items = Array.isArray(state0.inventoryForecastEvaluations) ? state0.inventoryForecastEvaluations.slice() : [];
      items = items.filter((x) => String(x?.store || '').trim() === store);
      if (bizType) items = items.filter((x) => String(x?.bizType || '').trim() === bizType);
      if (slot) items = items.filter((x) => String(x?.slot || '').trim() === slot);
      if (start || end) {
        items = items.filter((x) => ctx.inDateRange(String(x?.date || '').trim(), start, end));
      }
      items.sort((a, b) => String(b?.date || '').localeCompare(String(a?.date || '')) || String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
      items = items.slice(0, limit);
      const summary = ctx.summarizeForecastAccuracyRows(items);
      return { ok: true, store, bizType: bizType || '', slot: slot || '', summary, items };
    } catch (e) {
      return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
    }
  
}

export async function predictForecast(ctx, input) {
  const parsed = parsePredictForecastInput(input, ctx);
  if (!parsed.ok) return parsed;

  const {
    username,
    role,
    bizType,
    slot,
    date,
    weather,
    isHoliday,
    expectedRevenue,
    topN,
    qStore,
  } = parsed;

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const myStore = ctx.pickMyStoreFromState(state0, username);
    const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
    if (!store) return { ok: false, status: 400, error: 'missing_store' };

    const aliasLookup = ctx.buildForecastProductAliasLookup(state0, store);
    const { historyRows, slotSplit, slotExpectedRevenue } = await loadPredictForecastHistory(ctx, {
      store,
      bizType,
      slot,
      date,
      aliasLookup,
      expectedRevenue,
    });

    const target = {
      store,
      bizType,
      slot,
      date,
      weather,
      isHoliday,
      expectedRevenue: slotExpectedRevenue,
    };

    const built = await buildPredictForecastOutput(ctx, {
      state0,
      historyRows,
      target,
      topN,
      date,
      store,
      bizType,
      slot,
      expectedRevenue,
      username,
    });

    await persistPredictForecastState(ctx, state0, built.predictionBundle);

    return {
      ok: true,
      store,
      bizType,
      slot,
      target,
      slotSplit: {
        inputRevenue: Number(expectedRevenue.toFixed(2)),
        slotShare: slotSplit.slotShare,
        slotRevenue: slotExpectedRevenue,
        splitMode: slotSplit.splitMode,
      },
      historyCount: historyRows.length,
      source: built.source,
      confidence: Number(built.out?.confidence || 0),
      summary: built.summary,
      predictions: built.calibratedPredictions,
      calibration: built.calibration,
      immediateAccuracy: built.predictionBundle.immediateEval ? {
        totalAccuracy: built.predictionBundle.immediateEval.totalAccuracy,
        mape: built.predictionBundle.immediateEval.mape,
        hitRate20: built.predictionBundle.immediateEval.hitRate20,
      } : null,
      coreTargetUsage: built.coreTargetUsage,
      generatedAt: built.predictionBundle.now,
    };
  } catch (e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
