/**
 * Compatibility shim — route/service logic in server/domains/training/*.
 * ensureTrainingSchema stays here: domains/ 禁止 ensure* + CREATE TABLE（DDL 冻结门禁）。
 */
import { pool } from './domains/training/shared.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'training', handler: 'schema' });

export {
  getPromotionRequiredTopics,
  createTrainingAssignment,
  getPromotionTrackProgress,
  getCrossTrackTechnicianStatus,
  getMyDevelopmentMap,
} from './domains/training/service.js';

export { registerTrainingRoutes } from './domains/training/routes.js';

export {
  runTrainingReminderSweep,
  runCertificationExpirySweep,
  startTrainingReminderScheduler,
} from './domains/training/scheduler.js';

export async function ensureTrainingSchema() {
  try {
    // 知识点表
    await pool().query(`
      CREATE TABLE IF NOT EXISTS training_topics (
        id SERIAL PRIMARY KEY,
        title VARCHAR(100) NOT NULL,
        position VARCHAR(50) NOT NULL,
        description TEXT,
        key_points JSONB DEFAULT '[]',
        practice_task TEXT,
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_by VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // 培训指派表
    await pool().query(`
      CREATE TABLE IF NOT EXISTS training_assignments (
        id SERIAL PRIMARY KEY,
        employee_username VARCHAR(100) NOT NULL,
        topic_id INT NOT NULL REFERENCES training_topics(id),
        assigned_by VARCHAR(100),
        due_date DATE,
        note TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(employee_username, topic_id)
      )
    `);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ta_employee ON training_assignments (employee_username)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ta_topic ON training_assignments (topic_id)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ta_due_date ON training_assignments (due_date)`);
    await pool().query(`ALTER TABLE training_assignments ADD COLUMN IF NOT EXISTS require_practice BOOLEAN DEFAULT false`);
    await pool().query(`ALTER TABLE training_assignments ADD COLUMN IF NOT EXISTS reminder_meta JSONB DEFAULT '{}'::jsonb`);

    // 学习会话表
    await pool().query(`
      CREATE TABLE IF NOT EXISTS training_sessions (
        id SERIAL PRIMARY KEY,
        employee_username VARCHAR(100) NOT NULL,
        topic_id INT NOT NULL REFERENCES training_topics(id),
        chat_history JSONB DEFAULT '[]',
        quiz_questions JSONB DEFAULT '[]',
        quiz_answers JSONB DEFAULT '[]',
        quiz_score INT,
        quiz_passed BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'learning',
        started_at TIMESTAMP DEFAULT NOW(),
        quiz_passed_at TIMESTAMP,
        UNIQUE(employee_username, topic_id)
      )
    `);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ts_employee ON training_sessions (employee_username)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ts_topic ON training_sessions (topic_id)`);

    // 认证记录表
    await pool().query(`
      CREATE TABLE IF NOT EXISTS training_certifications (
        id SERIAL PRIMARY KEY,
        session_id INT NOT NULL REFERENCES training_sessions(id),
        employee_username VARCHAR(100) NOT NULL,
        topic_id INT NOT NULL,
        media_url VARCHAR(500),
        media_type VARCHAR(20),
        ai_verdict VARCHAR(20),
        ai_feedback TEXT,
        ai_raw_response JSONB,
        manager_verdict VARCHAR(20),
        manager_note TEXT,
        manager_reviewed_by VARCHAR(100),
        certified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_tc_session ON training_certifications (session_id)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_tc_employee ON training_certifications (employee_username)`);

    // 关联知识库文章（多选）
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS kb_article_ids UUID[] DEFAULT '{}'`);
    // 门店归属（空=全部门店可见）
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS store VARCHAR(100) DEFAULT ''`);
    // 允许同一员工对同一知识点有多次指派（移除唯一约束）
    await pool().query(`ALTER TABLE training_assignments DROP CONSTRAINT IF EXISTS training_assignments_employee_username_topic_id_key`);
    // AI 智能解析缓存（生成一次，全员复用）
    await pool().query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS ai_explanation TEXT`);
    // 管理员手动编辑锁：锁定后自动生成不得覆盖（管理员通过"重新生成"解锁）
    await pool().query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS ai_explanation_locked BOOLEAN DEFAULT false`);
    // 考试历史记录（每次提交均追加）
    await pool().query(`ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS quiz_history JSONB DEFAULT '[]'`);

    // ── 实操图谱评分（2026-05-23新增）──
    await pool().query(`ALTER TABLE knowledge_base ADD COLUMN IF NOT EXISTS step_rubric JSONB`);
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS step_rubric JSONB`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS ai_step_scores JSONB`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS ai_total_score INT`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'pending'`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS manager_score INT`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS final_score INT`);

    // ── 知识库 AI解析/步骤图谱 修改记录（2026-06-11新增，留痕便于追溯与回滚）──
    await pool().query(`
      CREATE TABLE IF NOT EXISTS knowledge_edit_history (
        id BIGSERIAL PRIMARY KEY,
        knowledge_id UUID NOT NULL,
        field VARCHAR(32) NOT NULL,
        old_value TEXT,
        new_value TEXT,
        editor VARCHAR(100),
        editor_role VARCHAR(50),
        edited_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_keh_knowledge ON knowledge_edit_history (knowledge_id, edited_at DESC)`);

    // ── 培训-晋升一体化（2026-06-13新增）──
    // 知识点：是否作为对应岗位的晋升能力要求项 + 认证有效期（天）
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS promotion_required BOOLEAN DEFAULT false`);
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS validity_days INT DEFAULT 180`);
    // 晋升等级（如 三砧/二砧/头砧、见习镬/二镬/头镬、L1/L2/L3、储备/正式 等），与 position 一起确定该知识点是哪个岗位+级别的晋升要求
    await pool().query(`ALTER TABLE training_topics ADD COLUMN IF NOT EXISTS level VARCHAR(20)`);
    // 指派来源（manual/anomaly_trigger/promotion_qualification/recert）+ 关联晋升记录
    await pool().query(`ALTER TABLE training_assignments ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'manual'`);
    await pool().query(`ALTER TABLE training_assignments ADD COLUMN IF NOT EXISTS related_track_id VARCHAR(64)`);
    await pool().query(`CREATE INDEX IF NOT EXISTS idx_ta_related_track ON training_assignments (related_track_id)`);
    // 认证有效期与状态（valid/expired/under_review）
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS valid_until DATE`);
    await pool().query(`ALTER TABLE training_certifications ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'valid'`);

    log.info({ msg: 'schema_ensured' });
  } catch (e) {
    log.error({ msg: 'schema_error', err: e?.message });
  }
}
