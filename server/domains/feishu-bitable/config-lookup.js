import { FEISHU_TABLE_CONFIG } from '../../feishu-sync.js';

// 根据 appToken 和 tableId 查找对应的 configKey
export function findConfigKeyByTableInfo(appToken, tableId) {
  if (!appToken || !tableId) return null;
  const appTokenNorm = String(appToken).trim();
  const tableIdNorm = String(tableId).trim();

  for (const [key, config] of Object.entries(FEISHU_TABLE_CONFIG)) {
    if (typeof config === 'object' && config !== null) {
      // 处理嵌套配置（如 material_reports.majixian）
      if (config.app_token && config.table_id) {
        if (String(config.app_token).trim() === appTokenNorm &&
            String(config.table_id).trim() === tableIdNorm) {
          return key;
        }
      }
      // 处理嵌套的品牌配置
      for (const [subKey, subConfig] of Object.entries(config)) {
        if (typeof subConfig === 'object' && subConfig !== null &&
            subConfig.app_token && subConfig.table_id) {
          if (String(subConfig.app_token).trim() === appTokenNorm &&
              String(subConfig.table_id).trim() === tableIdNorm) {
            return `${key}_${subKey}`;
          }
        }
      }
    }
  }
  return null;
}
