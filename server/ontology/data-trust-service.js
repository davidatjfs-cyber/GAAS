/**
 * Data Trust Engine：决定"哪些数据配进基准库/AI推理"的可信度评分系统。
 * 核心原则：任何一条"自证"数据(员工自己拍照/自己打分)不能直接当事实，
 * 必须经过至少一个独立信号交叉验证过，trust_score才可能达到"能进Benchmark"的门槛。
 *
 * 七个维度加权(合计100%)，权重按"越难造假的信号权重越高"排序：
 *   cross_source(30%) > source(25%) > spatial(15%) > temporal(10%) = behavior(10%)
 *   > statistical(5%) = historical(5%)
 */

export const TRUST_WEIGHTS = {
  source: 0.25,
  temporal: 0.10,
  spatial: 0.15,
  crossSource: 0.30,
  behavior: 0.10,
  statistical: 0.05,
  historical: 0.05,
};

// 数据来源可信度基线：来源越客观(系统自动产生、不经人手)，起点分越高。
export const SOURCE_TRUST_WEIGHTS = {
  pos_order: 100,
  payment_flow: 100,
  wecom_message: 95,
  crm_member: 95,
  gps: 90,
  camera_ai: 90,
  system_generated: 90,
  qr_scan: 85,
  manager_confirmation: 80,
  employee_upload: 60,
  employee_manual_entry: 50,
  free_text_note: 30,
};

function sourceTrustScore(sourceType) {
  return SOURCE_TRUST_WEIGHTS[String(sourceType || '').trim()] ?? 50; // 未知来源给中性偏低分，不给满分也不给0
}

/**
 * 时间可信：自报的完成时间跟其它可验证时间信号(GPS时间戳/照片EXIF/系统事件时间)是否对得上。
 * input.temporalConflicts: 数组，每项 { type, penalty }，比如 GPS显示当时人在别处 -40。
 */
function temporalScore(input = {}) {
  const conflicts = Array.isArray(input.temporalConflicts) ? input.temporalConflicts : [];
  if (!conflicts.length) return 100;
  const totalPenalty = conflicts.reduce((sum, c) => sum + (Number(c.penalty) || 0), 0);
  return Math.max(0, 100 - totalPenalty);
}

/**
 * 空间可信：GPS/WiFi/蓝牙Beacon/门店摄像头/排班地点是否互相印证。
 * input.spatialDistanceMeters: 打卡GPS距门店实际距离(米)；超过阈值扣分。
 * input.spatialConflicts: 额外冲突信号(如POS登录地和GPS地不一致)。
 */
function spatialScore(input = {}) {
  let score = 100;
  const dist = Number(input.spatialDistanceMeters);
  if (Number.isFinite(dist)) {
    if (dist > 1000) score -= 60;
    else if (dist > 300) score -= 40;
    else if (dist > 100) score -= 15;
  }
  const conflicts = Array.isArray(input.spatialConflicts) ? input.spatialConflicts : [];
  score -= conflicts.reduce((sum, c) => sum + (Number(c.penalty) || 0), 0);
  return Math.max(0, score);
}

/**
 * 多源一致性：这是权重最高的一维，命中的冲突规则(见 CONFLICT_MATRIX)直接决定这块分数。
 * input.crossSourceChecks: 数组，每项 { ruleId, result: 'consistent'|'conflict'|'neutral' }。
 */
function crossSourceScore(input = {}) {
  const checks = Array.isArray(input.crossSourceChecks) ? input.crossSourceChecks : [];
  if (!checks.length) return 50; // 没有任何交叉验证信号时给中性分，不给满分——没验证过不等于可信
  let score = 50;
  for (const check of checks) {
    const rule = getConflictRule(check.ruleId);
    const impact = rule?.impact ?? 15;
    if (check.result === 'consistent') score += impact;
    else if (check.result === 'conflict') score -= impact * 1.5; // 冲突的惩罚比一致的奖励更重
  }
  return Math.max(0, Math.min(100, score));
}

/**
 * 行为一致性：同一人/同一门店是否有"不可能"的行为模式(连续多天30秒完成全部任务、
 * 每天同一时间上传完全相同照片、照片哈希重复等)。
 * input.behaviorAnomalies: 数组，每项 { type, penalty }。
 */
function behaviorScore(input = {}) {
  const anomalies = Array.isArray(input.behaviorAnomalies) ? input.behaviorAnomalies : [];
  if (!anomalies.length) return 100;
  const totalPenalty = anomalies.reduce((sum, a) => sum + (Number(a.penalty) || 0), 0);
  return Math.max(0, 100 - totalPenalty);
}

/**
 * 统计异常：跟同类(同店/同岗位/同business_type分组)比是否显著偏离(比如全组唯一100%满意度)。
 * input.statisticalZScore: 与同组均值的标准差倍数，绝对值越大越可疑。
 */
function statisticalScore(input = {}) {
  const z = Math.abs(Number(input.statisticalZScore) || 0);
  if (z < 1.5) return 100;
  if (z < 2.5) return 70;
  if (z < 3.5) return 40;
  return 15;
}

/**
 * 历史信誉：这个人/这个门店过去的数据整体可信程度。
 * input.historicalTrustRate: 0-1，过去N条记录里被判定可信的比例。
 */
function historicalScore(input = {}) {
  const rate = input.historicalTrustRate;
  if (rate == null) return 80; // 没有历史记录(新员工/新门店)给一个中性偏高的起点分，不惩罚"新"
  return Math.max(0, Math.min(100, Number(rate) * 100));
}

/**
 * 冲突矩阵：v1先维护一小批高价值规则，设计上支持后续扩展到100-200条而不用改代码结构，
 * 只需要往这个数组里加对象。impact是命中"一致"时的加分幅度(冲突扣分=impact*1.5，见crossSourceScore)。
 */
export const CONFLICT_MATRIX = [
  { id: 'training_vs_complaint_rate', dataA: '培训完成', dataB: '投诉率', expectation: '应下降', impact: 15 },
  { id: 'training_vs_return_rate', dataA: '培训完成', dataB: '退菜率', expectation: '应下降', impact: 15 },
  { id: 'training_vs_positive_review', dataA: '培训完成', dataB: '好评率', expectation: '应上升', impact: 10 },
  { id: 'hygiene_task_vs_hygiene_complaint', dataA: '卫生检查完成', dataB: '卫生投诉', expectation: '应下降', impact: 20 },
  { id: 'maintenance_vs_fault_rate', dataA: '设备维修完成', dataB: '故障率', expectation: '应下降', impact: 15 },
  { id: 'campaign_sent_vs_attributed_orders', dataA: '营销触达', dataB: '归因订单', expectation: '应增加', impact: 15 },
  { id: 'new_dish_training_vs_new_dish_sales', dataA: '新品培训', dataB: '新品销量', expectation: '应增加', impact: 10 },
  { id: 'schedule_vs_pos_login', dataA: '员工排班', dataB: 'POS登录记录', expectation: '应一致', impact: 20 },
  { id: 'gps_vs_store_location', dataA: 'GPS定位', dataB: '门店实际位置', expectation: '应一致', impact: 25 },
  { id: 'revenue_vs_payment_flow', dataA: '营业额', dataB: '支付流水', expectation: '应一致', impact: 25 },
  { id: 'inventory_count_vs_purchase', dataA: '库存盘点', dataB: '采购记录', expectation: '应一致', impact: 15 },
  { id: 'employee_score_vs_actual_revenue', dataA: '员工绩效自评', dataB: '实际营业额贡献', expectation: '应一致', impact: 15 },
];

const CONFLICT_MATRIX_BY_ID = new Map(CONFLICT_MATRIX.map((r) => [r.id, r]));
export function getConflictRule(ruleId) {
  return CONFLICT_MATRIX_BY_ID.get(String(ruleId || '').trim()) || null;
}
export function listConflictRules() {
  return CONFLICT_MATRIX.map((r) => ({ ...r }));
}

/**
 * 综合信任分：0-100，非二元判断。input.sourceType 必填，其余维度缺失时按"中性/满分"兜底，
 * 不会因为某个信号没采集到就把分数拉到0——没有证据不等于有罪，但也不给无条件满分(见各分维度函数注释)。
 */
export function computeTrustScore(input = {}) {
  const breakdown = {
    source: sourceTrustScore(input.sourceType),
    temporal: temporalScore(input),
    spatial: spatialScore(input),
    crossSource: crossSourceScore(input),
    behavior: behaviorScore(input),
    statistical: statisticalScore(input),
    historical: historicalScore(input),
  };
  const score = Object.entries(TRUST_WEIGHTS).reduce(
    (sum, [dim, weight]) => sum + breakdown[dim] * weight,
    0
  );
  return { score: Math.round(score * 10) / 10, breakdown };
}

export function classifyConfidenceLevel(score) {
  if (score >= 90) return 'high';
  if (score >= 75) return 'medium';
  if (score >= 55) return 'low';
  if (score >= 30) return 'suspect';
  return 'conflict';
}

/**
 * AI最终使用规则：不同trust_score区间，数据被允许参与的AI环节完全不同。
 * 这是Data Trust Engine真正"生效"的地方——分数算出来不是摆设，是硬闸门。
 */
export function getUsagePolicy(score) {
  if (score >= 90) return { entersBenchmark: true, entersTraining: true, participatesPrediction: true, weight: 1.0, action: 'full_use' };
  if (score >= 75) return { entersBenchmark: true, entersTraining: true, participatesPrediction: true, weight: 0.6, action: 'reduced_weight' };
  if (score >= 55) return { entersBenchmark: false, entersTraining: false, participatesPrediction: false, weight: 0, action: 'display_only' };
  if (score >= 30) return { entersBenchmark: false, entersTraining: false, participatesPrediction: false, weight: 0, action: 'quarantine_pending_review' };
  return { entersBenchmark: false, entersTraining: false, participatesPrediction: false, weight: 0, action: 'flag_anomaly_audit' };
}

export async function recordDataQuality(pool, {
  dataId, dataType, tenantId, storeId, sourceType,
  temporalConflicts, spatialDistanceMeters, spatialConflicts,
  crossSourceChecks, behaviorAnomalies, statisticalZScore, historicalTrustRate,
}) {
  const { score, breakdown } = computeTrustScore({
    sourceType, temporalConflicts, spatialDistanceMeters, spatialConflicts,
    crossSourceChecks, behaviorAnomalies, statisticalZScore, historicalTrustRate,
  });
  const confidenceLevel = classifyConfidenceLevel(score);
  const conflictFlag = (crossSourceChecks || []).some((c) => c.result === 'conflict') || confidenceLevel === 'conflict';
  const conflictRuleIds = (crossSourceChecks || []).filter((c) => c.result === 'conflict').map((c) => c.ruleId);
  const verificationSources = (crossSourceChecks || []).map((c) => c.ruleId);

  const r = await pool.query(
    `INSERT INTO growth_ontology_data_quality
       (data_id, data_type, tenant_id, store_id, source_type, trust_score, confidence_level,
        conflict_flag, conflict_rules, verification_sources, score_breakdown, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,NOW())
     ON CONFLICT (data_id, data_type) DO UPDATE SET
       trust_score=EXCLUDED.trust_score, confidence_level=EXCLUDED.confidence_level,
       conflict_flag=EXCLUDED.conflict_flag, conflict_rules=EXCLUDED.conflict_rules,
       verification_sources=EXCLUDED.verification_sources, score_breakdown=EXCLUDED.score_breakdown,
       updated_at=NOW()
     RETURNING *`,
    [dataId, dataType, tenantId, storeId || null, sourceType, score, confidenceLevel,
      conflictFlag, JSON.stringify(conflictRuleIds), JSON.stringify(verificationSources), JSON.stringify(breakdown)]
  );
  return { ...r.rows[0], usagePolicy: getUsagePolicy(score) };
}
