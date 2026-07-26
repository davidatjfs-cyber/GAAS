/**
 * Agent 品牌运行时 — 纯 helpers（P2 peel from agents.js）。
 * 注意：与 domains/stores/brand-scope.js 同名函数语义不同，禁止混用。
 */

/** 品牌配置兜底：与 brand_configs.checklist 一致，仅 DB 未就绪时使用 */
export const BRAND_CONFIG = {
  '洪潮': {
    name: '洪潮',
    fullName: '洪潮传统潮汕菜',
    checkItems: {
      opening: ['地面清洁无积水', '所有设备正常开启', '食材新鲜度检查', '餐具消毒完成', '灯光亮度适中', '背景音乐开启', '空调温度设置合适', '员工仪容仪表检查'],
      closing: ['食材封存', '设备关闭', '垃圾清理', '安全检查', '门窗锁好'],
    },
    standards: {
      quality: '高标准食材，新鲜度要求严格',
      service: '热情周到，响应及时',
      environment: '干净整洁，氛围舒适',
    },
  },
  '马己仙': {
    name: '马己仙',
    fullName: '马己仙',
    checkItems: {
      opening: ['地面清洁', '设备开启', '食材准备', '餐具消毒', '迎宾准备'],
      closing: ['食材封存', '设备关闭', '垃圾清理', '安全检查', '门窗锁好', '电源关闭'],
    },
    standards: {
      quality: '精致料理，注重细节',
      service: '优雅服务，体验至上',
      environment: '高雅环境，品质生活',
    },
  },
};

export function normalizeBrandId(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function getBrandsFromState(state0) {
  const state = state0 && typeof state0 === 'object' ? state0 : {};
  const stores = Array.isArray(state?.stores) ? state.stores : [];
  const existing = Array.isArray(state?.brands) ? state.brands : [];
  const map = new Map();

  existing.forEach((b) => {
    const name = String(b?.name || b?.label || '').trim();
    const id = normalizeBrandId(b?.id || b?.brandId || name);
    if (!name || !id) return;
    map.set(id, {
      id,
      name,
      config: b?.config && typeof b.config === 'object' ? b.config : {},
    });
  });

  stores.forEach((s) => {
    const name = String(s?.brand || s?.brandName || '').trim();
    const id = normalizeBrandId(s?.brandId || name);
    if (!name || !id || map.has(id)) return;
    map.set(id, { id, name, config: {} });
  });

  return Array.from(map.values());
}
