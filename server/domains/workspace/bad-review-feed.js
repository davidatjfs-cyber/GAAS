/**
 * 差评展示（首页第9项，用户中途加的）。
 *
 * 2026-07-29 重做：之前查的是 bad_reviews / table_visit_records 两张表，实测发现
 * bad_reviews 表本身是空的（0行，可能是早期设计后从未接上真实写入路径的遗留表），
 * table_visit_records 最新一条卡在 2026-06-24（核查发现原因：server/domains/feishu-bitable/
 * process-bitable-data-helpers.js 的 processTableVisitData 写 table_visit_records 前先写
 * agent_messages，那条写入语句在6月因 agent_messages 表短暂开启过 RLS 而报错(`new row
 * violates row-level security policy`)，同一个 try 块里后面"写入结构化表"的语句因此从未
 * 执行到；而且 GAAS 自己这条轮询链路(start-bitable-polling*.js)的配置列表里根本没有
 * 'table_visit' 这个 configKey，说明这条链路早就没有真正在跑，table_visit_records 事实上
 * 已经是孤儿表——真正持续在同步的是 agents-service-v2 那边的 Feishu 轮询，数据落在
 * agent_messages(content_type='bad_review'/'table_visit')，这两张实测都是分钟级新鲜。
 * 这里改成直接读 agent_messages，不再依赖两张事实上没有实时写入的表。
 */
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'workspace', handler: 'bad-review-feed' });

/** agent_data.fields.date 存的是飞书原始时间戳（epoch毫秒的字符串），转成 YYYY-MM-DD 供比较/展示。 */
const DATE_EXPR = `to_char(to_timestamp((agent_data->'fields'->>'date')::bigint / 1000), 'YYYY-MM-DD')`;
const DATE_GUARD = `(agent_data->'fields'->>'date') ~ '^[0-9]+$'`;

/**
 * 2026-07-30 修复：马己仙出品经理反馈能在差评展示里看到所有门店的差评——查证发现这里
 * 之前只接受前端传的 store 单店筛选（可选、可以不传），完全没有服务端强制的权限范围，
 * 谁都能不传store或者改传别的店名看到全部/别店数据。加 storeFilter（调用方按角色算出的
 * "允许查看的门店范围"，admin/老板传空数组=不限；其它角色传自己范围内的门店列表）——
 * store 这个UI下拉筛选如果超出 storeFilter 范围会被忽略，不传时默认收窄到 storeFilter。
 */
export async function getBadReviewFeed(pool, tenantId, { store = '', startDate = '', endDate = '', limit = 30, storeFilter = [] } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const scoped = Array.isArray(storeFilter) && storeFilter.length > 0;
  const effectiveStore = store && (!scoped || storeFilter.includes(store)) ? store : '';
  try {
    const platformParams = [tenantId];
    let platformWhere = '';
    if (effectiveStore) { platformParams.push(effectiveStore); platformWhere += ` AND agent_data->'fields'->>'store' = $${platformParams.length}`; }
    else if (scoped) { platformParams.push(storeFilter); platformWhere += ` AND agent_data->'fields'->>'store' = ANY($${platformParams.length})`; }
    if (startDate) { platformParams.push(startDate); platformWhere += ` AND ${DATE_EXPR} >= $${platformParams.length}`; }
    if (endDate) { platformParams.push(endDate); platformWhere += ` AND ${DATE_EXPR} <= $${platformParams.length}`; }

    const visitParams = [tenantId];
    let visitWhere = '';
    if (effectiveStore) { visitParams.push(effectiveStore); visitWhere += ` AND agent_data->'fields'->>'store' = $${visitParams.length}`; }
    else if (scoped) { visitParams.push(storeFilter); visitWhere += ` AND agent_data->'fields'->>'store' = ANY($${visitParams.length})`; }
    if (startDate) { visitParams.push(startDate); visitWhere += ` AND ${DATE_EXPR} >= $${visitParams.length}`; }
    if (endDate) { visitParams.push(endDate); visitWhere += ` AND ${DATE_EXPR} <= $${visitParams.length}`; }

    const [platformR, visitR] = await Promise.all([
      pool.query(
        `SELECT agent_data->'fields'->>'store' AS store, ${DATE_EXPR} AS date,
                agent_data->'fields'->>'content' AS content,
                agent_data->'fields'->>'platform' AS platform,
                agent_data->'fields'->>'rating' AS rating
           FROM agent_messages
          WHERE tenant_id = $1 AND content_type = 'bad_review' AND ${DATE_GUARD}${platformWhere}
          ORDER BY ${DATE_EXPR} DESC LIMIT ${lim}`,
        platformParams
      ),
      pool.query(
        `SELECT agent_data->'fields'->>'store' AS store, ${DATE_EXPR} AS date,
                agent_data->'fields'->>'product_issue' AS product_issue,
                agent_data->'fields'->>'service_issue' AS service_issue,
                agent_data->'fields'->>'unsat_reason' AS unsat_reason,
                agent_data->'fields'->>'satisfaction' AS satisfaction
           FROM agent_messages
          WHERE tenant_id = $1 AND content_type = 'table_visit' AND ${DATE_GUARD}
            AND (
              COALESCE(agent_data->'fields'->>'product_issue','') <> ''
              OR COALESCE(agent_data->'fields'->>'service_issue','') <> ''
              OR COALESCE(agent_data->'fields'->>'unsat_reason','') <> ''
              OR (agent_data->'fields'->>'satisfaction') NOT IN ('满意', '')
            )${visitWhere}
          ORDER BY ${DATE_EXPR} DESC LIMIT ${lim}`,
        visitParams
      ),
    ]);

    const platformItems = (platformR.rows || []).map((row) => ({
      store: row.store,
      date: row.date,
      time: null,
      content: row.content,
      source: '平台差评' + (row.platform ? '·' + row.platform : ''),
      rating: row.rating,
    }));
    const visitItems = (visitR.rows || []).map((row) => ({
      store: row.store,
      date: row.date,
      time: null,
      content: [row.product_issue, row.service_issue, row.unsat_reason].filter(Boolean).join('；') || row.satisfaction,
      source: '桌访记录',
      rating: null,
    }));

    return [...platformItems, ...visitItems]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, lim);
  } catch (e) {
    log.error({ msg: 'bad_review_feed_failed', err: e?.message || String(e) });
    return [];
  }
}
