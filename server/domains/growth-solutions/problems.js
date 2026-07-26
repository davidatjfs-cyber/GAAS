// 六大问题定义:指标口径 + 阶梯规则
export const PROBLEMS = {
  staff_efficiency: {
    title: '提升员工效率',
    metric: '人效(折前营业额/人天)',
    unit: '元/人天',
    ladder: { type: 'pct', step: 0.10, cap: 0.30 },
    scope: '员工人均产出偏低(排班、人力浪费类问题)，不涉及服务态度或出品质量',
  },
  revenue: {
    title: '提升营业额',
    metric: '近30天营业额',
    unit: '元',
    ladder: { type: 'pct', step: 0.05, cap: 0.20 },
    scope: '整体营业额/客流/客单下滑，不涉及具体菜品或服务态度问题',
  },
  kitchen_standard: {
    title: '提升出品标准',
    metric: 'SOP打点完成率',
    unit: '%',
    ladder: { type: 'ladder', steps: [80, 90, 95] },
    scope: '厨房SOP执行/打点纪律问题(出餐流程是否按标准做)，不涉及具体某道菜好不好吃',
  },
  menu_optimization: {
    title: '提升菜单质量',
    metric: '本轮处理问题菜品数',
    unit: '道',
    ladder: { type: 'count', perRound: 5 },
    scope: '仅限桌访反馈里对具体菜品口味/份量/新鲜度等的不满意；不包括服务态度、上菜速度、员工礼仪、环境卫生、结账效率等非菜品类投诉',
  },
  gross_margin: {
    title: '提升菜品毛利率',
    metric: '综合毛利率(已匹配成本菜品)',
    unit: '%',
    ladder: { type: 'pp', step: 1, cap: 3 },
    scope: '菜品成本结构/毛利偏低，不涉及服务或出品质量',
  },
  training_replication: {
    title: '复制培养人才',
    metric: '关键岗位必修认证覆盖率',
    unit: '%',
    ladder: { type: 'ladder', steps: [50, 80, 100] },
    scope: '关键岗位认证覆盖率/人才梯队问题，不涉及日常服务态度好坏',
  },
};
