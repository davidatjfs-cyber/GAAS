import test from 'node:test';
import assert from 'node:assert/strict';
import { trainingDashboard, TRAIN_MANAGER_ROLES } from '../training-dashboard.js';

function memoryPool() {
  return {
    query: async (sql, _params) => {
      if (sql.includes('FROM hrms_state')) {
        return {
          rows: [{
            data: {
              employees: [
                { username: 'admin', name: '管理员', role: 'admin', store: '总部', position: '系统管理员', status: 'active' },
                { username: 'FOH1', name: '小张', role: 'store_employee', store: '洪潮大宁久光店', position: '前厅服务员', department: '前厅', status: 'active' },
                { username: 'FOH2', name: '小李', role: 'store_employee', store: '洪潮大宁久光店', position: '收银', department: '前厅', status: 'active' },
                { username: 'FOH3', name: '小吴', role: 'store_employee', store: '洪潮大宁久光店', position: '传菜', department: '前厅', status: 'inactive' },
                { username: 'K1', name: '大厨', role: 'store_employee', store: '洪潮大宁久光店', position: '炒锅', department: '后厨', status: 'active' },
                { username: 'OLD1', name: '离职员工', role: 'store_employee', store: '洪潮大宁久光店', position: '服务员', status: '离职' },
              ],
            },
          }],
        };
      }
      if (sql.includes('FROM customer_twin_coach_sessions')) {
        if (sql.includes(`status = 'active'`)) return { rows: [] };
        return {
          rows: [
            { username: 'FOH1', skill_key: 'selling', success: true, ai_score: { 专业度: 85, 语气: 85 }, finished_at: new Date().toISOString() },
            { username: 'FOH1', skill_key: 'selling', success: false, ai_score: { 专业度: 70, 语气: 70 }, finished_at: new Date(Date.now() - 10 * 86400000).toISOString() },
          ],
        };
      }
      if (sql.includes('FROM job_coach_skill_progress')) {
        return {
          rows: [
            { username: 'FOH1', skill_key: 'selling', level: 'normal', trained_count: 2, success_count: 1, updated_at: new Date().toISOString() },
          ],
        };
      }
      if (sql.includes('FROM job_coach_skills')) {
        return { rows: [{ skill_key: 'selling', label: '推销', sort_order: 10 }] };
      }
      if (sql.includes('FROM customer_twin_calibration')) {
        return { rows: [{ total: 2, avg_rate: 90, above_85: 2 }] };
      }
      return { rows: [] };
    },
  };
}

test('训练看板：只统计在职前厅人员并按门店/技能聚合', async () => {
  const r = await trainingDashboard(memoryPool(), { role: 'admin' });
  assert.equal(r.ok, true);
  assert.equal(r.totals.staff_count, 2, '后厨和离职不计入应训');
  assert.equal(r.totals.trained_staff, 1);
  assert.equal(r.totals.total_sessions, 2);
  assert.equal(r.totals.week_sessions, 1);
  assert.equal(r.totals.avg_score, 78);
  assert.equal(r.totals.pass_rate, 50);
  assert.equal(r.by_skill.length, 1);
  assert.equal(r.by_skill[0].pass_rate, 50);
  assert.equal(r.by_store.length, 1);
  assert.equal(r.not_trained.length, 1);
  assert.equal(r.not_trained[0].username, 'FOH2');
  assert.equal(r.attention.length, 1);
  assert.equal(r.attention[0].username, 'FOH2');
  assert.equal(r.attention[0].reasons.includes('从未参训'), true);
  assert.equal(r.staff_detail[0].recent_days.length, 7);
  assert.equal(r.totals.incomplete_sessions, 0);
  assert.equal(r.active_stars.length, 1);
  assert.equal(r.active_stars[0].username, 'FOH1');
  assert.equal(r.calibration.total, 2);
  assert.equal(r.calibration.avg_rate, 90);
});

test('训练看板：店长只看本店范围', async () => {
  const r = await trainingDashboard(memoryPool(), { role: 'store_manager', store: '马己仙上海音乐广场店' });
  assert.equal(r.totals.staff_count, 0);
  assert.equal(r.totals.total_sessions, 0);
});

test('训练看板：管理角色白名单', () => {
  assert.deepEqual(TRAIN_MANAGER_ROLES, ['admin', 'hq_manager', 'store_manager', 'store_production_manager', 'hr_manager']);
});
