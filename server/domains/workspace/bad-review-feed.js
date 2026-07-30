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
import { expandAgentStoreLabels } from '../../v2-store-alignment.js';

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
 *
 * 2026-07-30 修复：马己仙出品经理反馈差评展示"没有任何数据"（不是全部门店的问题——那个已经
 * 修过了，这次是单店范围内也是空的）。查证发现 agent_messages 里飞书写入的门店名是缩写
 * （"洪潮久光店"/"马己仙大宁店"），跟 employees.store 的官方全称（"洪潮大宁久光店"/
 * "马己仙上海音乐广场店"）不是同一个字符串——store/storeFilter 传的是员工表全称，之前
 * 精确匹配 `= $n` 在有门店范围限制时必然查不到行（只有 admin 不传限制时才因为没有WHERE
 * 过滤侥幸能看到数据）。改用 expandAgentStoreLabels()（v2-store-alignment.js，全系统已有的
 * 门店名/飞书别名双向映射，store_name_aliases表驱动）把每个门店名展开成所有已知别名，
 * 再用 ANY() 匹配，不再要求字符串完全相等。
 */
export async function getBadReviewFeed(pool, tenantId, { store = '', startDate = '', endDate = '', limit = 30, storeFilter = [] } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const scoped = Array.isArray(storeFilter) && storeFilter.length > 0;
  const effectiveStore = store && (!scoped || storeFilter.includes(store)) ? store : '';
  const storeAliasList = effectiveStore
    ? expandAgentStoreLabels(effectiveStore)
    : (scoped ? [...new Set(storeFilter.flatMap((s) => expandAgentStoreLabels(s)))] : []);
  const hasStoreFilter = storeAliasList.length > 0;
  try {
    const platformParams = [tenantId];
    let platformWhere = '';
    if (hasStoreFilter) { platformParams.push(storeAliasList); platformWhere += ` AND agent_data->'fields'->>'store' = ANY($${platformParams.length})`; }
    if (startDate) { platformParams.push(startDate); platformWhere += ` AND ${DATE_EXPR} >= $${platformParams.length}`; }
    if (endDate) { platformParams.push(endDate); platformWhere += ` AND ${DATE_EXPR} <= $${platformParams.length}`; }

    const visitParams = [tenantId];
    let visitWhere = '';
    if (hasStoreFilter) { visitParams.push(storeAliasList); visitWhere += ` AND agent_data->'fields'->>'store' = ANY($${visitParams.length})`; }
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

    // 2026-07-30 修复：用户反馈"差评展示是否100%导入了"——查证发现平台差评(大众点评/美团/
    // 饿了吗)和桌访记录各自查了lim条后合并，再统一按日期截断到lim条。桌访记录量远大于平台
    // 差评（近30天桌访可达数百条，平台差评往往仅个位数到十几条），合并截断后近期桌访记录会
    // 把平台差评整体挤出列表，造成"看起来没有差评"的假象——不是数据没导入，是被截断挤掉了。
    // 改成：平台差评全部保留（不占用visitItems的名额），剩余名额留给桌访记录。
    const visitBudget = Math.max(0, lim - platformItems.length);
    return [...platformItems, ...visitItems.slice(0, visitBudget)]
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (e) {
    log.error({ msg: 'bad_review_feed_failed', err: e?.message || String(e) });
    return [];
  }
}
