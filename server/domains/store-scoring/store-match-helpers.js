/**
 * 评分/评级用门店名匹配辅助（纯函数）。
 * 从 new-scoring-model.js 拆出。
 */
import {
  dailyReportIlikePatterns,
  feishuStoreSearchPatterns,
  resolveAgentCanonicalStore,
  toFeishuStoreName
} from '../../v2-store-alignment.js';

/** 评分用门店匹配：合并日报口径 + 飞书/目标表常见简称（洪潮目标行常为「洪潮久光」等，仅 daily 模式会漏） */
export function scoringStoreMatchPatterns(storeLabel) {
  const s = String(storeLabel || '').trim();
  if (!s) return ['%'];
  return [...new Set([...dailyReportIlikePatterns(s), ...feishuStoreSearchPatterns(s)])];
}

/**
 * 员工绩效里「单表 store = 精确值」类查询：同时尝试 HR 规范店名与飞书/Bitable 简称（马己仙↔大宁、洪潮↔久光）。
 * 洪潮、马己仙两店在代码层已覆盖；新店请在 v2-store-alignment.js 的 STORE_TO_FEISHU 补映射，或统一主数据店名。
 */
export function scoringStoreExactKeys(storeLabel) {
  const s = String(storeLabel || '').trim();
  if (!s) return [];
  const canon = resolveAgentCanonicalStore(s);
  return [...new Set([s, canon, toFeishuStoreName(s), toFeishuStoreName(canon)].filter(Boolean))];
}

/**
 * 单店汇总（企微新增、点评等）专用：仅规范名 + 飞书写法。
 * `scoringStoreMatchPatterns` 中含 `%洪潮%` / `%马己仙%` 会把多店数据加进一家店 → 虚假高分。
 */
export function scoringStoreAggregateIlikePatterns(storeLabel) {
  const keys = scoringStoreExactKeys(storeLabel);
  if (!keys.length) return ['%'];
  return [...new Set(keys.map((k) => `%${String(k).replace(/%/g, '')}%`))];
}

// 获取时间段天数
export function getDaysInPeriod(period) {
  const [year, month] = period.split('-');
  return new Date(year, month, 0).getDate();
}

export function periodDateRange(period) {
  const [year, month] = period.split('-');
  const startDate = `${year}-${month}-01`;
  const endDate = `${year}-${month}-${String(getDaysInPeriod(period)).padStart(2, '0')}`;
  return { startDate, endDate };
}

export function parseJsonArrayMaybe(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const j = JSON.parse(v);
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  return [];
}
