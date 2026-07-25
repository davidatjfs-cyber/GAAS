import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'feishu-bitable', handler: 'map' });

export function stripAttachmentLikeFields(fields) {
  const src = fields && typeof fields === 'object' ? fields : {};
  const out = {};
  Object.entries(src).forEach(([k, v]) => {
    if (!k) return;
    const key = String(k).toLowerCase();
    if (key.includes('附件') || key.includes('attachment') || key.includes('file') || key.includes('图片') || key.includes('image')) return;
    out[k] = v;
  });
  return out;
}

export function mapFeishuFieldToHrms(feishuRecord, fieldType) {
  const mapped = {};

  const normalizeFeishuFieldValue = (rawValue) => {
    if (rawValue == null) return '';
    if (typeof rawValue === 'string') return rawValue.trim();
    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') return rawValue;

    if (Array.isArray(rawValue)) {
      const parts = rawValue
        .map((item) => normalizeFeishuFieldValue(item))
        .filter((item) => item !== '' && item != null);
      if (!parts.length) return '';
      if (parts.length === 1) return parts[0];
      return parts.map((item) => String(item)).join(', ');
    }

    if (typeof rawValue === 'object') {
      if (typeof rawValue.text === 'string' && rawValue.text.trim()) return rawValue.text.trim();
      if (Array.isArray(rawValue.text_arr) && rawValue.text_arr.length) return rawValue.text_arr.join('');
      if (typeof rawValue.name === 'string' && rawValue.name.trim()) return rawValue.name.trim();
      if (typeof rawValue.id === 'string' && rawValue.id.trim()) return rawValue.id.trim();
      return '';
    }

    return String(rawValue || '').trim();
  };

  const normalizePgTimeOrNull = (rawValue) => {
    const s = String(normalizeFeishuFieldValue(rawValue) || '').trim();
    if (!s) return null;
    if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
    if (/^\d{2}:\d{2}$/.test(s)) return s + ':00';
    return null;
  };

  const parseFeishuNumber = (rawValue) => {
    const normalized = normalizeFeishuFieldValue(rawValue);
    const text = String(normalized || '').trim();
    if (!text) return 0;
    const n = Number(text.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  const parseFeishuBoolean = (rawValue) => {
    if (typeof rawValue === 'boolean') return rawValue;
    const normalized = String(normalizeFeishuFieldValue(rawValue) || '').trim().toLowerCase();
    if (!normalized) return false;
    return ['是', 'true', '1', 'yes', 'y'].includes(normalized);
  };

  const parseFeishuDate = (rawValue) => {
    const normalized = normalizeFeishuFieldValue(rawValue);
    if (normalized === '' || normalized == null) return '';

    const toDateOnly = (dateObj) => {
      if (!dateObj || !Number.isFinite(dateObj.getTime())) return '';
      return dateObj.toISOString().slice(0, 10);
    };

    if (typeof normalized === 'number' && Number.isFinite(normalized)) {
      const millis = normalized > 1e12 ? normalized : normalized * 1000;
      return toDateOnly(new Date(millis));
    }

    const text = String(normalized).trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    if (/^\d{13}$/.test(text)) return toDateOnly(new Date(Number(text)));
    if (/^\d{10}$/.test(text)) return toDateOnly(new Date(Number(text) * 1000));

    const parsed = new Date(text);
    if (Number.isFinite(parsed.getTime())) return toDateOnly(parsed);
    return '';
  };

  const fields = feishuRecord?.fields || {};
  const pickRaw = (...keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) return fields[key];
    }
    return undefined;
  };
  const pickText = (...keys) => String(normalizeFeishuFieldValue(pickRaw(...keys)) || '').trim();

  if (fieldType === 'table_visit') {
    // 桌访记录完整字段映射（供agent使用）
    // 飞书多维里常见主键为「记录日期」「提交时间」，旧模板用「日期」；缺任一都会导致无法入结构化表
    mapped.date = parseFeishuDate(pickRaw('记录日期', '提交时间', '日期', '就餐日期', '发生日期', '营业日期'));
    mapped.store = pickText('所属门店', '门店', '店铺');
    mapped.brand = pickText('所属品牌', '品牌');
    mapped.tableNumber = pickText('桌号', '桌位号');
    mapped.guestCount = parseFeishuNumber(pickRaw('就餐人数', '人数'));
    mapped.amount = parseFeishuNumber(pickRaw('消费金额', '消费额', '金额'));
    mapped.hasReservation = parseFeishuBoolean(pickRaw('是否有预订', '有无预订'));
    mapped.dissatisfactionDish = pickText(
      '今天不满意的菜品',
      '今天 不满意菜品',
      '今日不满意菜品',
      '不满意菜品'
    );
    mapped.feedback = pickText('顾客反馈', '反馈', '评价');

    // 扩展字段（供agent分析使用）
    mapped.reservationTime = normalizePgTimeOrNull(pickRaw('预订时间'));
    mapped.customerType = pickText('是否第一次来', '新老客户', '客户类型');
    mapped.orderType = pickText('点单方式');
    mapped.serviceRating = parseFeishuNumber(pickRaw('服务评分'));
    mapped.foodRating = parseFeishuNumber(pickRaw('菜品评分'));
    mapped.environmentRating = parseFeishuNumber(pickRaw('环境评分'));
    mapped.waiterName = pickText('服务员姓名');
    mapped.promotionInfo = pickText('哪里知道我们的', '如何知道我们', '客流渠道', '促销活动');
    mapped.weather = pickText('天气情况');
    mapped.peakHours = parseFeishuBoolean(pickRaw('高峰时段'));
    mapped.customerComplaint = pickText('客户投诉');
    mapped.complaintResolution = pickText('投诉处理');
    mapped.satisfactionLevel = pickText('今天用餐是否满意', '满意度等级', '满意度');
    mapped.repeatCustomer = parseFeishuBoolean(pickRaw('是否回头客'));
    mapped.specialRequests = pickText('特殊要求');
    mapped.paymentMethod = pickText('支付方式');
    mapped.orderDuration = parseFeishuNumber(pickRaw('用餐时长（分钟）', '用餐时长'));
    mapped.tableTurnover = parseFeishuNumber(pickRaw('翻台次数'));
    mapped.dishRecommendations = pickText('推荐菜品', '菜品推荐');
    mapped.allergicInfo = pickText('过敏信息');
    mapped.celebrationType = pickText('庆祝类型');
    mapped.visitPurpose = pickText('就餐目的');
    mapped.companionInfo = pickText('同行人员');
    mapped.customerAge = pickText('客户年龄段');
    mapped.customerGender = pickText('客户性别');
    mapped.visitFrequency = pickText('就餐频次');
    mapped.preferredDishes = pickText('今天比较喜欢的菜', '比较喜欢菜品', '偏好菜品');
    mapped.unsatisfiedItems = pickText(
      '不满意的主要原因是什么',
      '不满意的主要原因',
      '满意或不满意的主要原因是什么？',
      '满意或不满意的主要原因',
      '满意/不满意的主要原因',
      '不满意项',
      '不满意原因'
    );
    mapped.suggestedImprovements = pickText('改进建议');
    mapped.staffPerformance = pickText('员工表现');
    mapped.facilityIssues = pickText('设施问题');
    mapped.hygieneRating = parseFeishuNumber(pickRaw('卫生评分'));
    mapped.valueRating = parseFeishuNumber(pickRaw('性价比评分'));
    mapped.ambianceRating = parseFeishuNumber(pickRaw('氛围评分'));
    mapped.noiseLevel = pickText('噪音水平');
    mapped.temperature = pickText('室内温度');
    mapped.lighting = pickText('照明情况');
    mapped.musicVolume = pickText('音乐音量');
    mapped.seatingComfort = pickText('座位舒适度');
    mapped.queueTime = parseFeishuNumber(pickRaw('等位时间（分钟）', '等位时间'));
    mapped.serviceSpeed = pickText('服务速度');
    mapped.orderAccuracy = pickText('点单准确性');
    mapped.staffAttitude = pickText('员工态度');
    mapped.problemResolution = pickText('问题解决');
    mapped.managerIntervention = parseFeishuBoolean(pickRaw('经理介入'));
    mapped.compensationProvided = pickText('补偿措施');
    mapped.followUpRequired = parseFeishuBoolean(pickRaw('需要跟进'));
    mapped.followUpDetails = pickText('跟进详情');
    mapped.additionalNotes = pickText('备注');
    mapped.rushDishContent = pickText('今天催菜内容', '催菜内容');
    mapped.recordId = feishuRecord?.record_id;

    log.info({
      msg: 'feishu_table_visit_mapped',
      record_id: mapped.recordId || null,
      mapped_date: mapped.date || null,
      mapped_store: mapped.store || null,
    });
  }

  return mapped;
}
