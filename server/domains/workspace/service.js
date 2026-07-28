/**
 * 角色工作台聚合层：只读组装现有表/接口的数据，不新建业务逻辑，不写共享表 schema。
 * promoteDishToStores 是唯一的写路径——本质是把「批量推广菜品」拆成给各店出品经理各建一条
 * master_tasks（已有表、已有状态机），不是新领域对象。
 */
import { childLogger } from '../../utils/logger.js';

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
 */
export async function getStoreHealthLights(pool, tenantId) {
  const [ratedRows, taskStoreRows] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (store) store, rating, achievement_rate, period
         FROM store_ratings
        WHERE tenant_id = $1 AND store IS NOT NULL AND store <> ''
        ORDER BY store, period DESC`,
      [tenantId]
    ),
    pool.query(
      `SELECT DISTINCT store FROM master_tasks
        WHERE tenant_id = $1 AND store IS NOT NULL AND store <> ''`,
      [tenantId]
    ),
  ]);
  const ratingByStore = new Map((ratedRows.rows || []).map((r) => [r.store, r]));
  const allStores = new Set([...ratingByStore.keys(), ...(taskStoreRows.rows || []).map((r) => r.store)]);
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

export async function getMyOpenTasks(pool, tenantId, username, limit = 20) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 20));
  const r = await pool.query(
    `SELECT task_id, title, detail, severity, store, status, category, source, created_at
       FROM master_tasks
      WHERE tenant_id = $1 AND assignee_username = $2
        AND status NOT IN ('resolved','pending_settlement','settled','closed','rejected')
      ORDER BY created_at DESC LIMIT $3`,
    [tenantId, username, lim]
  );
  return r.rows || [];
}

/**
 * 老板/总部视角的「需拍板」任务：不是"指派给我"的任务（那是店长/员工视角），
 * 而是全租户范围内按严重度排序的开放任务，用于驾驶舱/总部工作台的决策卡片。
 */
export async function getNotableOpenTasks(pool, tenantId, limit = 8) {
  const lim = Math.min(20, Math.max(1, Number(limit) || 8));
  const r = await pool.query(
    `SELECT task_id, title, detail, severity, store, status, category, source, created_at
       FROM master_tasks
      WHERE tenant_id = $1
        AND status NOT IN ('resolved','pending_settlement','settled','closed','rejected')
      ORDER BY (severity = 'high') DESC, created_at DESC LIMIT $2`,
    [tenantId, lim]
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
export async function getWorkspaceHome(pool, tenantId, username, { scope = 'mine' } = {}) {
  const [storeSummary, storeLights, tasks, unread] = await Promise.all([
    getOpenTaskSummaryByStore(pool, tenantId),
    getStoreHealthLights(pool, tenantId),
    scope === 'notable' ? getNotableOpenTasks(pool, tenantId) : getMyOpenTasks(pool, tenantId, username),
    getUnreadInboxCount(pool, tenantId, username),
  ]);
  return { storeSummary, storeLights, myTasks: tasks, unreadCount: unread };
}

/**
 * 批量推广菜品到多店：把「批准推广」这个动作拆成给每个目标门店的出品经理各建一条
 * master_tasks（复用已有状态机/证据/验收流程），不新建 dish/promotion 领域表。
 */
export async function promoteDishToStores(pool, { dishName, sourceStore, targetStores, note, actorUsername, tenantId = 'default' }) {
  const dish = String(dishName || '').trim();
  const stores = Array.isArray(targetStores) ? targetStores.map((s) => String(s || '').trim()).filter(Boolean) : [];
  if (!dish) return { ok: false, status: 400, error: 'missing_dish_name' };
  if (!stores.length) return { ok: false, status: 400, error: 'missing_target_stores' };

  const createdTaskIds = [];
  for (const store of stores) {
    const taskId = generateTaskId();
    const title = `上新推广：${dish}`;
    const detail = `「${dish}」在${sourceStore ? sourceStore + '首周表现良好，' : ''}建议本店上架并完成出品培训。${note ? '备注：' + String(note).trim() : ''}`;
    await pool.query(
      `INSERT INTO master_tasks (task_id, status, source, current_agent, category, severity, store, title, detail, source_data, tenant_id)
       VALUES ($1, 'pending_dispatch', 'workspace_dish_promotion', 'workspace', 'menu_optimization', 'medium', $2, $3, $4, $5::jsonb, $6)`,
      [
        taskId,
        store,
        title,
        detail,
        JSON.stringify({ dish_name: dish, source_store: sourceStore || '', promoted_by: actorUsername || '' }),
        tenantId,
      ]
    );
    createdTaskIds.push(taskId);
  }
  log.info({ msg: 'workspace_dish_promotion_created', dish, stores: stores.length, actor: actorUsername });
  return { ok: true, taskIds: createdTaskIds, storeCount: stores.length };
}
