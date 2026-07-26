/**
 * BI deterministic feishu/bitable report replies (closing, opening, material, meeting, loss).
 */

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicClosingReportReply(deps) {
  const {
    pool,
    resolveDateRangeFromQuestion,
    extractBitableFieldText,
    isLikelySameStore,
    normalizeBitableDateValue,
    inDateRangeInclusive,
    getClosingTableId = () => '',
  } = deps;

  return async function buildBiDeterministicClosingReportReply(store, text) {
    const q = String(text || '').trim();
    const targetStore = String(store || '').trim();
    if (!targetStore) return '';
    if (!/(收档|收市|闭档|清洁|卫生|档口.*得分|得分.*档口|平均.*得分|得分.*平均)/.test(q)) return '';
    const period = resolveDateRangeFromQuestion(q, 7);
    const tableId = String(getClosingTableId()).trim();
    if (!tableId) return `收档报告数据源未配置，无法查询。`;
    try {
      const r = await pool().query(
        `SELECT fields FROM feishu_generic_records WHERE table_id = $1 ORDER BY updated_at DESC LIMIT 3000`,
        [tableId]
      );
      const all = (r.rows || []).map((row) => (row.fields && typeof row.fields === 'object' ? row.fields : {}));
      const matched = all.filter((f) => {
        const s = String(f['门店'] || f['所属门店'] || '').trim();
        return isLikelySameStore(s, targetStore);
      });
      const inRange = matched.filter((f) => {
        const d = normalizeBitableDateValue(f['提交时间'] || f['日期'], null);
        return d && inDateRangeInclusive(d, period.start, period.end);
      });
      if (!inRange.length) {
        return `${period.label}收档报告（${targetStore}）：0条记录。该时间段暂无收档报告入库。`;
      }
      const scores = inRange.map((f) => {
        const s = extractBitableFieldText(f['档口收档平均得分']);
        return parseFloat(s);
      }).filter((n) => !isNaN(n));
      const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '无';
      const passCount = inRange.filter((f) => /合格|通过|是/.test(extractBitableFieldText(f['是否合格']))).length;
      const passRate = inRange.length ? `${((passCount / inRange.length) * 100).toFixed(0)}%` : '无';
      const lines = [
        `${period.label}收档报告（${targetStore}）`,
        `- 收档记录：${inRange.length}条`,
        `- 档口平均得分：${avgScore}`,
        `- 合格率：${passRate}（${passCount}/${inRange.length}）`,
      ];
      if (scores.length) {
        lines.push(`- 最高分：${Math.max(...scores)} / 最低分：${Math.min(...scores)}`);
      }
      return lines.join('\n');
    } catch (e) {
      return `收档报告查询失败：${e?.message || '未知错误'}`;
    }
  };
}

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicOpeningReportReply(deps) {
  const {
    pool,
    resolveDateRangeFromQuestion,
    extractBitableFieldText,
    isLikelySameStore,
    normalizeBitableDateValue,
    inDateRangeInclusive,
    getOpeningTableId = () => '',
  } = deps;

  return async function buildBiDeterministicOpeningReportReply(store, text) {
    const q = String(text || '').trim();
    const targetStore = String(store || '').trim();
    if (!targetStore) return '';
    if (!/(开档|开市|备餐|开档.*记录|开档.*报告)/.test(q)) return '';
    const period = resolveDateRangeFromQuestion(q, 7);
    const tableId = String(getOpeningTableId()).trim();
    if (!tableId) return `开档报告数据源未配置，无法查询。`;
    try {
      const r = await pool().query(
        `SELECT fields FROM feishu_generic_records WHERE table_id = $1 ORDER BY updated_at DESC LIMIT 3000`,
        [tableId]
      );
      const all = (r.rows || []).map((row) => (row.fields && typeof row.fields === 'object' ? row.fields : {}));
      const matched = all.filter((f) => {
        const s = String(f['门店'] || f['所属门店'] || '').trim();
        return isLikelySameStore(s, targetStore);
      });
      const inRange = matched.filter((f) => {
        const d = normalizeBitableDateValue(f['记录日期'] || f['提交时间'] || f['日期'], null);
        return d && inDateRangeInclusive(d, period.start, period.end);
      });
      if (!inRange.length) {
        return `${period.label}开档报告（${targetStore}）：0条记录。该时间段暂无开档报告入库。`;
      }
      const stationTop = new Map();
      inRange.forEach((f) => {
        const station = extractBitableFieldText(f['岗位'] || f['档口']);
        if (station) stationTop.set(station, (stationTop.get(station) || 0) + 1);
      });
      const stationText = Array.from(stationTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join('、') || '无';
      const mealTop = new Map();
      inRange.forEach((f) => {
        const meal = extractBitableFieldText(f['饭市']);
        if (meal) mealTop.set(meal, (mealTop.get(meal) || 0) + 1);
      });
      const mealText = Array.from(mealTop.entries()).map(([k, v]) => `${k}(${v})`).join('、') || '无';
      return [`${period.label}开档报告（${targetStore}）`, `- 开档记录：${inRange.length}条`, `- 岗位分布：${stationText}`, `- 饭市分布：${mealText}`].join('\n');
    } catch (e) {
      return `开档报告查询失败：${e?.message || '未知错误'}`;
    }
  };
}

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicMaterialReportReply(deps) {
  const {
    pool,
    resolveDateRangeFromQuestion,
    extractBitableFieldText,
    isLikelySameStore,
    normalizeBitableDateValue,
    inDateRangeInclusive,
    getMaterialTableIds = () => [],
  } = deps;

  return async function buildBiDeterministicMaterialReportReply(store, text) {
    const q = String(text || '').trim();
    const targetStore = String(store || '').trim();
    if (!targetStore) return '';
    if (!/(原料|收货|食材|进货|供应商|原材料)/.test(q)) return '';
    const period = resolveDateRangeFromQuestion(q, 7);
    const tableIds = getMaterialTableIds().filter(Boolean);
    if (!tableIds.length) return `原料收货日报数据源未配置，无法查询。`;
    try {
      const r = await pool().query(
        `SELECT fields FROM feishu_generic_records WHERE table_id = ANY($1) ORDER BY updated_at DESC LIMIT 3000`,
        [tableIds]
      );
      const all = (r.rows || []).map((row) => (row.fields && typeof row.fields === 'object' ? row.fields : {}));
      const matched = all.filter((f) => {
        const s = String(f['所属门店'] || f['门店'] || '').trim();
        return isLikelySameStore(s, targetStore);
      });
      const inRange = matched.filter((f) => {
        const d = normalizeBitableDateValue(f['收货日期'] || f['日期'], null);
        return d && inDateRangeInclusive(d, period.start, period.end);
      });
      if (!inRange.length) {
        return `${period.label}原料收货日报（${targetStore}）：0条记录。该时间段暂无原料异常数据入库。`;
      }
      const hasIssue = inRange.filter((f) => {
        const feedback = extractBitableFieldText(f['今日异常反馈'] || f['今天原料情况']);
        return feedback && !/正常|无|没有/.test(feedback);
      });
      const materialTop = new Map();
      hasIssue.forEach((f) => {
        const name = extractBitableFieldText(f['异常原料名称']);
        if (name) materialTop.set(name, (materialTop.get(name) || 0) + 1);
      });
      const matText = Array.from(materialTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v}次)`).join('、') || '无';
      const severityTop = new Map();
      hasIssue.forEach((f) => {
        const sev = extractBitableFieldText(f['严重情况']);
        if (sev) severityTop.set(sev, (severityTop.get(sev) || 0) + 1);
      });
      const sevText = Array.from(severityTop.entries()).map(([k, v]) => `${k}(${v})`).join('、') || '无';
      const lines = [
        `${period.label}原料收货日报（${targetStore}）`,
        `- 收货记录：${inRange.length}条`,
        `- 异常记录：${hasIssue.length}条`,
        `- 异常原料Top：${matText}`,
        `- 严重程度：${sevText}`,
      ];
      return lines.join('\n');
    } catch (e) {
      return `原料收货日报查询失败：${e?.message || '未知错误'}`;
    }
  };
}

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicMeetingReportReply(deps) {
  const {
    pool,
    resolveDateRangeFromQuestion,
    extractBitableFieldText,
    isLikelySameStore,
    normalizeBitableDateValue,
    inDateRangeInclusive,
    getMeetingTableId = () => '',
  } = deps;

  return async function buildBiDeterministicMeetingReportReply(store, text) {
    const q = String(text || '').trim();
    const targetStore = String(store || '').trim();
    if (!targetStore) return '';
    if (!/(例会|早会|班会|会议|开会|例会.*得分|例会.*分数|例会.*合格)/.test(q)) return '';
    const period = resolveDateRangeFromQuestion(q, 30);
    const tableId = String(getMeetingTableId()).trim();
    if (!tableId) return `例会报告数据源未配置，无法查询。`;
    try {
      const r = await pool().query(
        `SELECT fields FROM feishu_generic_records WHERE table_id = $1 ORDER BY updated_at DESC LIMIT 500`,
        [tableId]
      );
      const rows = (r.rows || []).filter((row) => {
        const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
        const rowStore = extractBitableFieldText(f['所属门店'] || f['门店']);
        if (!isLikelySameStore(rowStore, targetStore)) return false;
        const d = normalizeBitableDateValue(f['记录日期'] || f['提交时间'] || f['日期'] || f['例会日期'], row?.created_at);
        return d && inDateRangeInclusive(d, period.start, period.end);
      });
      if (!rows.length) return `📊 ${period.label}例会数据（${targetStore}）：暂无例会记录入库。`;
      const scores = rows.map((row) => {
        const f = row.fields || {};
        let v = parseFloat(extractBitableFieldText(f['得分']));
        if (isNaN(v)) {
          const qualText = String(f['是否合格的例会'] || '');
          const m = qualText.match(/(\d+(?:\.\d+)?)\s*分/);
          if (m) v = parseFloat(m[1]);
        }
        return v;
      }).filter((n) => !isNaN(n));
      const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '-';
      const qualRows = rows.filter((row) => {
        const qt = String(row.fields?.['是否合格的例会'] || '');
        return qt.includes('合格') && !qt.includes('不合格');
      });
      const qualRate = rows.length > 0 ? `${qualRows.length}/${rows.length}次合格` : null;
      const hosts = new Map();
      rows.forEach((row) => {
        const h = extractBitableFieldText(row.fields['主持人']);
        if (h) hosts.set(h, (hosts.get(h) || 0) + 1);
      });
      const absentees = new Map();
      rows.forEach((row) => {
        const abs = extractBitableFieldText(row.fields['缺席人员姓名']);
        if (abs && abs !== '无') {
          abs.split(/[,，、]/).forEach((n) => {
            n = n.trim();
            if (n) absentees.set(n, (absentees.get(n) || 0) + 1);
          });
        }
      });
      const lines = [`📊 ${period.label}例会数据（${targetStore}）`];
      lines.push(`- 例会记录：${rows.length}次`);
      if (avgScore !== '-') lines.push(`- 平均得分：${avgScore}分`);
      if (qualRate) lines.push(`- 合格情况：${qualRate}`);
      if (hosts.size) lines.push(`- 主持人：${Array.from(hosts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
      if (absentees.size) lines.push(`- 缺席频次Top：${Array.from(absentees.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
      return lines.join('\n');
    } catch (e) {
      return `例会数据查询失败：${e?.message || '未知错误'}`;
    }
  };
}

/**
 * @param {object} deps
 * @returns {(store: string, text: string) => Promise<string>}
 */
export function createBuildBiDeterministicLossReportReply(deps) {
  const {
    pool,
    resolveDateRangeFromQuestion,
    extractBitableFieldText,
    isLikelySameStore,
    normalizeBitableDateValue,
    inDateRangeInclusive,
    getLossTableId = () => '',
  } = deps;

  return async function buildBiDeterministicLossReportReply(store, text) {
    const q = String(text || '').trim();
    const targetStore = String(store || '').trim();
    if (!targetStore) return '';
    if (!/(报损|损耗|废弃|报废|丢弃)/.test(q)) return '';
    const period = resolveDateRangeFromQuestion(q, 30);
    const tableId = String(getLossTableId()).trim();
    if (!tableId) return `报损单数据源未配置，无法查询。`;
    try {
      const r = await pool().query(
        `SELECT fields, created_at FROM feishu_generic_records WHERE table_id = $1 ORDER BY updated_at DESC LIMIT 3000`,
        [tableId]
      );
      const rows = (r.rows || []).filter((row) => {
        const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
        const rowStore = extractBitableFieldText(f['所属门店'] || f['门店'] || f['报损门店']);
        if (rowStore && !isLikelySameStore(rowStore, targetStore)) return false;
        const d = normalizeBitableDateValue(f['日期'] || f['创建日期'] || f['报损日期'] || f['提交时间'], row?.created_at);
        return d && inDateRangeInclusive(d, period.start, period.end);
      });
      if (!rows.length) return `📊 ${period.label}报损数据（${targetStore}）：暂无报损记录入库。`;
      const itemTop = new Map();
      let totalAmount = 0;
      rows.forEach((row) => {
        const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
        const item = extractBitableFieldText(f['报损菜品'] || f['报损品名'] || f['品名'] || f['物品名称'] || f['报损物品']);
        const amount = parseFloat(extractBitableFieldText(f['报损金额'] || f['金额'] || f['损失金额'] || f['报损数量'])) || 0;
        if (item) itemTop.set(item, (itemTop.get(item) || 0) + 1);
        totalAmount += amount;
      });
      const reasonTop = new Map();
      rows.forEach((row) => {
        const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
        const reason = extractBitableFieldText(f['报损原因'] || f['原因']);
        if (reason) reasonTop.set(reason, (reasonTop.get(reason) || 0) + 1);
      });
      const lines = [`📊 报损数据（${targetStore}·${period.label}）`];
      lines.push(`- 报损记录：${rows.length}条`);
      if (totalAmount > 0) lines.push(`- 报损总额：¥${totalAmount.toFixed(2)}`);
      if (itemTop.size) lines.push(`- 报损菜品Top：${Array.from(itemTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
      if (reasonTop.size) lines.push(`- 报损原因：${Array.from(reasonTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
      const recent = rows.slice(0, 5);
      if (recent.length) {
        lines.push('', '📝 最近报损明细：');
        recent.forEach((row, i) => {
          const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
          const dish = extractBitableFieldText(f['报损菜品'] || f['报损品名'] || '');
          const qty = extractBitableFieldText(f['报损数量'] || '');
          const reason = extractBitableFieldText(f['报损原因'] || '');
          const dept = extractBitableFieldText(f['报损部门'] || '');
          const d = normalizeBitableDateValue(f['日期'], row?.created_at);
          lines.push(`${i + 1}. ${d || '-'} ${dish || '-'} ${qty || '-'} ${reason || ''}${dept ? `（${dept}）` : ''}`);
        });
      }
      lines.push('> 数据源：loss_reports（报损单）');
      return lines.join('\n');
    } catch (e) {
      return `报损数据查询失败：${e?.message || '未知错误'}`;
    }
  };
}
