/**
 * Ops scheduled inspections + bad-review data triggers (P19 peel from agents.js).
 */

/**
 * @param {object} deps
 * @param {() => { scheduledTasks: object }} deps.getOpsAgentConfig
 * @param {() => Date} [deps.now]
 */
export function createScheduleOpsTasks(deps) {
  const { getOpsAgentConfig, now = () => new Date() } = deps;
  return async function scheduleOpsTasks() {
    const config = getOpsAgentConfig().scheduledTasks;
    const current = now();
    const currentTime = `${String(current.getHours()).padStart(2, '0')}:${String(current.getMinutes()).padStart(2, '0')}`;
    const scheduledTasks = [];
    for (const inspection of config.dailyInspections || []) {
      if (inspection.time === currentTime) {
        const storeName = String(inspection?.store || '').trim();
        if (!storeName) continue;
        scheduledTasks.push({
          type: 'daily_inspection',
          brand: String(inspection?.brand || '').trim(),
          store: storeName,
          inspectionType: inspection.type,
          checklist: inspection.checklist,
          scheduledTime: current.toISOString(),
        });
      }
    }
    return scheduledTasks;
  };
}

/**
 * @param {object} deps
 * @param {() => { scheduledTasks: { dataTriggers: object } }} deps.getOpsAgentConfig
 * @param {() => { query: Function }} deps.pool
 * @param {{ error: Function }} deps.log
 */
export function createCheckDataTriggers(deps) {
  const { getOpsAgentConfig, pool, log } = deps;
  return async function checkDataTriggers() {
    const config = getOpsAgentConfig().scheduledTasks.dataTriggers;
    const triggers = [];
    try {
      const recentComplaints = await pool().query(
        `
      SELECT store, product_name, COUNT(*) as complaint_count
      FROM bad_reviews 
      WHERE review_type = 'product' 
        AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY store, product_name
      HAVING COUNT(*) >= $1
    `,
        [config.productComplaintThreshold]
      );

      for (const complaint of recentComplaints.rows) {
        triggers.push({
          type: 'product_complaints',
          store: complaint.store,
          product: complaint.product_name,
          count: complaint.complaint_count,
          action: 'check_production_process',
        });
      }
    } catch (e) {
      log.error('[ops_supervisor] data trigger check failed:', e?.message);
    }
    return triggers;
  };
}
