/**
 * 培训实操认证审核人解析（谁可以审、待审列表过滤）。
 * 手动指派：谁派发谁审核。
 * 自动派发（晋升/复训/异常）：带教人/assigned_by，兜底同门店出品经理或店长。
 */
import { createTrainingUserNotification } from './shared.js';
export const AUTO_ASSIGN_SOURCES = new Set([
  'promotion_qualification',
  'promotion_formal',
  'recert',
  'anomaly_trigger',
]);

const STORE_REVIEWER_ROLES = ['store_production_manager', 'store_manager'];

/**
 * @param {import('pg').Pool | { query: Function }} pool
 */
export async function resolveStoreTrainingReviewer(pool, employeeUsername, tenantId = 'default') {
  const username = String(employeeUsername || '').trim();
  const tid = String(tenantId || 'default').trim() || 'default';
  if (!username) return '';

  try {
    const empRow = await pool.query(
      `SELECT store FROM employees WHERE lower(username) = lower($1) AND tenant_id = $2 LIMIT 1`,
      [username, tid]
    );
    const store = String(empRow.rows[0]?.store || '').trim();
    if (!store) return '';

    const mgrRow = await pool.query(
      `SELECT username, position FROM employees
       WHERE store = $1 AND tenant_id = $2
         AND role IN ('store_production_manager', 'store_manager')
         AND COALESCE(status, '') NOT IN ('离职', 'inactive')
       ORDER BY CASE WHEN position ~ '出品经理|厨师长' THEN 0 ELSE 1 END,
                CASE WHEN role = 'store_production_manager' THEN 0 ELSE 1 END
       LIMIT 1`,
      [store, tid]
    );
    return String(mgrRow.rows[0]?.username || '').trim();
  } catch {
    return '';
  }
}

/**
 * @param {import('pg').Pool | { query: Function }} pool
 */
export async function findLatestTrainingAssignment(pool, { employeeUsername, topicId, tenantId = 'default' }) {
  const emp = String(employeeUsername || '').trim();
  const tid = String(tenantId || 'default').trim() || 'default';
  if (!emp || !topicId) return null;

  const r = await pool.query(
    `SELECT id, assigned_by, source, related_track_id, note
     FROM training_assignments
     WHERE lower(employee_username) = lower($1) AND topic_id = $2 AND tenant_id = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [emp, topicId, tid]
  );
  return r.rows[0] || null;
}

/**
 * @param {import('pg').Pool | { query: Function }} pool
 */
export async function resolveCertificationReviewers(pool, { employeeUsername, topicId, tenantId = 'default' }) {
  const assignment = await findLatestTrainingAssignment(pool, { employeeUsername, topicId, tenantId });
  const source = String(assignment?.source || 'manual').trim();
  const assignedBy = String(assignment?.assigned_by || '').trim();
  const reviewers = new Set();

  if (assignedBy) reviewers.add(assignedBy);

  if (AUTO_ASSIGN_SOURCES.has(source) || !assignedBy) {
    const fallback = await resolveStoreTrainingReviewer(pool, employeeUsername, tenantId);
    if (fallback) reviewers.add(fallback);
  }

  return {
    assignment,
    source,
    assignedBy,
    reviewers: [...reviewers].filter(Boolean),
  };
}

/**
 * @param {import('pg').Pool | { query: Function }} pool
 */
export async function isSameStoreManagerReviewer(pool, reviewerUsername, employeeUsername, tenantId = 'default') {
  const reviewer = String(reviewerUsername || '').trim();
  const employee = String(employeeUsername || '').trim();
  const tid = String(tenantId || 'default').trim() || 'default';
  if (!reviewer || !employee) return false;

  const r = await pool.query(
    `SELECT 1
     FROM employees ce
     JOIN employees re ON re.store = ce.store AND re.tenant_id = ce.tenant_id
     WHERE lower(ce.username) = lower($1)
       AND lower(re.username) = lower($2)
       AND re.role IN ('store_production_manager', 'store_manager')
       AND COALESCE(re.status, '') NOT IN ('离职', 'inactive')
       AND ce.tenant_id = $3
     LIMIT 1`,
    [employee, reviewer, tid]
  );
  return r.rows.length > 0;
}

/**
 * @param {import('pg').Pool | { query: Function }} pool
 */
export async function canUserReviewCertification(pool, {
  reviewerUsername,
  reviewerRole,
  employeeUsername,
  topicId,
  tenantId = 'default',
}) {
  const role = String(reviewerRole || '').trim();
  const reviewer = String(reviewerUsername || '').trim();
  if (!reviewer) return false;
  if (role === 'admin' || role === 'hq_manager') return true;

  const { assignedBy, source, reviewers } = await resolveCertificationReviewers(pool, {
    employeeUsername,
    topicId,
    tenantId,
  });

  if (reviewers.some((u) => u.toLowerCase() === reviewer.toLowerCase())) return true;
  if (assignedBy && assignedBy.toLowerCase() === reviewer.toLowerCase()) return true;

  if (AUTO_ASSIGN_SOURCES.has(source) || !assignedBy) {
    return isSameStoreManagerReviewer(pool, reviewer, employeeUsername, tenantId);
  }

  return false;
}

/** SQL fragment + params for pending list (non admin/hq). */
export function buildPendingCertificationAssignerFilter(reviewerUsername) {
  const reviewer = String(reviewerUsername || '').trim();
  const autoSources = [...AUTO_ASSIGN_SOURCES];
  return {
    sql: `AND EXISTS (
      SELECT 1 FROM training_assignments a2
      WHERE a2.employee_username = c.employee_username
        AND a2.topic_id = c.topic_id
        AND a2.tenant_id = c.tenant_id
        AND (
          lower(a2.assigned_by) = lower($2)
          OR (
            a2.source = ANY($3::text[])
            AND EXISTS (
              SELECT 1 FROM employees ce
              JOIN employees re ON re.store = ce.store AND re.tenant_id = ce.tenant_id
              WHERE lower(ce.username) = lower(c.employee_username)
                AND lower(re.username) = lower($2)
                AND re.role = ANY($4::text[])
                AND COALESCE(re.status, '') NOT IN ('离职', 'inactive')
            )
          )
          OR (
            a2.assigned_by IS NULL
            AND EXISTS (
              SELECT 1 FROM employees ce
              JOIN employees re ON re.store = ce.store AND re.tenant_id = ce.tenant_id
              WHERE lower(ce.username) = lower(c.employee_username)
                AND lower(re.username) = lower($2)
                AND re.role = ANY($4::text[])
                AND COALESCE(re.status, '') NOT IN ('离职', 'inactive')
            )
          )
        )
    )`,
    extraParams: [reviewer, autoSources, STORE_REVIEWER_ROLES],
  };
}

/** 员工提交实操后通知审核人（带教人/派发人/门店负责人） */
export async function notifyCertificationReviewersPending({
  pool: poolRef,
  employeeUsername,
  topicId,
  topicTitle,
  tenantId,
  certificationId,
}) {
  const { reviewers } = await resolveCertificationReviewers(poolRef, {
    employeeUsername,
    topicId,
    tenantId,
  });
  if (!reviewers.length) return;

  const empRes = await poolRef.query(
    `SELECT name FROM employees WHERE lower(username) = lower($1) LIMIT 1`,
    [employeeUsername]
  );
  const empName = String(empRes.rows[0]?.name || employeeUsername).trim();
  const title = '培训实操待审核';
  const message = `${empName} 已提交「${topicTitle || '培训'}」实操认证，请尽快审核确认。`;

  for (const reviewer of reviewers) {
    await createTrainingUserNotification(reviewer, title, message, {
      type: 'training_practice_review',
      certification_id: certificationId,
      employee_username: employeeUsername,
      topic_id: topicId,
    });
  }
}
