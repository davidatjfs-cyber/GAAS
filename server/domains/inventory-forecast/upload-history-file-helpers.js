/**
 * P4 peel: uploadHistoryFile orchestration helpers.
 */
import fs from 'fs';
import path from 'path';
import { parseXlsxSafely } from '../uploads/xlsx-safe-parse.js';

export function validateUploadHistoryAuth(input, ctx) {
  const username = String(input.username || '').trim();
  const role = String(input.role || '').trim();
  if (!username) return { ok: false, status: 400, error: 'missing_user' };
  if (!ctx.canAccessAnalyticsReports(role)) return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true, username, role };
}

export function resolveUploadHistoryStore(ctx, input, state0, username, role) {
  const myStore = ctx.pickMyStoreFromState(state0, username);
  const qStore = String(input.body?.store || '').trim();
  const store = ctx.isForecastStoreScopedRole(role) ? myStore : qStore;
  if (!store) return { ok: false, status: 400, error: 'missing_store' };
  return { ok: true, store };
}

export function validateUploadHistoryFileInput(input) {
  const file = input.file || null;
  if (!file?.path) return { ok: false, status: 400, error: 'missing_file' };
  const selectedBizType = String(input.body?.bizType || '').trim();
  return { ok: true, file, selectedBizType };
}

export function createUploadHistoryParsers(file, ctx, log, uploadsDir) {
  const ext = String(path.extname(String(file.originalname || file.path || '')).toLowerCase()).trim();
  const mime = String(file.mimetype || '').toLowerCase();
  const fallbackBizType = '';
  const fallbackDateFromName = ctx.inferForecastUploadDateFromFilename(String(file.originalname || file.path || ''));
  let __debugMatrixSample = [];

  try {
    fs.copyFileSync(file.path, path.join(uploadsDir, '__last_inventory_upload' + ext));
  } catch (_e) { /* ignore */ }

  const tryParseExcel = async () => {
    const parsedWorkbook = await parseXlsxSafely(file.path, {
      readOpts: { raw: false },
      sheetToJsonOpts: { header: 1, raw: false, defval: '' },
    });
    const sheetNames = Array.isArray(parsedWorkbook.sheetNames) ? parsedWorkbook.sheetNames : [];
    if (!sheetNames.length) throw new Error('empty_sheets');
    for (let si = 0; si < sheetNames.length; si += 1) {
      const sn = String(sheetNames[si] || '').trim();
      if (!sn) continue;
      const matrix = parsedWorkbook.sheets[sn];
      if (!matrix) continue;
      if (!__debugMatrixSample.length && matrix.length) {
        __debugMatrixSample = matrix.slice(0, 12).map((r) => Array.isArray(r) ? r.map((c) => String(c ?? '').slice(0, 40)) : []);
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

  const tryParsePdf = () => {
    log.debug({ msg: 'inventory_upload_pdftotext_attempt', path: file.path });
    let parsedRows = ctx.parseInventoryForecastRowsFromPdfPath(file.path, fallbackBizType, {
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
    return parsedRows;
  };

  return {
    ext,
    mime,
    fallbackDateFromName,
    getDebugMatrixSample: () => __debugMatrixSample,
    tryParseExcel,
    tryParseCsv,
    tryParsePdf,
  };
}

export async function parseUploadHistoryRows(file, ctx, log, uploadsDir) {
  const {
    ext,
    mime,
    getDebugMatrixSample,
    tryParseExcel,
    tryParseCsv,
    tryParsePdf,
  } = createUploadHistoryParsers(file, ctx, log, uploadsDir);

  let parsedRows = [];
  let parseMode = '';
  const parseErrors = [];

  const extLooksExcel = ext === '.xlsx' || ext === '.xls';
  const extLooksPdf = ext === '.pdf';
  const mimeLooksExcel = mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('sheet');
  const mimeLooksPdf = mime.includes('application/pdf') || mime.includes('/pdf');
  const unknownType = !ext;

  if (extLooksExcel || mimeLooksExcel || unknownType) {
    parseMode = parseMode ? `${parseMode}|excel_attempt` : 'excel_attempt';
    try {
      parsedRows = await tryParseExcel();
      if (parsedRows.length) parseMode = 'excel';
    } catch (e) {
      parseErrors.push(`excel:${String(e?.message || e)}`);
    }
  }
  if (!parsedRows.length) {
    if (extLooksPdf || mimeLooksPdf) {
      parseMode = parseMode ? `${parseMode}|pdf_attempt` : 'pdf_attempt';
      try {
        parsedRows = tryParsePdf();
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
    parseMode = parseMode ? `${parseMode}|excel_fallback_attempt` : 'excel_fallback_attempt';
    try {
      parsedRows = await tryParseExcel();
      if (parsedRows.length) parseMode = 'excel_fallback';
    } catch (e) {
      parseErrors.push(`excel_fallback:${String(e?.message || e)}`);
    }
  }

  return {
    parsedRows,
    parseMode,
    parseErrors,
    ext,
    mime,
    debugMatrixSample: getDebugMatrixSample(),
  };
}

export function buildUploadHistoryParseFailure(file, parseResult) {
  const { parsedRows, parseMode, parseErrors, ext, mime, debugMatrixSample } = parseResult;
  if (parsedRows.length) return null;

  const debugMsg = `文件:${String(file.originalname || 'unknown')} ext:${ext || 'none'} mime:${mime || 'none'} 模式:${parseMode || 'none'}${parseErrors.length ? ` 错误:${String(parseErrors[0] || '').slice(0, 80)}` : ''}`;
  return {
    ok: false,
    status: 400,
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
      matrixSample: debugMatrixSample.slice(0, 8)
    }
  };
}

export function applyUploadHistoryBizType(parsedRows, selectedBizType, log) {
  log.info({
    msg: 'inventory_upload_apply_biz_type',
    biz_type: selectedBizType,
    rows: parsedRows.length,
  });
  parsedRows.forEach((row) => { row.bizType = selectedBizType; });
}

export function logUploadHistoryStoreOverride(parsedRows, ctx, store, log) {
  const fileStores = Array.from(new Set(parsedRows
    .map((row) => ctx.normalizeForecastStoreName(row?.store))
    .filter(Boolean)));
  if (!fileStores.length) return;
  const selectedStoreKey = ctx.normalizeForecastStoreKey(store);
  const fileStoreKeys = Array.from(new Set(fileStores.map((x) => ctx.normalizeForecastStoreKey(x)).filter(Boolean)));
  if (fileStoreKeys.length && fileStoreKeys[0] !== selectedStoreKey) {
    log.info({
      msg: 'inventory_upload_store_override',
      file_stores: fileStores.slice(0, 5),
      selected_store: store,
    });
  }
}

export function findUploadHistoryDuplicateDates(parsedRows, state0, store, selectedBizType) {
  const existingDateSet = new Set(
    (Array.isArray(state0.inventoryForecastHistory) ? state0.inventoryForecastHistory : [])
      .filter((x) => String(x?.store || '').trim() === store)
      .filter((x) => String(x?.bizType || '').trim() === selectedBizType)
      .map((x) => String(x?.date || '').trim())
      .filter(Boolean)
  );
  const uploadDateSet = new Set(parsedRows.map((x) => String(x?.date || '').trim()).filter(Boolean));
  return Array.from(uploadDateSet).filter((d) => existingDateSet.has(d)).sort();
}

export function buildUploadHistoryDuplicateError(duplicatedDates, selectedBizType) {
  const label = selectedBizType === 'takeaway' ? '外卖' : '堂食';
  return {
    ok: false,
    status: 409,
    error: 'date_already_exists',
    message: `${label}历史中已存在以下营业日期，已阻止重复上传：${duplicatedDates.slice(0, 8).join('、')}${duplicatedDates.length > 8 ? ' 等' : ''}`,
    duplicatedDates
  };
}

export function groupUploadHistoryRows(parsedRows, ctx) {
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
  return byGroup;
}

export function buildUploadHistoryGroupedBreakdown(byGroup) {
  return Array.from(byGroup.entries()).map(([key, list]) => {
    const [bizType, slot] = String(key || '').split('||');
    return { bizType: bizType || '', slot: slot || '', rows: Array.isArray(list) ? list.length : 0 };
  });
}

export async function persistUploadHistoryGroups(ctx, state0, byGroup, store, username) {
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
  return { inserted, updated, skipped, accepted, evaluated };
}

export async function runUploadHistoryFile(ctx, input, deps) {
  const { log, uploadsDir } = deps;

  const auth = validateUploadHistoryAuth(input, ctx);
  if (!auth.ok) return auth;

  try {
    const state0 = (await ctx.getSharedState()) || {};
    const storeResolved = resolveUploadHistoryStore(ctx, input, state0, auth.username, auth.role);
    if (!storeResolved.ok) return storeResolved;
    const { store } = storeResolved;

    const fileInput = validateUploadHistoryFileInput(input);
    if (!fileInput.ok) return fileInput;
    const { file } = fileInput;
    const selectedBizType = ctx.normalizeForecastBizType(input.body?.bizType) || '';
    if (!selectedBizType) {
      return { ok: false, status: 400, error: 'invalid_biz_type', message: '请选择业务类型（外卖/堂食）后再上传。' };
    }

    const parseResult = await parseUploadHistoryRows(file, ctx, log, uploadsDir);
    const parseFailure = buildUploadHistoryParseFailure(file, parseResult);
    if (parseFailure) return parseFailure;

    const { parsedRows } = parseResult;
    applyUploadHistoryBizType(parsedRows, selectedBizType, log);
    logUploadHistoryStoreOverride(parsedRows, ctx, store, log);

    const duplicatedDates = findUploadHistoryDuplicateDates(parsedRows, state0, store, selectedBizType);
    if (duplicatedDates.length) {
      return buildUploadHistoryDuplicateError(duplicatedDates, selectedBizType);
    }

    const byGroup = groupUploadHistoryRows(parsedRows, ctx);
    if (!byGroup.size) return { ok: false, status: 400, error: 'no_valid_group' };

    const groupedBreakdown = buildUploadHistoryGroupedBreakdown(byGroup);
    const totals = await persistUploadHistoryGroups(ctx, state0, byGroup, store, auth.username);

    return {
      ok: true,
      store,
      parsedRows: parsedRows.length,
      grouped: byGroup.size,
      groupedBreakdown,
      ...totals,
    };
  } catch (_e) {
    return { ok: false, status: 500, error: 'server_error', message: 'internal_error' };
  }
}
