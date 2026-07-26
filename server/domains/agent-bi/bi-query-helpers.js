/**
 * BI date-range / fact-source / grounding pure+I/O helpers (P2 peel from agents.js).
 */

export function resolveDateRangeFromQuestion(text, dd = 7, formatDate) {
  const q = String(text || '').trim();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ms = 86400000;
  const makeMonthRange = (year, month) => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    return { start: formatDate(first), end: formatDate(last) };
  };

  const monthRange = q.match(
    /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(?:到|至|~|～|-|—)\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/
  );
  if (monthRange) {
    let sy = parseInt(monthRange[1] || String(now.getFullYear()), 10);
    const sm = parseInt(monthRange[2], 10);
    let ey = parseInt(monthRange[3] || String(sy), 10);
    const em = parseInt(monthRange[4], 10);
    if (!monthRange[3] && em < sm) ey += 1;
    const s = makeMonthRange(sy, sm);
    const e = makeMonthRange(ey, em);
    if (s && e) return { label: `${sy}年${sm}月-${ey}年${em}月`, start: s.start, end: e.end };
  }

  const dualMonth = q.match(
    /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月[^0-9]{0,8}(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/
  );
  if (dualMonth) {
    let sy = parseInt(dualMonth[1] || String(now.getFullYear()), 10);
    const sm = parseInt(dualMonth[2], 10);
    let ey = parseInt(dualMonth[3] || String(sy), 10);
    const em = parseInt(dualMonth[4], 10);
    if (sm !== em) {
      if (!dualMonth[3] && em < sm) ey += 1;
      const s = makeMonthRange(sy, sm);
      const e = makeMonthRange(ey, em);
      if (s && e) return { label: `${sy}年${sm}月-${ey}年${em}月`, start: s.start, end: e.end };
    }
  }

  const singleMonth = q.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/);
  if (singleMonth && !/上[个]?月|本月/.test(q)) {
    const year = parseInt(singleMonth[1] || String(now.getFullYear()), 10);
    const month = parseInt(singleMonth[2], 10);
    const m = makeMonthRange(year, month);
    if (m) return { label: `${year}年${month}月`, start: m.start, end: m.end };
  }

  if (/今[天日]/.test(q)) return { label: '今日', start: formatDate(today), end: formatDate(today) };
  if (/昨[天日]/.test(q)) {
    const y = new Date(today - ms);
    return { label: '昨日', start: formatDate(y), end: formatDate(y) };
  }
  if (/前[天日]/.test(q)) {
    const d = new Date(today - 2 * ms);
    return { label: '前天', start: formatDate(d), end: formatDate(d) };
  }
  if (/上周/.test(q)) {
    const dow = today.getDay() || 7;
    const m = new Date(today - (dow + 6) * ms);
    return { label: '上周', start: formatDate(m), end: formatDate(new Date(+m + 6 * ms)) };
  }
  if (/本周/.test(q)) {
    const dow = today.getDay() || 7;
    return { label: '本周', start: formatDate(new Date(today - (dow - 1) * ms)), end: formatDate(today) };
  }
  if (/上[个]?月/.test(q)) {
    const f = new Date(now.getFullYear(), now.getMonth(), 1);
    const l = new Date(f - ms);
    const s = new Date(l.getFullYear(), l.getMonth(), 1);
    return { label: '上月', start: formatDate(s), end: formatDate(l) };
  }
  if (/本月/.test(q)) {
    return {
      label: '本月',
      start: formatDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: formatDate(today),
    };
  }
  const nm = q.match(/近\s*(\d+)\s*天/);
  if (nm) {
    const n = parseInt(nm[1], 10) || dd;
    return { label: `近${n}天`, start: formatDate(new Date(today - (n - 1) * ms)), end: formatDate(today) };
  }
  return {
    label: `近${dd}天`,
    start: formatDate(new Date(today - (dd - 1) * ms)),
    end: formatDate(today),
  };
}

export function isFactLikeQuestion(text) {
  const q = String(text || '').trim();
  if (!q) return false;
  const hasFactTopic =
    /(营业额|营收|生意|经营情况|差评|桌访|开档|收档|例会|原料|kpi|考核指标|评分|门店|菜品|员工|姓名)/i.test(q);
  const hasQuestionPattern = /(多少|怎么样|如何|情况|对比|趋势|排名|top|为什么|分析|异常|有没有)/i.test(q);
  return hasFactTopic && hasQuestionPattern;
}

export function resolveBiRelevantSourceKeys(text) {
  const q = String(text || '').trim();
  const keys = new Set();
  if (/(桌访|桌巡|巡台|巡桌|不满意.*菜|菜品.*不满意|最不满意|出品.*不满意)/.test(q)) {
    keys.add('table_visit_records');
    keys.add('table_visit_bitable');
  }
  if (/(差评|点评|评论|客诉)/.test(q)) {
    keys.add('bad_reviews');
  }
  if (/(开档|开市)/.test(q)) {
    keys.add('opening_reports_bitable');
  }
  if (/(收档|收市|闭市)/.test(q)) {
    keys.add('closing_reports_bitable');
  }
  if (/(例会|会议)/.test(q)) {
    keys.add('meeting_reports_bitable');
  }
  if (/(原料|收货)/.test(q)) {
    keys.add('material_majixian_bitable');
    keys.add('material_hongchao_bitable');
  }
  if (/(营业额|营收|收入|对账|毛利|损耗|成本|人效|KPI|kpi)/.test(q)) {
    keys.add('daily_reports');
  }
  if (/(堂食|外卖|销售明细|时段.*销|午市|晚市|热销|畅销|备货|菜品.*销量|点单)/.test(q)) {
    keys.add('pos_sales_detail');
    keys.add('inventory_forecast');
  }
  if (keys.size === 0 && isFactLikeQuestion(q)) {
    keys.add('daily_reports');
    keys.add('table_visit_records');
    keys.add('bad_reviews');
  }
  return Array.from(keys);
}

export function buildBiSourceAuditText(auditRows = []) {
  if (!Array.isArray(auditRows) || auditRows.length === 0) return '';
  const lines = auditRows.map((x) => {
    const statusText =
      x.status === 'ok'
        ? '可用'
        : x.status === 'empty'
          ? '空样本'
          : x.status === 'disabled'
            ? '已禁用'
            : '查询失败';
    return `- ${x.label}：${statusText}（count=${Number(x.count || 0)}, latest=${x.latest || '-'})`;
  });
  return lines.join('\n');
}

export async function buildBiFactSourceAuditBody(deps, store, text) {
  const { pool, normalizeStoreLike, normalizeStoreKey, isBiSourceEnabled } = deps;
  const keyDefs = {
    table_visit_records: {
      label: '桌访记录（系统入库）',
      sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM table_visit_records WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1`,
      params: [normalizeStoreLike(store)],
    },
    table_visit_bitable: {
      label: '桌访表（飞书）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='table_visit' AND lower(regexp_replace(coalesce(agent_data->>'store', agent_data#>>'{fields,store}', ''), '\\s+', '', 'g')) = $1`,
      params: [normalizeStoreKey(store)],
    },
    bad_reviews: {
      label: '差评报告（同步）',
      sql: `SELECT COUNT(*)::int AS c, MAX(created_at)::text AS latest
            FROM agent_messages
            WHERE content_type='negative_review'
              AND lower(regexp_replace(coalesce(
                agent_data->>'store',
                agent_data#>>'{fields,store}',
                agent_data#>>'{fields,所属门店}',
                agent_data#>>'{fields,门店}',
                agent_data#>>'{fields,差评门店}',
                ''
              ), '\\s+', '', 'g')) LIKE $1`,
      params: [normalizeStoreLike(store)],
    },
    opening_reports_bitable: {
      label: '开档报告（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='opening_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1`,
      params: [normalizeStoreKey(store)],
    },
    closing_reports_bitable: {
      label: '收档报告（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='closing_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1`,
      params: [normalizeStoreKey(store)],
    },
    meeting_reports_bitable: {
      label: '例会报告（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='meeting_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1`,
      params: [normalizeStoreKey(store)],
    },
    material_majixian_bitable: {
      label: '马己仙原料收货（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='material_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1 AND lower(coalesce(agent_data->>'brand','')) LIKE '%maji%'`,
      params: [normalizeStoreKey(store)],
    },
    material_hongchao_bitable: {
      label: '洪潮原料收货（同步）',
      sql: `SELECT COUNT(DISTINCT record_id)::int AS c, MAX(created_at)::text AS latest FROM agent_messages WHERE content_type='material_report' AND lower(regexp_replace(coalesce(agent_data#>>'{fields,store}', agent_data->>'store', ''), '\\s+', '', 'g')) = $1 AND lower(coalesce(agent_data->>'brand','')) LIKE '%hong%'`,
      params: [normalizeStoreKey(store)],
    },
    daily_reports: {
      label: '营业日报（系统）',
      sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM daily_reports WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1`,
      params: [normalizeStoreLike(store)],
    },
    pos_sales_detail: {
      label: '销售明细（pos_sales_detail）',
      sql: `SELECT COUNT(*)::int AS c, MAX(date)::text AS latest FROM pos_sales_detail WHERE lower(regexp_replace(coalesce(store,''), '\\s+', '', 'g')) LIKE $1`,
      params: [normalizeStoreLike(store)],
    },
  };

  const relevant = resolveBiRelevantSourceKeys(text);
  const rows = [];
  for (const key of relevant) {
    const def = keyDefs[key];
    if (!def) continue;
    if (!isBiSourceEnabled(key)) {
      rows.push({ key, label: def.label, status: 'disabled', count: 0, latest: '-' });
      continue;
    }
    try {
      const r = await pool().query(def.sql, def.params);
      const c = Number(r.rows?.[0]?.c || 0);
      const latest = String(r.rows?.[0]?.latest || '').trim() || '-';
      rows.push({ key, label: def.label, status: c > 0 ? 'ok' : 'empty', count: c, latest });
    } catch {
      rows.push({ key, label: def.label, status: 'error', count: 0, latest: '-' });
    }
  }
  return rows;
}

export async function buildBiGroundingFactsBody(deps, store, text) {
  const {
    pool,
    toDateOnly,
    formatDate,
    extractBitableFieldText,
    normalizeBitableDateValue,
    isLikelySameStore,
    inDateRangeInclusive,
    loadUnifiedTableVisitRowsByStore,
    extractTableVisitItems,
  } = deps;

  const q = String(text || '').trim();
  const targetStore = String(store || '').trim();
  if (!targetStore) return '';
  const askReviewLike = /(差评|点评|评论|桌访|产品问题|反馈|口味|出品|上菜|服务)/.test(q);
  if (!askReviewLike) return '';
  const sections = [];

  try {
    const since30 = toDateOnly(new Date(Date.now() - 29 * 86400000).toISOString());
    const today = toDateOnly(new Date().toISOString());
    const r = await pool().query(
      `SELECT agent_data, created_at
       FROM agent_messages
       WHERE content_type = 'negative_review'
       ORDER BY created_at DESC
       LIMIT 3000`
    );
    const rows = (Array.isArray(r.rows) ? r.rows : [])
      .map((row) => {
        const data = row?.agent_data && typeof row.agent_data === 'object' ? row.agent_data : {};
        const f = data?.fields && typeof data.fields === 'object' ? data.fields : {};
        const rowStore = extractBitableFieldText(
          data.store || f.store || f['所属门店'] || f['门店'] || f['差评门店']
        );
        const date = normalizeBitableDateValue(
          data.date || f['差评日期'] || f['创建日期'] || f['日期'] || f['评价日期'],
          row?.created_at
        );
        const product = extractBitableFieldText(
          data.product || data.product_name || f['差评产品'] || f['菜品'] || f['产品']
        );
        const service = extractBitableFieldText(data.service_item || f['服务项'] || f['服务问题']);
        const content = extractBitableFieldText(
          data.reason || data.content || f['差评原因'] || f['内容'] || f['描述']
        );
        return { date, rowStore, product_name: product, service_item: service, content };
      })
      .filter((x) => isLikelySameStore(x.rowStore, targetStore) && inDateRangeInclusive(x.date, since30, today));

    const recent7 = rows.filter((x) => {
      const d = toDateOnly(x?.date);
      if (!d) return false;
      return d >= toDateOnly(formatDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)));
    });

    if (!rows.length) {
      sections.push('【差评数据】近30天该门店无差评样本。');
    } else {
      const productTop = new Map();
      const serviceTop = new Map();
      rows.forEach((x) => {
        const p = String(x?.product_name || '').trim();
        const s = String(x?.service_item || '').trim();
        if (p) productTop.set(p, (productTop.get(p) || 0) + 1);
        if (s) serviceTop.set(s, (serviceTop.get(s) || 0) + 1);
      });
      const topN = (m) =>
        Array.from(m.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, v]) => `${k}(${v})`)
          .join('、') || '无';
      const samples = rows
        .slice(0, 3)
        .map((x) => `- ${toDateOnly(x.date) || '-'}：${String(x.content || '').replace(/\s+/g, ' ').slice(0, 60)}`)
        .join('\n');
      sections.push(
        `【差评数据】近7天${recent7.length}条，近30天${rows.length}条；产品Top：${topN(productTop)}；服务Top：${topN(serviceTop)}。\n最近样例：\n${samples}`
      );
    }
  } catch {
    sections.push('【差评数据】查询失败或数据表不可用。');
  }

  try {
    const end = toDateOnly(new Date().toISOString());
    const start = toDateOnly(new Date(Date.now() - 29 * 86400000).toISOString());
    const rows = await loadUnifiedTableVisitRowsByStore(targetStore, start, end);
    if (!rows.length) {
      sections.push('【桌访数据】近30天无桌访不满意菜品样本。');
    } else {
      const itemTop = new Map();
      rows.forEach((x) => {
        extractTableVisitItems(x).forEach((k) => {
          itemTop.set(k, (itemTop.get(k) || 0) + 1);
        });
      });
      const top =
        Array.from(itemTop.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([k, v]) => `${k}(${v})`)
          .join('、') || '无';
      sections.push(`【桌访数据】近30天样本${rows.length}条；不满意项Top：${top}`);
    }
  } catch {
    sections.push('【桌访数据】查询失败或数据表不可用。');
  }

  return sections.join('\n');
}

/**
 * @param {object} deps
 */
export function createBiQueryHelpersApi(deps) {
  const { formatDate } = deps;
  return {
    resolveDateRangeFromQuestion: (text, dd = 7) => resolveDateRangeFromQuestion(text, dd, formatDate),
    isFactLikeQuestion,
    resolveBiRelevantSourceKeys,
    buildBiSourceAuditText,
    buildBiFactSourceAudit: (store, text) => buildBiFactSourceAuditBody(deps, store, text),
    buildBiGroundingFacts: (store, text) => buildBiGroundingFactsBody(deps, store, text),
  };
}
