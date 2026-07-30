/**
 * 角色工作台聚合层：只读组装现有表/接口的数据，不新建业务逻辑，不写共享表 schema。
 * promoteDishToStores 是唯一的写路径——本质是把「批量推广菜品」拆成给各店出品经理各建一条
 * master_tasks（已有表、已有状态机），不是新领域对象。
 */
import { childLogger } from '../../utils/logger.js';
import { pickAssigneeForCategory } from '../master-agent/resolve-assignee.js';

const log = childLogger({ domain: 'workspace', handler: 'service' });

let _taskSeq = 0;
function generateTaskId(now = new Date()) {
  const ds = now.toISOString().slice(0, 10).replace(/-/g, '');
  _taskSeq += 1;
  return `WS-${ds}-${String(_taskSeq).padStart(4, '0')}`;
}

export async function getOpenTaskSummaryByStore(pool, tenantId) {
  const r = await pool.query(
    `SELECT store,
            COUNT(*) FILTER (WHERE status NOT IN ('resolved','pending_settlement','settled','closed','rejected')) AS open_count,
            COUNT(*) FILTER (WHERE severity = 'high' AND status NOT IN ('resolved','pending_settlement','settled','closed','rejected')) AS high_count
       FROM master_tasks
      WHERE tenant_id = $1 AND store IS NOT NULL AND store <> ''
      GROUP BY store
      ORDER BY high_count DESC, open_count DESC`,
    [tenantId]
  );
  return r.rows || [];
}

/**
 * 门店红绿灯：直接复用已有的 store_ratings 评级（server/domains/store-scoring/store-rating.js
 * 的 calculateStoreRating() 已经在跑，每月按「营收达成率」评 A/B/C/D，不是这里新造的规则）。
 * 映射（已跟业务方确认）：A/B → 绿，C → 黄，D 或从未评级过 → 红。
 * 这只是营收单一维度，不含差评/人效/任务——门店有开放任务不代表红灯，红灯只看营收达成率。
 *
 * 门店全集 = store_ratings 里出现过的店 ∪ master_tasks 里出现过的店（后者覆盖"有任务但还没
 * 被评过级"的新店/数据不全的店，这些店按规则应该显示红——「无评级→红」）。
 *
 * 2026-07-28 用户明确要求「显示上个月ABCD门店」——严格锁定上一个自然月，不是"最新一期"
 * （之前那版如果本月的评级已经算出来了会显示本月，这次改成固定显示上月）。
 */
// 2026-07-29 修复：之前用 master_tasks 里出现过的 store 字段做门店全集，结果一堆自动化任务
// （growth_monitor/proactive_llm 等）的 store 字段本身就是脏数据（"巡检触发3条"/"看看"/
// "数据报表里有哪些"这种自由文本，不是真门店名），全都混进了门店红绿灯/六大神器/餐饮总监的
// 门店下拉框里。改成用真实门店台账（hrms_state.data.stores，/api/stores 用的同一个数据源）
// 做门店全集，master_tasks 只用来读评级，不再贡献"门店名单"。
export async function getStoreHealthLights(pool, tenantId) {
  const now = new Date();
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthPeriod = `${lastMonthDate.getUTCFullYear()}-${String(lastMonthDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const [ratedRows, stateRow] = await Promise.all([
    pool.query(
      `SELECT store, rating, achievement_rate, period
         FROM store_ratings
        WHERE tenant_id = $1 AND store IS NOT NULL AND store <> '' AND period = $2`,
      [tenantId, lastMonthPeriod]
    ),
    pool.query(`select data from hrms_state where key = $1 limit 1`, [tenantId]),
  ]);
  const ratingByStore = new Map((ratedRows.rows || []).map((r) => [r.store, r]));
  const realStores = Array.isArray(stateRow.rows?.[0]?.data?.stores)
    ? stateRow.rows[0].data.stores.map((s) => String(s?.name || '').trim()).filter(Boolean)
    : [];
  const allStores = new Set([...ratingByStore.keys(), ...realStores]);
  return [...allStores].map((store) => {
    const rated = ratingByStore.get(store) || null;
    const rating = rated?.rating || null;
    const light = rating === 'A' || rating === 'B' ? 'green' : rating === 'C' ? 'yellow' : 'red';
    return {
      store,
      rating,
      achievement_rate: rated?.achievement_rate ?? null,
      period: rated?.period || null,
      light,
    };
  });
}

// 2026-07-29 修复：之前"任务"栏不限制来源，把 master_tasks 里所有开放行都当"任务"显示——
// 实测里混进了 growth_monitor(营销优惠券核销率)/data_auditor(充值异常等BI审计)/proactive_llm
// 等大量跟"任务"完全无关的自动化记录（growth_monitor 一项就有266条）。用户明确要求"任务"
// 只能是这5类：agent定时任务/agent抽查任务/Agent任务指挥中心/经营诊断下发的任务(走
// growth_solution_tasks，另一张表，已经在wsFetchGrowthSolutionTasks单独处理)/食安异常。
// 用真实的 source/category 分布查出来后按下面这个白名单过滤：
//   rhythm_engine        → agent定时任务(weekly_report/monthly_evaluation)
//   random_inspection     → agent抽查任务(源名本身就是"随机抽查")
//   scheduled_inspection  → 目前归到"抽查任务"这类——命名是"定时巡检"，但语义更接近门店
//     巡查而不是周期报表，跟 rhythm_engine 明显是两回事；这个分类边界不是100%确定，
//     如果实际应该算"定时任务"需要用户确认再调整。
//   hrms_task_board       → Agent任务指挥中心模块（source名直接对应"任务看板"）
//   category含food_safety/food_quality → 食安异常触发（不分source，因为食安类目分散在
//     bi_anomaly/anomaly_engine/hrms_task_board 好几个source下面）
const WS_ALLOWED_TASK_SOURCES = ['rhythm_engine', 'random_inspection', 'scheduled_inspection', 'hrms_task_board'];
const WS_TASK_SOURCE_FILTER_SQL = `AND (source = ANY($SRC_IDX) OR category ILIKE '%food_safety%' OR category ILIKE '%food_quality%')`;

export async function getMyOpenTasks(pool, tenantId, username, limit = 20) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  const r = await pool.query(
    `SELECT task_id, title, detail, severity, store, status, category, source, created_at
       FROM master_tasks
      WHERE tenant_id = $1 AND assignee_username = $2
        AND status NOT IN ('resolved','pending_settlement','settled','closed','rejected')
        ${WS_TASK_SOURCE_FILTER_SQL.replace('$SRC_IDX', '$4')}
      ORDER BY created_at DESC LIMIT $3`,
    [tenantId, username, lim, WS_ALLOWED_TASK_SOURCES]
  );
  return r.rows || [];
}

// 2026-07-30 修复：业务方明确确认任务路由规则——除食品安全类需要抄送总部经理+管理员，
// 其余全部只发给当事人(assignee_username)。之前这里是"全租户范围、不管是谁的任务全都给
// 管理员/老板看"，导致 admin/hq_manager/store_manager/出品经理登录后看到完全一样的
// rhythm_engine 周报、random_inspection 抽查等任务列表——这些任务本该只有各自的责任人
// 能看到。现在收窄到只有"食品安全"这一类会被 cc 给总部经理/管理员看（category含
// food_safety/food_quality），其余任务类型不再broadcast给非责任人，getWorkspaceHome()
// 只对admin/hq_manager角色额外拼这份"食安cc视图"，其他角色只看 getMyOpenTasks()。
const WS_FOOD_SAFETY_CC_ROLES = ['admin', 'hq_manager'];

// 2026-07-30 追加：业务方确认"本周/本月运营周报"要保留，且需要抄送总部经理/管理员。
// 已核实这份周报本身只是聚合展示——它汇总的每一项异常(revenue_achievement/
// labor_efficiency/table_visit_*/bad_review_*/recharge_zero)在触发时已经由
// agents-service-v2 的 anomaly-notify-pipeline.js 各自建了带真实责任人的任务(category=
// 具体异常键，走 pickPrimaryAssignee 按门店/岗位解析)，不需要这里重新拆分。周报本身
// (category='weekly_report'/'monthly_evaluation'，source='rhythm_engine')没有
// assignee——它就是给总部看的汇总，同食安一样走cc视图，不归入"当事人"任务。
const WS_REPORT_CC_CATEGORIES = ['weekly_report', 'monthly_evaluation'];

/**
 * cc 视图：不是"指派给我"的任务，是总部经理/管理员按业务规则需要被抄送知晓的内容——
 * 食品安全异常 + 运营周报/月评，不含其它任务类型（那些只归当事人）。
 */
export async function getNotableOpenTasks(pool, tenantId, limit = 8) {
  const lim = Math.min(20, Math.max(1, Number(limit) || 8));
  const r = await pool.query(
    `SELECT task_id, title, detail, severity, store, status, category, source, created_at
       FROM master_tasks
      WHERE tenant_id = $1
        AND status NOT IN ('resolved','pending_settlement','settled','closed','rejected')
        AND (
          category ILIKE '%food_safety%' OR category ILIKE '%food_quality%'
          OR category = ANY($3)
        )
      ORDER BY (severity = 'high') DESC, created_at DESC LIMIT $2`,
    [tenantId, lim, WS_REPORT_CC_CATEGORIES]
  );
  return r.rows || [];
}

export async function getUnreadInboxCount(pool, tenantId, username) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM hrms_user_notifications WHERE tenant_id = $1 AND target_username = $2 AND read_at IS NULL`,
    [tenantId, username]
  ).catch((e) => {
    // 兼容旧库无 read_at 列
    if (/read_at|column/i.test(String(e?.message || ''))) return { rows: [{ n: 0 }] };
    throw e;
  });
  return Number(r.rows?.[0]?.n || 0);
}

/**
 * 老板/总部驾驶舱首屏聚合：门店红绿灯 + 未读数。三条洞察卡由 ontology closed-loop-report 单独提供
 * （该查询已聚合 5 张表，前端另行按 5 分钟缓存调用，不在这里重复拼装避免首屏变慢）。
 */
// 待确认的任务反馈：责任人已提交证据(status='pending_review')、等发起人/admin/hq_manager
// 确认的任务列表——目前只有 admin/hq_manager 能发起(promote-dish 限定这两个角色)，所以
// admin/hq_manager 看全部待确认；其他角色只看自己作为发起人(source_data.promoted_by)的。
export async function getPendingConfirmations(pool, tenantId, username, role) {
  // 2026-07-30 修复：之前 admin/hq_manager 无条件看到全租户所有 pending_review
  // （不管这条任务是谁发起/谁该确认），导致"上午巡检"这类跟总部完全无关的任务反馈
  // 也出现在管理员的确认队列里。跟任务列表的cc规则保持一致：只有食品安全类才允许
  // admin/hq_manager 越过"我是发起人(promoted_by)"这条限制去确认；其余任务类型，
  // 哪怕是admin，也只能确认自己发起的那些。
  const isFoodSafetyCcRole = WS_FOOD_SAFETY_CC_ROLES.includes(String(role || '').trim());
  const params = [tenantId, username];
  const whereExtra = isFoodSafetyCcRole
    ? ` AND (t.source_data->>'promoted_by' = $2 OR t.category ILIKE '%food_safety%' OR t.category ILIKE '%food_quality%')`
    : ` AND t.source_data->>'promoted_by' = $2`;
  const r = await pool.query(
    `SELECT t.task_id, t.title, t.detail, t.store, t.assignee_username,
            COALESCE(NULLIF(e.name, ''), t.assignee_username) AS assignee_name,
            t.response_text, t.response_images, t.responded_at, t.source_data
       FROM master_tasks t
       LEFT JOIN employees e
         ON lower(e.username) = lower(t.assignee_username) AND e.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1 AND t.status = 'pending_review'${whereExtra}
      ORDER BY t.responded_at DESC LIMIT 30`,
    params
  );
  return r.rows || [];
}

export async function getWorkspaceHome(pool, tenantId, username, { role = '' } = {}) {
  const isFoodSafetyCcRole = WS_FOOD_SAFETY_CC_ROLES.includes(String(role || '').trim());
  const [storeSummary, storeLights, myTasks, ccTasks, unread] = await Promise.all([
    getOpenTaskSummaryByStore(pool, tenantId),
    getStoreHealthLights(pool, tenantId),
    getMyOpenTasks(pool, tenantId, username),
    isFoodSafetyCcRole ? getNotableOpenTasks(pool, tenantId) : Promise.resolve([]),
    getUnreadInboxCount(pool, tenantId, username),
  ]);
  // 去重：如果当前用户本身就是某条食安任务的责任人，getMyOpenTasks 已经包含它，
  // 不需要在 cc 视图里再出现一次。
  // 2026-07-30 修复：食安任务本身的处置规则是"仅hq_manager可判罚；管理员仅同步通知"——
  // cc 视图不是"这个人也要处理"，只是"抄送给他知道"。之前 cc 进来的任务跟真正指派给自己
  // 的任务用同一个卡片渲染，管理员会看到跟责任人一模一样的"提交完成证据"按钮，显得好像
  // 自己也要处理，这不对。这里给纯cc（不是自己的责任任务）打上 _ccOnly 标记，前端据此
  // 渲染成只读的"仅同步知悉"，不出现可操作按钮。
  const myTaskIds = new Set(myTasks.map((t) => t.task_id));
  const tasks = [
    ...myTasks,
    ...ccTasks.filter((t) => !myTaskIds.has(t.task_id)).map((t) => ({ ...t, _ccOnly: true })),
  ];
  return { storeSummary, storeLights, myTasks: tasks, unreadCount: unread };
}

/**
 * 批量推广菜品到多店：把「批准推广」这个动作拆成给每个目标门店的出品经理各建一条
 * master_tasks（复用已有状态机/证据/验收流程），不新建 dish/promotion 领域表。
 */
/**
 * 2026-07-28 修复：之前这里建的任务没有设置 assignee_username，任务是孤儿——
 * 出品经理的"我的任务"（按 assignee_username 过滤）里根本看不到。现在用现成的
 * pickAssigneeForCategory()（server/domains/master-agent/resolve-assignee.js，
 * 数据审计流程本来就在用同一套规则）按门店+岗位解析出出品经理，写进 assignee_username。
 * 该店如果没有出品经理，任务仍然会建（不阻断），但会在返回结果里报告哪些店没解析到人，
 * 调用方（前端）需要把这个报告展示出来，不能假装都成功了。
 */
export async function promoteDishToStores(pool, { dishName, sourceStore, targetStores, note, actorUsername, tenantId = 'default', state = {} }) {
  const dish = String(dishName || '').trim();
  const stores = Array.isArray(targetStores) ? targetStores.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (!dish) return { ok: false, status: 400, error: 'missing_dish_name' };
  if (!stores.length) return { ok: false, status: 400, error: 'missing_target_stores' };

  const createdTaskIds = [];
  const unassignedStores = [];
  for (const store of stores) {
    const taskId = generateTaskId();
    const title = `上新推广：${dish}`;
    const detail = `「${dish}」在${sourceStore ? sourceStore + '首周表现良好，' : ''}建议本店上架并完成出品培训。${note ? '备注：' + String(note).trim() : ''}`;

    let assigneeUsername = null;
    try {
      const { assignee } = pickAssigneeForCategory({
        category: 'menu_optimization',
        store,
        state,
        roleMap: { menu_optimization: 'store_production_manager' },
      });
      assigneeUsername = assignee?.username || null;
    } catch (e) {
      log.warn({ msg: 'workspace_dish_promotion_assignee_resolve_failed', store, err: e?.message });
    }
    if (!assigneeUsername) unassignedStores.push(store);

    await pool.query(
      `INSERT INTO master_tasks (task_id, status, source, current_agent, category, severity, store, title, detail, assignee_username, source_data, tenant_id)
       VALUES ($1, 'pending_dispatch', 'workspace_dish_promotion', 'workspace', 'menu_optimization', 'medium', $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        taskId,
        store,
        title,
        detail,
        assigneeUsername,
        JSON.stringify({ dish_name: dish, source_store: sourceStore || '', promoted_by: actorUsername || '' }),
        tenantId,
      ]
    );
    createdTaskIds.push(taskId);
  }
  log.info({ msg: 'workspace_dish_promotion_created', dish, stores: stores.length, actor: actorUsername, unassigned: unassignedStores.length });
  return { ok: true, taskIds: createdTaskIds, storeCount: stores.length, unassignedStores };
}

// 2026-07-29 新增：真正的任务完成闭环。之前"确认完成/批准"按钮统一调
// /api/agent-task-board/tasks/:id/review——那个接口 GAAS 代理层和 agents-service-v2 两边都
// 限定 admin/hq_manager/hr_manager 才能调，任务真正的责任人（出品经理/店长等）点击必定 403，
// 而且就算放行了，"点一下就算完成"本身也不构成闭环——用户明确要求：责任人必须提交实际证据
// （比如被培训人员签字文件/出品经理承诺书），完成动作要能回传给发起人，出问题才能追溯。
// 这里走 master_tasks 已有的 response_text/response_images/responded_at（责任人提交证据）→
// review_result/resolved_at（发起人或admin确认）这条现成状态机，不是新建一套。
export async function respondToTask(pool, tenantId, { taskId, username, responseText, responseImages }) {
  const text = String(responseText || '').trim();
  const images = Array.isArray(responseImages) ? responseImages.filter(Boolean) : [];
  if (!text && !images.length) return { ok: false, status: 400, error: 'missing_evidence' };
  const r = await pool.query(
    `UPDATE master_tasks SET status = 'pending_review', response_text = $1, response_images = $2::jsonb,
            responded_at = NOW(), updated_at = NOW()
       WHERE task_id = $3 AND tenant_id = $4 AND assignee_username = $5
         AND status NOT IN ('resolved','pending_settlement','settled','closed','rejected')
       RETURNING task_id, store, title, source_data`,
    [text, JSON.stringify(images), taskId, tenantId, username]
  );
  if (!r.rows.length) return { ok: false, status: 404, error: 'task_not_found_or_not_yours' };
  const task = r.rows[0];
  const dispatcher = String(task.source_data?.promoted_by || task.source_data?.dispatched_by || '').trim();
  if (dispatcher) {
    await pool.query(
      `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
       VALUES ($1, $2, $3, 'task_response_submitted', $4::jsonb, $5)`,
      [
        dispatcher,
        '任务已提交完成反馈，待确认',
        `${username} 已提交「${task.title}」的完成反馈${text ? '：' + text : ''}${images.length ? '（含' + images.length + '个证据文件）' : ''}，请查看并确认。`,
        JSON.stringify({ task_id: taskId, store: task.store }),
        tenantId,
      ]
    );
  }
  return { ok: true, taskId };
}

export async function confirmTaskResponse(pool, tenantId, { taskId, reviewerUsername, reviewerRole, decision, note }) {
  const taskR = await pool.query(
    `SELECT source_data, assignee_username, title, store FROM master_tasks WHERE task_id = $1 AND tenant_id = $2`,
    [taskId, tenantId]
  );
  if (!taskR.rows.length) return { ok: false, status: 404, error: 'task_not_found' };
  const task = taskR.rows[0];
  const dispatcher = String(task.source_data?.promoted_by || task.source_data?.dispatched_by || '').trim();
  const canReview = ['admin', 'hq_manager'].includes(String(reviewerRole || '')) || (dispatcher && dispatcher === reviewerUsername);
  if (!canReview) return { ok: false, status: 403, error: 'forbidden' };
  // 打回不能设成 'rejected'——那是 getMyOpenTasks 的排除状态，任务会从责任人的"任务"列表里
  // 消失，等于打回了却没人跟进。打回改回 'pending_dispatch'（原始活跃状态），责任人重新看到
  // 这条任务、收到打回原因的通知，能重新提交，不是把任务憋死。
  const isReject = decision === 'reject';
  const r = await pool.query(
    `UPDATE master_tasks SET status = $1, review_result = $2::jsonb, resolved_at = $3, updated_at = NOW()
       WHERE task_id = $4 AND tenant_id = $5 AND status = 'pending_review'
       RETURNING task_id, assignee_username`,
    [isReject ? 'pending_dispatch' : 'resolved', JSON.stringify({ decision: isReject ? 'reject' : 'approved', note: String(note || '').trim(), reviewer: reviewerUsername }), isReject ? null : new Date().toISOString(), taskId, tenantId]
  );
  if (!r.rows.length) return { ok: false, status: 404, error: 'task_not_pending_review' };
  if (isReject && task.assignee_username) {
    await pool.query(
      `INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, tenant_id)
       VALUES ($1, $2, $3, 'task_response_rejected', $4::jsonb, $5)`,
      [
        task.assignee_username,
        '任务反馈被打回，需重新提交',
        `「${task.title}」的完成反馈未通过确认${note ? '：' + note : ''}，请重新提交。`,
        JSON.stringify({ task_id: taskId, store: task.store }),
        tenantId,
      ]
    );
  }
  return { ok: true, taskId, status: isReject ? 'rejected' : 'resolved' };
}
