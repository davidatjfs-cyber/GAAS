/** 增长方案轮次/指标常量（外提自 growth-solutions.js） */

export const OBSERVATION_DAYS = 30; // 任务全部完成后的观察期
export const METRIC_WINDOW_DAYS = 30; // 指标统计窗口
export const SUCCESS_RATE = 0.9; // 达成率≥90%算成功

/** 责任角色 → 岗位关键词(用于预填候选人) */
export const ROLE_POSITIONS = {
  store_manager: ['店长', '主管', '前厅经理'],
  production_manager: ['出品经理', '厨师长'],
  kitchen_staff: ['炒锅', '砧板', '烧味', '刺身', '汤档', '打荷', '蒸笼'],
  front_staff: ['服务员', '传菜', '水吧', '迎宾'],
  hr: ['人事'],
};
