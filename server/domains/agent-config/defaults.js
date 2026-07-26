export const DEFAULT_RULES = [
  { category: '桌访占比异常', assignee_role: 'store_manager', normal_deduction: 2, major_deduction: 5 },
  { category: '实收营收异常', assignee_role: 'store_manager', normal_deduction: 2, major_deduction: 5 },
  { category: '人效值异常', assignee_role: 'store_manager', normal_deduction: 2, major_deduction: 5 },
  { category: '充值异常', assignee_role: 'store_manager', normal_deduction: 2, major_deduction: 5 },
  { category: '总实收毛利率异常', assignee_role: 'store_production_manager', normal_deduction: 5, major_deduction: 10 },
  { category: '产品差评异常', assignee_role: 'store_production_manager', normal_deduction: 10, major_deduction: 15 },
  { category: '服务差评异常', assignee_role: 'store_manager', normal_deduction: 10, major_deduction: 15 },
  { category: '桌访产品异常', assignee_role: 'store_production_manager', normal_deduction: 5, major_deduction: 10 }
];

export const DEFAULT_EMPLOYEE_RATING_CONFIG = {
  levelLabels: { A: 'A', B: 'B', C: 'C', D: 'D' },
  execution: {
    store_production_manager: {
      hongchao: {
        dataSources: ['收档报告DB', '开档报告', '洪潮原料收货日报'],
        A_max_missing: 6, B_max_missing: 13, C_max_missing: 20, D_min_missing: 22
      },
      majixian: {
        dataSources: ['收档报告DB', '开档报告', '马己仙原料收货日报'],
        A_max_missing: 6, B_max_missing: 13, C_max_missing: 20, D_min_missing: 22
      }
    },
    store_manager: {
      hongchao: { A_min_new_members: 300, B_min_new_members: 249, C_min_new_members: 200, D_max_new_members: 199 },
      majixian: { low_score_threshold: 7, A_max_missing: 2, A_max_low_score: 2, B_max_missing: 4, B_max_low_score: 4, C_max_missing: 6, C_max_low_score: 6, D_min_missing: 7, D_min_low_score: 7 }
    }
  },
  attitude: { A_max_incomplete: 2, B_max_incomplete: 4, C_max_incomplete: 8, D_min_incomplete: 9 },
  ability: {
    store_production_manager: { A_min_diff: 1.01, B_min_diff: -1, B_max_diff: 1, C_min_diff: -2, C_max_diff: -1.01, D_max_diff: -2 },
    store_manager: {
      hongchao: { A_min_rating: 4.6, B_min_rating: 4.5, C_min_rating: 4.3, D_max_rating: 4.2 },
      majixian: { A_min_rating: 4.5, B_min_rating: 4.4, C_min_rating: 4.0, D_max_rating: 3.9 }
    }
  }
};

export const DEFAULT_OPS_AGENT_CONFIG = {
  dispatchers: ['store_manager', 'store_production_manager'],
  llmModels: {
    reasoningModel: 'qwen-max',
    visionModel: 'ep-20260424183833-7lr9g'
  },
  scheduledTasks: {
    dailyInspections: [],
    randomInspections: [],
    dataTriggers: {
      productComplaintThreshold: 2,
      marginDeviationThreshold: 0.01,
      tableVisitRatioThreshold: 0.50
    }
  }
};

export const DEFAULT_BI_AGENT_CONFIG = {
  dataSources: [
    { key: 'daily_reports', label: '营业日报（系统）', sourceType: 'system', enabled: true },
    { key: 'table_visit_records', label: '桌访记录（系统入库）', sourceType: 'system', enabled: true },
    { key: 'table_visit_bitable', label: '桌访表（飞书）', sourceType: 'bitable', enabled: true },
    { key: 'opening_reports_bitable', label: '开档报告（飞书）', sourceType: 'bitable', enabled: true },
    { key: 'closing_reports_bitable', label: '收档报告DB（飞书）', sourceType: 'bitable', enabled: true },
    { key: 'meeting_reports_bitable', label: '例会报告（飞书）', sourceType: 'bitable', enabled: true },
    { key: 'bad_reviews', label: '差评报告（飞书）', sourceType: 'bitable', enabled: true },
    { key: 'material_majixian_bitable', label: '马己仙原料收货日报（飞书）', sourceType: 'bitable', enabled: true },
    { key: 'material_hongchao_bitable', label: '洪潮原料收货日报（飞书）', sourceType: 'bitable', enabled: true },
    { key: 'ops_checklist_bitable', label: '开-收档检查表（飞书）', sourceType: 'bitable', enabled: true }
  ],
  anomalyTriggers: {
    global: {
      revenueGapMedium: 0.10,
      revenueGapHigh: 0.20,
      efficiencyMedium: 1100,
      efficiencyHigh: 1000,
      marginMedium: 0.69,
      marginHigh: 0.68,
      tableVisitProductMedium: 2,
      tableVisitProductHigh: 4,
      tableVisitRatioMedium: 0.5,
      tableVisitRatioHigh: 0.4,
      badReviewMedium: 1,
      badReviewHigh: 2,
      rechargeStreakHighDays: 2
    },
    storeOverrides: {
      '马己仙上海音乐广场店': {
        efficiencyMedium: 1400,
        efficiencyHigh: 1300,
        marginMedium: 0.64,
        marginHigh: 0.63
      }
    }
  },
  anomalyDictionary: DEFAULT_RULES.map((r) => ({
    key: `rule_${String(r.category).replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, '_')}`,
    category: r.category,
    label: r.category,
    enabled: true
  }))
};
