import test from 'node:test';
import assert from 'node:assert/strict';
import { submitCalibration, calibrationStats } from '../calibration.js';

test('校准提交：一致率按 AI 分差 ≤10 计算', async () => {
  const calls = [];
  const pool = {
    query: async (sql) => {
      calls.push(sql.slice(0, 30));
      if (sql.includes('FROM customer_twin_coach_sessions')) {
        return { rows: [{ id: 1, skill_key: 'selling', ai_score: { 专业度: 80, 语气: 90, 应对: 70 } }] };
      }
      return { rows: [] };
    },
  };
  const r = await submitCalibration(pool, {
    sessionId: 1,
    adminUsername: 'admin',
    scores: { 专业度: 80, 语气: 50, 应对: 70 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.rate, 67);
  assert.equal(r.agreement.专业度, true);
  assert.equal(r.agreement.语气, false);
  assert.equal(r.agreement.应对, true);
});

test('校准统计：总次数/平均一致率/≥85% 条数', async () => {
  const pool = {
    query: async () => ({ rows: [{ total: 3, avg_rate: 90, above_85: 2 }] }),
  };
  const r = await calibrationStats(pool);
  assert.equal(r.ok, true);
  assert.equal(r.stats.total, 3);
  assert.equal(r.stats.above_85, 2);
});
