/**
 * 增长方案观察期扫描与定时调度（外提自 growth-solutions.js）。
 */
import { OBSERVATION_DAYS } from './constants.js';
import { ymd } from './metrics-helpers.js';

export async function runSolutionSweep(deps) {
  const { getPool, generateReview, notify, log } = deps;
  const active = await getPool().query(`SELECT * FROM growth_solution_rounds WHERE status = 'active'`);
  for (const round of active.rows) {
    const overdue = await getPool().query(
      `UPDATE growth_solution_tasks
       SET reminder_count = reminder_count + 1, last_reminded_at = NOW()
       WHERE round_id = $1 AND status <> 'done' AND due_date < CURRENT_DATE
         AND (last_reminded_at IS NULL OR last_reminded_at::date < CURRENT_DATE)
       RETURNING title, assignee_name, assignee_username, due_date, reminder_count`,
      [round.id]
    );
    if (overdue.rows.length) {
      const lines = overdue.rows
        .map(
          (t) =>
            `· ${t.title} — ${t.assignee_name || t.assignee_username},截止 ${String(t.due_date).slice(0, 10)},第 ${t.reminder_count} 次催促`
        )
        .join('\n');
      await notify(
        `【增长方案·逾期催促】${round.store}「${round.problem_title}」第${round.round_no}轮有 ${overdue.rows.length} 项任务逾期未完成:\n${lines}\n催促次数将如实写入复盘报告。`
      );
    }
    const t = await getPool().query(
      `SELECT COUNT(*) FILTER (WHERE status <> 'done') AS open, COUNT(*) AS total
       FROM growth_solution_tasks WHERE round_id = $1`,
      [round.id]
    );
    if (Number(t.rows[0].total) > 0 && Number(t.rows[0].open) === 0) {
      const measureEnd = ymd(new Date(Date.now() + OBSERVATION_DAYS * 86400000));
      await getPool().query(
        `UPDATE growth_solution_rounds SET status='observing', tasks_done_at=NOW(), measure_end_date=$2 WHERE id=$1`,
        [round.id, measureEnd]
      );
      await notify(
        `【增长方案】${round.store}「${round.problem_title}」第${round.round_no}轮任务全部完成,进入${OBSERVATION_DAYS}天观察期,${measureEnd} 自动复盘。`
      );
    }
  }
  const observing = await getPool().query(
    `SELECT * FROM growth_solution_rounds WHERE status = 'observing' AND measure_end_date <= CURRENT_DATE`
  );
  for (const round of observing.rows) {
    try {
      const review = await generateReview(round);
      await getPool().query(
        `UPDATE growth_solution_rounds
         SET status='reviewing', actual_value=$2, achievement_rate=$3, review_report=$4 WHERE id=$1`,
        [round.id, review.actual_value, review.achievement_rate, JSON.stringify(review.report)]
      );
      await notify(
        `【增长方案·复盘】${round.store}「${round.problem_title}」第${round.round_no}轮:目标 ${round.target_value}${round.unit},实际 ${review.actual_value}${round.unit},达成率 ${(review.achievement_rate * 100).toFixed(1)}%(${review.success ? '达成✅' : '未达成'})。请在经营诊断页确认下一步。`
      );
    } catch (e) {
      log.error({ msg: 'review_failed', round_id: round.id, err: e?.message });
    }
  }
}

let _sweepTimer = null;

/** @internal test-only */
export function __resetSolutionSweepSchedulerForTests() {
  if (_sweepTimer) clearInterval(_sweepTimer);
  _sweepTimer = null;
}

export function startSolutionSweepScheduler(runSweep) {
  if (_sweepTimer) return;
  _sweepTimer = setInterval(() => {
    runSweep().catch(() => {});
  }, 6 * 3600 * 1000);
  setTimeout(() => {
    runSweep().catch(() => {});
  }, 60 * 1000);
}
