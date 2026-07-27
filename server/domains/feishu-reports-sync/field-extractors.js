/**
 * 飞书表格同步：多维表字段提取纯函数（开档/收档/例会/原料收货/菜品库/SOP步骤）。
 * 从 server/feishu-sync.js 拆出（behavior-preserving extract）。
 */

export function extractFieldText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value
      .map(v => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
        if (typeof v === 'object') return String(v.text || v.name || v.value || '').trim();
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();
  }
  if (typeof value === 'object') return String(value.text || value.name || value.value || '').trim();
  return '';
}

export function pickFieldValue(fields, names = []) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) return fields[name];
  }
  return null;
}

export function pickFieldText(fields, names = [], fallback = '') {
  const v = pickFieldValue(fields, names);
  const text = extractFieldText(v);
  return text || fallback;
}

export function parseFieldNumber(value) {
  const text = extractFieldText(value).replace(/[,，\s]/g, '');
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : null;
}

export function pickFieldNumber(fields, names = []) {
  const v = pickFieldValue(fields, names);
  return parseFieldNumber(v);
}

export function extractDishLibraryEntries(fields, recordId, opts = {}) {
  const forceBizType = String(opts.forceBizType || '').trim();
  const store = pickFieldText(fields, ['门店', '门店名称', '适用门店', '适用店铺'], '*') || '*';
  // 品牌：优先取「品牌」列；缺省则从「所属门店」/门店名前缀(洪潮/马己仙)推断；再缺省 '*'（通用）。
  // 品牌是成本归属的唯一可靠维度，避免两品牌同名菜成本互相污染。
  const brandText = pickFieldText(fields, ['品牌', 'brand']);
  const ownerStore = pickFieldText(fields, ['所属门店'], '');
  const brand = brandText
    || (`${ownerStore}${store}`.includes('洪潮') ? '洪潮' : (`${ownerStore}${store}`.includes('马己仙') ? '马己仙' : ''))
    || '*';

  const commonCost = pickFieldNumber(fields, ['菜品成本', '成本', '标准成本']);
  const dineinName = pickFieldText(fields, ['堂食名称', '堂食菜品名称', '堂食菜名', '菜品名称']);
  const dineinPrice = pickFieldNumber(fields, ['堂食价格', '堂食售价', '堂食单价', '堂食出品价']);
  const dineinCost = pickFieldNumber(fields, ['堂食成本', '堂食菜品成本', '堂食标准成本']);

  const takeawayName = pickFieldText(fields, ['外卖名称', '外卖菜品名称', '外卖菜名']);
  const takeawayPrice = pickFieldNumber(fields, ['外卖价格', '外卖售价', '外卖单价']);
  const takeawayCost = pickFieldNumber(fields, ['外卖成本', '外卖菜品成本', '外卖标准成本']);
  const genericDishName = pickFieldText(fields, ['菜品名称', '菜名', '商品名称', 'SKU名称']);
  const genericPrice = pickFieldNumber(fields, ['售价', '价格', '单价']);

  const rows = [];
  if (forceBizType === 'takeaway' && genericDishName && (genericPrice !== null || takeawayCost !== null || commonCost !== null)) {
    rows.push({
      feishu_record_id: recordId,
      store,
      brand,
      biz_type: 'takeaway',
      dish_name: genericDishName,
      dish_price: genericPrice,
      unit_cost: takeawayCost ?? commonCost ?? 0,
      source_data: fields
    });
  }

  if (forceBizType !== 'takeaway' && dineinName && (dineinPrice !== null || dineinCost !== null || commonCost !== null)) {
    rows.push({
      feishu_record_id: recordId,
      store,
      brand,
      biz_type: 'dinein',
      dish_name: dineinName,
      dish_price: dineinPrice,
      unit_cost: dineinCost ?? commonCost ?? 0,
      source_data: fields
    });
  }

  if (takeawayName && (takeawayPrice !== null || takeawayCost !== null || commonCost !== null)) {
    rows.push({
      feishu_record_id: recordId,
      store,
      brand,
      biz_type: 'takeaway',
      dish_name: takeawayName,
      dish_price: takeawayPrice,
      unit_cost: takeawayCost ?? commonCost ?? 0,
      source_data: fields
    });
  }

  return rows;
}

// 收档报告字段提取
export function extractClosingReportFields(fields) {
  return {
    store: fields['门店'],
    date: fields['日期'],
    station: fields['档口'],
    responsible: fields['本档口值班负责人'],
    handover_time: fields['交接时间'],
    inventory_check: fields['本档口库存检查'],
    cleaning_status: fields['本档口清洁卫生'],
    equipment_status: fields['设备使用情况'],
    temperature_record: fields['温度记录'],
    handover_person: fields['交接人'],
    handover_receiver: fields['接收人'],
    issues: fields['异常情况说明'],
    submit_time: fields['提交时间']
  };
}

// 开档报告字段提取
export function extractOpeningReportFields(fields) {
  return {
    store: fields['门店'],
    date: fields['日期'],
    station: fields['档口'],
    responsible: fields['本档口值班负责人'],
    preparation_time: fields['开档时间'],
    inventory_check: fields['本档口库存检查'],
    cleaning_status: fields['本档口清洁卫生'],
    equipment_status: fields['设备使用情况'],
    temperature_record: fields['温度记录'],
    handover_person: fields['交接人'],
    handover_receiver: fields['接收人'],
    issues: fields['异常情况说明'],
    submit_time: fields['提交时间']
  };
}

// 例会报告字段提取
export function extractMeetingReportFields(fields) {
  return {
    store: fields['门店'],
    date: fields['日期'],
    meeting_time: fields['会议时间'],
    attendees: fields['参会人员'],
    meeting_content: fields['会议内容'],
    action_items: fields['待办事项'],
    meeting_score: parseInt(fields['会议得分']) || 0,
    reporter: fields['汇报人'],
    submit_time: fields['提交时间']
  };
}

// 原料收货日报字段提取
export function extractMaterialReportFields(fields) {
  return {
    store: fields['门店'],
    date: fields['日期'],
    receiver: fields['收货人'],
    suppliers: fields['供应商'],
    material_categories: fields['原料类别'],
    total_quantity: fields['总数量'],
    total_amount: fields['总金额'],
    quality_check: fields['质量检查'],
    temperature_check: fields['温度检查'],
    storage_location: fields['储存位置'],
    issues: fields['异常情况'],
    submit_time: fields['提交时间']
  };
}

export function extractSopStepFields(fields, recordId) {
  // 字段名与飞书表格列名对应
  const dishName   = pickFieldText(fields, ['菜品名称', 'dish_name', '品名']);
  const store      = pickFieldText(fields, ['门店', 'store']) || '*';
  const station    = pickFieldText(fields, ['档口', 'station', '岗位']);
  const stepSeq    = parseFieldNumber(pickFieldValue(fields, ['步骤序号', 'step_seq', '序号', '步骤']));
  const action     = pickFieldText(fields, ['操作动作', 'action', '操作']);
  const timeLimitRaw = pickFieldValue(fields, ['时限秒', 'time_limit_seconds', '时限（秒）', '时限']);
  const timeLimit  = parseFieldNumber(timeLimitRaw);
  const quality    = pickFieldText(fields, ['质量标准', 'quality_standard', '标准']);
  const failure    = pickFieldText(fields, ['常见失败', 'common_failure', '常见问题']);
  const rescue     = pickFieldText(fields, ['失败补救', 'failure_action', '补救措施']);

  // 飞书复选框字段：值为 true/false 或 1/0
  const isCriticalRaw = pickFieldValue(fields, ['是否关键步骤', 'is_critical', '关键步骤']);
  const isCritical = isCriticalRaw === true || isCriticalRaw === 1
    || String(isCriticalRaw).toLowerCase() === 'true';

  if (!dishName || !station || stepSeq == null || !action) return null;

  return {
    dish_name: dishName,
    store: store || '*',
    station,
    step_seq: stepSeq,
    action,
    time_limit_seconds: timeLimit,
    quality_standard: quality || null,
    common_failure: failure || null,
    failure_action: rescue || null,
    is_critical: isCritical,
    feishu_record_id: recordId || null
  };
}
