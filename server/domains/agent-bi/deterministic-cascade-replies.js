/**
 * Remaining BI deterministic cascade replies (Wave A5c peel from agents.js).
 * Fact-source audit helpers stay in agents.js.
 */

/**
 * @param {object} deps
 * @returns {object} named reply builders
 */
export function createDeterministicCascadeReplies(deps) {
  const {
    pool,
    isBiSourceEnabled,
    resolveDateRangeFromQuestion,
    loadUnifiedTableVisitRowsByStore,
    extractTableVisitDishes,
    extractBitableFieldText,
    isLikelySameStore,
    normalizeBitableDateValue,
    inDateRangeInclusive,
    getClosingTableId = () => '',
    getOpeningTableId = () => '',
    getMeetingTableId = () => '',
    getLossTableId = () => '',
    getMaterialTableIds = () => [],
  } = deps;

  async function buildBiDeterministicDataSourceCoverageReply(text) {

      const q = String(text || '').trim();
      if (!/(数据源|数据范围|能查什么|知道什么|覆盖|哪些表|可用数据)/.test(q)) return '';

      const sourceDefs = [
        { key: 'table_visit_records', label: '桌访记录（系统入库）', sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM table_visit_records` },
        { key: 'daily_reports', label: '营业日报（系统）', sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM daily_reports` },
        { key: 'bad_reviews', label: '差评报告（同步）', sql: `SELECT COUNT(*)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='negative_review'` },
        { key: 'opening_reports_bitable', label: '开档报告（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='opening_report'` },
        { key: 'closing_reports_bitable', label: '收档报告（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='closing_report'` },
        { key: 'meeting_reports_bitable', label: '例会报告（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='meeting_report'` },
        { key: 'material_majixian_bitable', label: '马己仙原料收货（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='material_report' AND lower(coalesce(agent_data->>'brand','')) LIKE '%maji%'` },
        { key: 'material_hongchao_bitable', label: '洪潮原料收货（同步）', sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='material_report' AND lower(coalesce(agent_data->>'brand','')) LIKE '%hong%'` }
      ];

      const lines = [];
      for (const s of sourceDefs) {
        if (!isBiSourceEnabled(s.key)) {
          lines.push(`- ${s.label}：已禁用`);
          continue;
        }
        try {
          const r = await pool().query(s.sql);
          const c = Number(r.rows?.[0]?.c || 0);
          const latest = String(r.rows?.[0]?.latest || '').trim() || '-';
          lines.push(`- ${s.label}：${c}条（latest=${latest}）`);
        } catch (_e) {
          lines.push(`- ${s.label}：查询失败`);
        }
      }

      return `当前 BI 可用数据源覆盖如下：\n${lines.join('\n')}\n\n说明：事实问答仅使用以上可用且可查询的数据源；缺失时将固定拒答。`;

  }

  async function buildBiDeterministicTableVisitReply(store, text) {

      const q = String(text||'').trim(), s = String(store||'').trim();
      if (!s) return '';
      if (!/(桌访|桌巡|巡台|不满意.*菜|菜品.*不满意|出品.*不满意|最不满意|不满意在哪|主要不满意|不满意.*原因|哪里不满意|什么不满意)/.test(q)) return '';
      if (!isBiSourceEnabled('table_visit_records') && !isBiSourceEnabled('table_visit_bitable')) return '';
      const p = resolveDateRangeFromQuestion(q, 7);
      try {
        const rows = await loadUnifiedTableVisitRowsByStore(s, p.start, p.end);
        if (!rows.length) return `📋 ${p.label}桌访记录（${s}）：暂无桌访数据。`;
        // 维度1：不满意菜品
        const dishMap = {};
        for (const row of rows) {
          const items = String(row.dissatisfaction_dish||'').split(/[，,、]+/).map(x=>x.trim()).filter(x=>x&&!/卤鹅/.test(x));
          for (const d of items) { dishMap[d] = (dishMap[d]||0) + 1; }
        }
        const dishSorted = Object.entries(dishMap).sort((a,b)=>b[1]-a[1]);
        // 维度2：桌访反馈原因（unsatisfied_items）
        const fbMap = {};
        const blockedFb = new Set(['无','没有','暂无','不清楚','未知','其他','']);
        for (const row of rows) {
          const fb = String(row.unsatisfied_items||'').trim();
          if (fb && !blockedFb.has(fb)) {
            fb.split(/[，,、]+/).map(x=>x.trim()).filter(Boolean).forEach(x => { fbMap[x] = (fbMap[x]||0) + 1; });
          }
        }
        const fbSorted = Object.entries(fbMap).sort((a,b)=>b[1]-a[1]);
        // dish-specific: detect if user asks about a specific dish (e.g. "叉烧主要不满意在哪里")
        const dishNames = dishSorted.map(([d])=>d);
        const mentionedDish = dishNames.find(d => q.includes(d));
        if (mentionedDish) {
          const dishRows = rows.filter(row => String(row.dissatisfaction_dish||'').includes(mentionedDish));
          const dishFb = {};
          for (const row of dishRows) {
            const fb = String(row.unsatisfied_items||'').trim();
            if (fb && !blockedFb.has(fb)) { fb.split(/[，,、]+/).map(x=>x.trim()).filter(Boolean).forEach(x => { dishFb[x] = (dishFb[x]||0) + 1; }); }
          }
          const dishFbSorted = Object.entries(dishFb).sort((a,b)=>b[1]-a[1]);
          const dl = [`📋 「${mentionedDish}」桌访不满意详情（${s}·${p.label}）【数据来源：桌访巡台记录】`, `提及「${mentionedDish}」的桌访共${dishRows.length}条（总${rows.length}条中）`];
          if (dishFbSorted.length) { dl.push('', '🔔 关联不满意反馈：'); dishFbSorted.slice(0,8).forEach(([d,c],i) => dl.push(`${i+1}. ${d}（${c}次）`)); }
          else { dl.push('', '桌访记录中未记录该菜品的具体不满意原因，仅记录了菜品名称。'); }
          return dl.join('\n');
        }
        const lines = [`📋 桌访反馈（${s}·${p.label}）【数据来源：桌访巡台记录，非大众点评】`, `共${rows.length}条桌访记录`];
        if (fbSorted.length) {
          lines.push('', '🔔 桌访不满意反馈TOP：');
          fbSorted.slice(0,8).forEach(([d,c],i) => lines.push(`${i+1}. ${d}（${c}次）`));
        }
        if (dishSorted.length) {
          lines.push('', '🍽 桌访不满意菜品TOP：');
          dishSorted.slice(0,8).forEach(([d,c],i) => lines.push(`${i+1}. ${d}（${c}次）`));
        }
        if (!fbSorted.length && !dishSorted.length) {
          lines.push('', '该时段桌访未记录明确不满意内容。');
        }
        return lines.join('\n');
      } catch(e) { return `桌访数据查询失败：${e?.message||'未知错误'}`; }

  }

  async function buildBiDeterministicOpsReportCountReply(store, text) {

      const q = String(text || '').trim();
      const targetStore = String(store || '').trim();
      if (!targetStore) return '';
      if (!/(开档|收档|例会|原料)/.test(q)) return '';
      if (!/(多少|几次|几条|总数|次数|记录数|统计|一共|有没有|是否|吗)/.test(q)) return '';

      const period = resolveDateRangeFromQuestion(q, 7);
      const periodLabel = period.label;
      const start = period.start;
      const end = period.end;
      const rows = await loadUnifiedTableVisitRowsByStore(targetStore, start, end);
      if (!rows.length) {
        return `${periodLabel}桌访数据（${targetStore}）：0条记录。该时间段暂无桌访数据入库。`;
      }

      // 统计不满意菜品
      const dishTop = new Map();
      rows.forEach((x) => {
        extractTableVisitDishes(x).forEach((k) => dishTop.set(k, (dishTop.get(k) || 0) + 1));
      });
      const dishTopList = Array.from(dishTop.entries()).sort((a, b) => b[1] - a[1]);
      const topDish = dishTopList[0] || null;

      // 统计顾客反馈/满意原因（unsatisfied_items 实际存的是满意或不满意原因）
      const feedbackTop = new Map();
      const blockedFb = new Set(['无', '没有', '暂无', '不清楚', '未知', '其他', '']);
      rows.forEach((x) => {
        const reason = String(x?.unsatisfied_items || '').trim();
        if (reason && !blockedFb.has(reason)) {
          feedbackTop.set(reason, (feedbackTop.get(reason) || 0) + 1);
        }
      });
      const feedbackList = Array.from(feedbackTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const _feedbackText = feedbackList.map(([k, v]) => `「${k}」(${v}次)`).join('、') || '无';
      const feedbackCount = rows.filter(x => { const r = String(x?.unsatisfied_items || '').trim(); return r && !blockedFb.has(r); }).length;

      // 识别负面反馈（排除明显正面内容后，匹配负面关键词）
      const positiveOnly = /^(.*好吃.*|.*满意.*|.*不错.*|.*喜欢.*|.*很好.*|.*挺好.*|.*可以的|.*味道好.*)$/;
      const negativePattern = /太[咸淡冷油辣热硬]|有点[咸淡冷硬腥慢小挤]|不满意|不好吃|不新鲜|不够|偏[咸淡]|等[很太]久|等了[很太]久|上菜[有稍]?[点微]?慢|不[满熟行]|肿了|太老|没有肉感|不是很满意|该[咸淡]的不[咸淡]/;
      const negFeedbackTop = new Map();
      rows.forEach((x) => {
        const reason = String(x?.unsatisfied_items || '').trim();
        if (reason && !blockedFb.has(reason) && negativePattern.test(reason) && !positiveOnly.test(reason)) {
          negFeedbackTop.set(reason, (negFeedbackTop.get(reason) || 0) + 1);
        }
      });
      const negList = Array.from(negFeedbackTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const negCount = negList.reduce((s, [, v]) => s + v, 0);
      const _negText = negList.map(([k, v]) => `「${k}」(${v}次)`).join('、');

      const dissatisfactionIntent = /(最不满意|哪里不满意|哪些不满意|不满意点|不满意.*菜|菜品.*不满意|出品.*不满意)/.test(q);
      if (dissatisfactionIntent) {
        const lines = [`📋 ${periodLabel}桌访不满意反馈（${targetStore}）`];
        lines.push(`样本：${rows.length}条桌访`);
        if (negList.length) {
          lines.push(`\n⚠️ 负面反馈（${negCount}条）：`);
          negList.forEach(([k, v]) => lines.push(`  · ${k}（${v}次）`));
        }
        if (topDish) {
          lines.push(`\n🍽 不满意菜品：`);
          dishTopList.slice(0, 5).forEach(([k, v]) => lines.push(`  · ${k}（${v}次）`));
        }
        if (!negList.length && !topDish) {
          lines.push(`\n该时段顾客未反馈明确不满意内容。`);
        }
        return lines.join('\n');
      }

      if (/(多少|几条|总数|记录|样本|一共)/.test(q)) {
        return `${periodLabel}桌访数据（${targetStore}）\n- 桌访记录：${rows.length}条\n- 含反馈记录：${feedbackCount}条`;
      }

      // 默认兜底：简洁统计摘要
      const lines = [`📋 ${periodLabel}桌访概况（${targetStore}）`];
      lines.push(`- 桌访记录：${rows.length}条`);
      if (negList.length) lines.push(`- 负面反馈：${negList.slice(0, 3).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
      if (topDish) lines.push(`- 不满意菜品：${dishTopList.slice(0, 3).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
      return lines.join('\n');

  }

  async function buildBiDeterministicClosingReportReply(store, text) {

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
        const all = (r.rows || []).map(row => row.fields && typeof row.fields === 'object' ? row.fields : {});
        const matched = all.filter(f => {
          const s = String(f['门店'] || f['所属门店'] || '').trim();
          return isLikelySameStore(s, targetStore);
        });
        const inRange = matched.filter(f => {
          const d = normalizeBitableDateValue(f['提交时间'] || f['日期'], null);
          return d && inDateRangeInclusive(d, period.start, period.end);
        });
        if (!inRange.length) {
          return `${period.label}收档报告（${targetStore}）：0条记录。该时间段暂无收档报告入库。`;
        }
        const scores = inRange.map(f => {
          const s = extractBitableFieldText(f['档口收档平均得分']);
          return parseFloat(s);
        }).filter(n => !isNaN(n));
        const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '无';
        const passCount = inRange.filter(f => /合格|通过|是/.test(extractBitableFieldText(f['是否合格']))).length;
        const passRate = inRange.length ? ((passCount / inRange.length) * 100).toFixed(0) + '%' : '无';
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

  }

  async function buildBiDeterministicOpeningReportReply(store, text) {

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
        const all = (r.rows || []).map(row => row.fields && typeof row.fields === 'object' ? row.fields : {});
        const matched = all.filter(f => {
          const s = String(f['门店'] || f['所属门店'] || '').trim();
          return isLikelySameStore(s, targetStore);
        });
        const inRange = matched.filter(f => {
          const d = normalizeBitableDateValue(f['记录日期'] || f['提交时间'] || f['日期'], null);
          return d && inDateRangeInclusive(d, period.start, period.end);
        });
        if (!inRange.length) {
          return `${period.label}开档报告（${targetStore}）：0条记录。该时间段暂无开档报告入库。`;
        }
        const stationTop = new Map();
        inRange.forEach(f => {
          const station = extractBitableFieldText(f['岗位'] || f['档口']);
          if (station) stationTop.set(station, (stationTop.get(station) || 0) + 1);
        });
        const stationText = Array.from(stationTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join('、') || '无';
        const mealTop = new Map();
        inRange.forEach(f => {
          const meal = extractBitableFieldText(f['饭市']);
          if (meal) mealTop.set(meal, (mealTop.get(meal) || 0) + 1);
        });
        const mealText = Array.from(mealTop.entries()).map(([k, v]) => `${k}(${v})`).join('、') || '无';
        return [`${period.label}开档报告（${targetStore}）`, `- 开档记录：${inRange.length}条`, `- 岗位分布：${stationText}`, `- 饭市分布：${mealText}`].join('\n');
      } catch (e) {
        return `开档报告查询失败：${e?.message || '未知错误'}`;
      }

  }

  async function buildBiDeterministicMaterialReportReply(store, text) {

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
        const all = (r.rows || []).map(row => row.fields && typeof row.fields === 'object' ? row.fields : {});
        const matched = all.filter(f => {
          const s = String(f['所属门店'] || f['门店'] || '').trim();
          return isLikelySameStore(s, targetStore);
        });
        const inRange = matched.filter(f => {
          const d = normalizeBitableDateValue(f['收货日期'] || f['日期'], null);
          return d && inDateRangeInclusive(d, period.start, period.end);
        });
        if (!inRange.length) {
          return `${period.label}原料收货日报（${targetStore}）：0条记录。该时间段暂无原料异常数据入库。`;
        }
        const hasIssue = inRange.filter(f => {
          const feedback = extractBitableFieldText(f['今日异常反馈'] || f['今天原料情况']);
          return feedback && !/正常|无|没有/.test(feedback);
        });
        const materialTop = new Map();
        hasIssue.forEach(f => {
          const name = extractBitableFieldText(f['异常原料名称']);
          if (name) materialTop.set(name, (materialTop.get(name) || 0) + 1);
        });
        const matText = Array.from(materialTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v}次)`).join('、') || '无';
        const severityTop = new Map();
        hasIssue.forEach(f => {
          const sev = extractBitableFieldText(f['严重情况']);
          if (sev) severityTop.set(sev, (severityTop.get(sev) || 0) + 1);
        });
        const sevText = Array.from(severityTop.entries()).map(([k, v]) => `${k}(${v})`).join('、') || '无';
        const lines = [
          `${period.label}原料收货日报（${targetStore}）`,
          `- 收货记录：${inRange.length}条`,
          `- 异常记录：${hasIssue.length}条`,
          `- 异常原料Top：${matText}`,
          `- 严重程度：${sevText}`
        ];
        return lines.join('\n');
      } catch (e) {
        return `原料收货日报查询失败：${e?.message || '未知错误'}`;
      }

  }

  async function buildBiDeterministicMeetingReportReply(store, text) {

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
        const rows = (r.rows || []).filter(row => {
          const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
          const rowStore = extractBitableFieldText(f['所属门店'] || f['门店']);
          if (!isLikelySameStore(rowStore, targetStore)) return false;
          const d = normalizeBitableDateValue(f['记录日期'] || f['提交时间'] || f['日期'] || f['例会日期'], row?.created_at);
          return d && inDateRangeInclusive(d, period.start, period.end);
        });
        if (!rows.length) return `📊 ${period.label}例会数据（${targetStore}）：暂无例会记录入库。`;
        const scores = rows.map(row => {
          const f = row.fields || {};
          let v = parseFloat(extractBitableFieldText(f['得分']));
          if (isNaN(v)) {
            const qualText = String(f['是否合格的例会'] || '');
            const m = qualText.match(/(\d+(?:\.\d+)?)\s*分/);
            if (m) v = parseFloat(m[1]);
          }
          return v;
        }).filter(n => !isNaN(n));
        const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '-';
        const qualRows = rows.filter(row => {
          const qt = String(row.fields?.['是否合格的例会'] || '');
          return qt.includes('合格') && !qt.includes('不合格');
        });
        const qualRate = rows.length > 0 ? `${qualRows.length}/${rows.length}次合格` : null;
        const hosts = new Map();
        rows.forEach(row => {
          const h = extractBitableFieldText(row.fields['主持人']);
          if (h) hosts.set(h, (hosts.get(h) || 0) + 1);
        });
        const absentees = new Map();
        rows.forEach(row => {
          const abs = extractBitableFieldText(row.fields['缺席人员姓名']);
          if (abs && abs !== '无') abs.split(/[,，、]/).forEach(n => { n = n.trim(); if (n) absentees.set(n, (absentees.get(n) || 0) + 1); });
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

  }

  async function buildBiDeterministicLossReportReply(store, text) {

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
        const rows = (r.rows || []).filter(row => {
          const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
          const rowStore = extractBitableFieldText(f['所属门店'] || f['门店'] || f['报损门店']);
          if (rowStore && !isLikelySameStore(rowStore, targetStore)) return false;
          const d = normalizeBitableDateValue(f['日期'] || f['创建日期'] || f['报损日期'] || f['提交时间'], row?.created_at);
          return d && inDateRangeInclusive(d, period.start, period.end);
        });
        if (!rows.length) return `📊 ${period.label}报损数据（${targetStore}）：暂无报损记录入库。`;
        const itemTop = new Map();
        let totalAmount = 0;
        rows.forEach(row => {
          const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
          const item = extractBitableFieldText(f['报损菜品'] || f['报损品名'] || f['品名'] || f['物品名称'] || f['报损物品']);
          const amount = parseFloat(extractBitableFieldText(f['报损金额'] || f['金额'] || f['损失金额'] || f['报损数量'])) || 0;
          if (item) itemTop.set(item, (itemTop.get(item) || 0) + 1);
          totalAmount += amount;
        });
        // 汇总报损原因
        const reasonTop = new Map();
        rows.forEach(row => {
          const f = row.fields && typeof row.fields === 'object' ? row.fields : {};
          const reason = extractBitableFieldText(f['报损原因'] || f['原因']);
          if (reason) reasonTop.set(reason, (reasonTop.get(reason) || 0) + 1);
        });
        const lines = [`📊 报损数据（${targetStore}·${period.label}）`];
        lines.push(`- 报损记录：${rows.length}条`);
        if (totalAmount > 0) lines.push(`- 报损总额：¥${totalAmount.toFixed(2)}`);
        if (itemTop.size) lines.push(`- 报损菜品Top：${Array.from(itemTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
        if (reasonTop.size) lines.push(`- 报损原因：${Array.from(reasonTop.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v}次)`).join('、')}`);
        // 最近5条明细
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

  }

  return {
    buildBiDeterministicDataSourceCoverageReply,
    buildBiDeterministicTableVisitReply,
    buildBiDeterministicOpsReportCountReply,
    buildBiDeterministicClosingReportReply,
    buildBiDeterministicOpeningReportReply,
    buildBiDeterministicMaterialReportReply,
    buildBiDeterministicMeetingReportReply,
    buildBiDeterministicLossReportReply,
  };
}
