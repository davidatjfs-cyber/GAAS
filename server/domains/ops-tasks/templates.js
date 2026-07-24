import { OPS_BRAND_STORE_MAP, OPS_BRAND_RULES, normalizeOpsRole } from './config.js';

export function createOpsTaskTemplateHelpers({ safeDateOnly, pickStoreRoleUsernameByStore }) {
  function opsDateOnly(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function opsDateAt(dateStr, hm) {
    const date = safeDateOnly(dateStr);
    const time = String(hm || '').trim();
    if (!date || !/^\d{2}:\d{2}$/.test(time)) return null;
    const v = new Date(`${date}T${time}:00`);
    return Number.isFinite(v.getTime()) ? v : null;
  }

  function resolveOpsStoreBrand(state, storeName) {
    const store = String(storeName || '').trim();
    if (!store) return '';
    const stores = Array.isArray(state?.stores) ? state.stores : [];
    const row = stores.find(s => String(s?.name || '').trim() === store) || null;
    const fromState = String(row?.brand || row?.brandName || '').trim();
    if (fromState) return fromState;
    return String(OPS_BRAND_STORE_MAP[store] || '').trim();
  }

  function getOpsManagedStores(state) {
    const inState = Array.isArray(state?.stores)
      ? state.stores.map(s => String(s?.name || '').trim()).filter(Boolean)
      : [];
    const mapped = Object.keys(OPS_BRAND_STORE_MAP);
    return Array.from(new Set(inState.concat(mapped))).filter(Boolean);
  }

  function getOpsStoreAssignee(state, store, role) {
    const r = normalizeOpsRole(role);
    return pickStoreRoleUsernameByStore(state, store, [r]);
  }

  function buildOpsTaskTemplates(store, brand, bizDate) {
    const rules = OPS_BRAND_RULES[brand] || OPS_BRAND_RULES['洪潮传统潮汕菜'];
    if (!rules) return [];
    return [
      {
        taskType: 'opening_lunch',
        scheduleKey: 'opening_lunch',
        assigneeRole: 'store_manager',
        title: '午市开档检查（11:00前）',
        dueAt: opsDateAt(bizDate, rules.lunchDeadline),
        requiredPhotos: 3,
        checklist: ['门店前场与后厨开档状态完整', '关键岗位到岗确认', '收银及开档准备完成']
      },
      {
        taskType: 'prep_lunch',
        scheduleKey: 'prep_lunch',
        assigneeRole: 'store_production_manager',
        title: '午市出品与备货巡查（11:00前）',
        dueAt: opsDateAt(bizDate, rules.lunchDeadline),
        requiredPhotos: 3,
        checklist: ['备货台全景', '重点SKU备货近景', '出品工位卫生与标准']
      },
      {
        taskType: 'opening_dinner',
        scheduleKey: 'opening_dinner',
        assigneeRole: 'store_manager',
        title: '晚市开档检查（17:00前）',
        dueAt: opsDateAt(bizDate, rules.dinnerDeadline),
        requiredPhotos: 3,
        checklist: ['晚市排班到岗确认', '服务区与后厨开档完成', '晚市物料状态确认']
      },
      {
        taskType: 'prep_dinner',
        scheduleKey: 'prep_dinner',
        assigneeRole: 'store_production_manager',
        title: '晚市出品与备货巡查（17:00前）',
        dueAt: opsDateAt(bizDate, rules.dinnerDeadline),
        requiredPhotos: 3,
        checklist: ['晚市备货全景', '热销菜品备货细节', '出品台状态与风险点']
      },
      {
        taskType: 'bad_review_followup',
        scheduleKey: 'bad_review_followup',
        assigneeRole: 'store_manager',
        title: '堂食/外卖差评跟踪处理（当日）',
        dueAt: opsDateAt(bizDate, rules.reviewDeadline),
        requiredPhotos: 2,
        checklist: ['上传差评截图（堂食/外卖）', '上传处理结果或沟通记录截图']
      },
      {
        taskType: 'table_visit_tracking',
        scheduleKey: 'table_visit_tracking',
        assigneeRole: 'store_manager',
        title: '桌访达成记录同步确认（当日）',
        dueAt: opsDateAt(bizDate, rules.tableVisitDeadline),
        requiredPhotos: 1,
        checklist: ['上传桌访记录截图（飞书或内部表）', '备注当日关键反馈与跟进项']
      }
    ].filter(t => t.dueAt instanceof Date);
  }

  return {
    opsDateOnly,
    opsDateAt,
    resolveOpsStoreBrand,
    getOpsManagedStores,
    getOpsStoreAssignee,
    buildOpsTaskTemplates,
  };
}
