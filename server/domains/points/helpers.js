/**
 * Points domain helpers (behavior-preserving extract from index.js).
 * bindPointsRuntimeDeps(deps) must be called from registerPointsRoutes.
 */

export let getSharedState;
export let saveSharedState;
export let mergeSharedStateFields;
export let hrmsNowISO;

export function bindPointsRuntimeDeps(deps) {
  getSharedState = deps.getSharedState;
  saveSharedState = deps.saveSharedState;
  mergeSharedStateFields = deps.mergeSharedStateFields;
  hrmsNowISO = deps.hrmsNowISO;
}

export function normalizePointsAdminRecordStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'pending' || s === '未审批') return 'pending';
  if (s === 'applied' || s === '已申请' || s === 'submitted') return 'applied';
  return 'approved';
}

export function mapApprovalRowToPointsAdminItem(row) {
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const rawItems = Array.isArray(p.items) ? p.items : [];
  let pts = Number(p.totalPoints);
  if (!Number.isFinite(pts) || pts < 0) pts = Number(p.points) || 0;
  if ((!pts || pts === 0) && rawItems.length) {
    pts = rawItems.reduce((acc, it) => acc + (Number(it?.points) || 0), 0);
  }
  const st = String(row.status || '').trim().toLowerCase();
  let recordStatusZh = '已申请';
  if (st === 'pending') recordStatusZh = '未审批';
  else if (st === 'approved') recordStatusZh = '已审批';
  else if (st === 'rejected') recordStatusZh = '已驳回';
  else if (st === 'returned') recordStatusZh = '已退回';
  const applicantName = String(p.applicantName || '').trim();
  const apprUser = String(row.applicant_username || '').trim();
  const ts = row.created_at ? String(row.created_at) : '';
  const approvedAt =
    st === 'approved'
      ? String(row.executed_at || row.updated_at || '')
      : '';
  return {
    id: String(row.id || ''),
    sourceType: 'points_approval',
    approvalId: String(row.id || ''),
    username: apprUser,
    name: applicantName || apprUser,
    store: String(p.store || '').trim(),
    itemName: String(p.itemName || '').trim() || '积分申请',
    reason: String(p.reason || '').trim(),
    points: Number(pts) || 0,
    amount: Number(((Number(pts) || 0) * 0.5).toFixed(2)),
    approvedAt,
    approvedBy: '',
    createdAt: ts,
    recordStatusZh,
    approvalStatus: st
  };
}

export function canApplyPointsByRole(roleInput) {
  const role = String(roleInput || '').trim();
  if (!role) return false;
  return role === 'store_employee' || role === 'front_manager' || role === 'front_supervisor' || role === 'employee';
}

export const GLOBAL_SOCIAL_POINT_RULE_ID = 'global-rule-douyin-xhs-dianping-10';

export function isTripleSocialMediaPointRuleItem(item) {
  const n = String(item?.itemName || '');
  return n.includes('抖音') && n.includes('小红书') && n.includes('大众点评');
}

/** 去掉重复的「抖音/小红书/大众点评」积分事项，只保留 canonical id（或保留一条并改为 canonical） */
export async function dedupeGlobalSocialMediaPointRules() {
  try {
    const state0 = (await getSharedState()) || {};
    const list = Array.isArray(state0.pointRules) ? state0.pointRules : [];
    const hits = list.filter(isTripleSocialMediaPointRuleItem);
    if (hits.length <= 1) return;
    const non = list.filter((r) => !isTripleSocialMediaPointRuleItem(r));
    const preferred =
      hits.find((r) => String(r?.id || '').trim() === GLOBAL_SOCIAL_POINT_RULE_ID) || hits[0];
    const canonical = {
      ...preferred,
      id: GLOBAL_SOCIAL_POINT_RULE_ID,
      store: '',
      itemName: '抖音/小红书/大众点评各发布一条合格的公司宣传内容',
      points: 10,
      enabled: true,
      updatedBy: 'system',
      updatedAt: hrmsNowISO()
    };
    await saveSharedState({ ...state0, pointRules: [canonical, ...non] });
    console.log('[points] deduped triple-social point rules, removed', hits.length - 1, 'extra');
  } catch (e) {
    console.error('[points] dedupeGlobalSocialMediaPointRules:', e?.message || e);
  }
}

export function dedupePointRulesApiItems(items) {
  const arr = Array.isArray(items) ? items.slice() : [];
  const social = arr.filter(isTripleSocialMediaPointRuleItem);
  if (social.length <= 1) return arr;
  const keep =
    social.find((r) => String(r?.id || '').trim() === GLOBAL_SOCIAL_POINT_RULE_ID) || social[0];
  return arr.filter((r) => !isTripleSocialMediaPointRuleItem(r) || r === keep);
}

export async function ensureGlobalSocialMediaPointRule() {
  try {
    await mergeSharedStateFields(
      {
        pointRules: [
          {
            id: GLOBAL_SOCIAL_POINT_RULE_ID,
            store: '',
            itemName: '抖音/小红书/大众点评各发布一条合格的公司宣传内容',
            points: 10,
            enabled: true,
            updatedBy: 'system',
            updatedAt: hrmsNowISO()
          }
        ]
      },
      { pointRules: 'id' }
    );
    console.log('[points] upserted global social media point rule (all stores, id=' + GLOBAL_SOCIAL_POINT_RULE_ID + ')');
  } catch (e) {
    console.error('[points] ensureGlobalSocialMediaPointRule:', e?.message || e);
  }
}

/** 积分门店筛选：统一常见异写（如 马已仙 / 马己仙），避免排行榜与记录查询全空 */
export function canonicalizeStoreKeyForPoints(store) {
  let s = String(store || '').trim();
  s = s.replace(/马已仙/g, '马己仙');
  // inline normalizeStoreKey (shared util stays in index.js)
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '');
}
