/**
 * BI/Ops 运行时配置默认值（P2 peel from agents.js）。
 * 故意不复用 agent-config-manager 的 DEFAULT_*（两边默认值不完全一致）。
 */

export const INITIAL_BI_AGENT_CONFIG = {
  dataSources: [
    { key: 'daily_reports', enabled: true },
    { key: 'table_visit_records', enabled: true },
    { key: 'table_visit_bitable', enabled: true },
    { key: 'opening_reports_bitable', enabled: true },
    { key: 'closing_reports_bitable', enabled: true },
    { key: 'meeting_reports_bitable', enabled: true },
    { key: 'bad_reviews', enabled: true },
    { key: 'material_majixian_bitable', enabled: true },
    { key: 'material_hongchao_bitable', enabled: true },
    { key: 'ops_checklist_bitable', enabled: true },
    { key: 'loss_reports_bitable', enabled: true },
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
      rechargeStreakHighDays: 2,
    },
    storeOverrides: {},
  },
};

export const INITIAL_OPS_AGENT_CONFIG = {
  llmModels: {
    reasoningModel: 'deepseek-chat',
    visionModel: 'ep-20260424183833-7lr9g',
  },
  scheduledTasks: {
    dailyInspections: [],
    randomInspections: [],
    dataTriggers: {
      productComplaintThreshold: 2,
      marginDeviationThreshold: 0.01,
      tableVisitRatioThreshold: 0.50,
    },
  },
  visualInspection: {
    environment: {
      floorWater: 'detect_water_or_oil_on_floor',
      trashCovered: 'trash_bin_lid_closed',
      lightingAdequate: 'lighting_sufficient_for_clear_photos',
    },
    product: {
      platingAesthetics: '洪潮切配摆盘美学标准',
      portionSize: '分量是否达标',
      garnishPlacement: '装饰配菜摆放规范',
    },
    materials: {
      fridgeLabelExpiry: '冰箱标签是否过期',
      rawCookedSeparation: '生熟分装检查',
      storageTemperature: '储存温度合规',
    },
    accuracyThresholds: {
      labelClarity: 0.8,
      foodCoverage: 0.9,
      photoQuality: 0.85,
    },
  },
  loopManagement: {
    followUpRules: {
      firstReminder: 60,
      secondReminder: 90,
      escalationDelay: 120,
      maxReminders: 3,
    },
    logicValidation: {
      photoLocationRadius: 500,
      exifTimeTolerance: 5,
      hashDuplicateCheck: true,
      dataConsistency: true,
    },
  },
  judgmentStandards: {
    timeliness: {
      readDeadline: 15,
      responseDeadline: 60,
      latePenalty: 'mark_slow_response',
    },
    authenticity: {
      locationRadius: 500,
      exifTolerance: 300,
      hashCheck: true,
      fraudAction: 'block_and_report',
    },
    visualAccuracy: {
      minClarity: 0.8,
      minCoverage: 0.9,
      poorQualityResponse: '环境光线不足，请打开补光灯重拍',
    },
    logicConsistency: {
      dataTolerance: 0.1,
      inconsistencyResponse: '检测到数据偏差较大，请核实后再提交',
    },
  },
  knowledgeSupport: {
    sopQueryRules: {
      productQuality: '产品质量问题处理流程',
      ingredientHandling: '食材处理标准',
      equipmentOperation: '设备操作规范',
      emergencyProcedures: '紧急情况处理',
    },
    standardResponses: {
      smallOysters: '根据洪潮验收SOP第3条，超过20%不达标需拍图留存并做退货登记。请拍摄对比照片。',
      fridgeTemperature: '冰箱温度应保持在4°C以下，请检查温控设置并记录当前温度。',
      handWashing: '洗手必须满20秒，请使用洗手液并冲洗至手腕部位。',
    },
  },
};
