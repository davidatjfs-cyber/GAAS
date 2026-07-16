/**
 * 客户上线进度清单：复用运营巡检(tenant-operation-inspection-service.js)已经在查的信号，
 * 不重新造一遍数据源，只是换一种"新租户上线是否就绪"的视角呈现给销售/客户成功。
 */
import { getHealthCenterTenantDetail } from '../tenant-health-center-service.js';

const OK_STATUS = '正常';

// 只挑巡检里已经存在、且确实能代表"上线是否就绪"的信号；没有数据支撑的项(比如"是否完成
// 首次培训")不编造，宁可在清单里缺项也不要显示假信息。
const ONBOARDING_ITEMS = [
  { item_key: 'pos_data_connected', label: 'POS数据是否正常接入' },
  { item_key: 'customer_phone_match_rate', label: '客户手机号匹配率', fallback_key: 'order_phone_complete_rate' },
  { item_key: 'employees_bound_store_role', label: '员工账号是否开通' },
  { item_key: 'customer_segments_generatable', label: '客户分层是否可生成' },
  { item_key: 'sms_wecom_sent', label: '自动营销是否已实际发送' },
  { item_key: 'yesterday_orders_synced', label: '订单数据是否持续同步' },
];

export async function getOnboardingChecklist(pool, tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) return { ok: false, error: 'tenant_id_required' };

  const detail = await getHealthCenterTenantDetail(pool, tid);
  const items = detail?.items || [];
  const byKey = Object.fromEntries(items.map((i) => [i.item_key, i]));

  const checklist = ONBOARDING_ITEMS.map((def) => {
    const item = byKey[def.item_key] || (def.fallback_key ? byKey[def.fallback_key] : null);
    const done = item ? item.status === OK_STATUS : null;
    return {
      key: def.item_key,
      label: def.label,
      done,
      status_label: item ? item.status : '未检测',
      suggestion: done === false ? (item?.suggestion || '') : '',
    };
  });

  const trackedCount = checklist.filter((c) => c.done != null).length;
  const doneCount = checklist.filter((c) => c.done === true).length;
  const readyForGoLive = trackedCount > 0 && doneCount === trackedCount;

  return {
    ok: true,
    tenant_id: tid,
    checklist,
    done_count: doneCount,
    tracked_count: trackedCount,
    total_count: checklist.length,
    ready_for_go_live: readyForGoLive,
    note: '"是否完成首次培训"等无系统信号可依的项未列入，需人工跟进确认。',
  };
}
