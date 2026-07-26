/**
 * 增长方案复盘报告生成（外提自 growth-solutions.js）。
 */
import { PROBLEMS } from './problems.js';
import { METRIC_WINDOW_DAYS, SUCCESS_RATE } from './constants.js';
import { daysAgo, round2, ymd } from './metrics-helpers.js';

export async function generateReview(getPool, computeMetric, getLlm, round) {
  const endDate = ymd(new Date());
  const startDate = daysAgo(METRIC_WINDOW_DAYS - 1);
  const metricKey = round.metric_key || round.problem_key;
  const metric = await computeMetric(metricKey, round.store, startDate, endDate);
  let actual = metric.value;
  if (PROBLEMS[metricKey]?.ladder?.type === 'count') {
    actual = Math.max(0, Number(round.baseline_value) - metric.value);
  }
  const target = Number(round.target_value) || 0;
  const rate = target > 0 ? actual / target : 0;
  const success = rate >= SUCCESS_RATE;

  const tasks = await getPool().query(
    `SELECT title, assignee_name, assignee_username, status, done_at, due_date, reminder_count
     FROM growth_solution_tasks WHERE round_id = $1 ORDER BY sort`,
    [round.id]
  );
  const today = new Date();
  const taskRows = tasks.rows.map((t) => {
    const due = t.due_date ? new Date(String(t.due_date).slice(0, 10) + 'T23:59:59') : null;
    const doneAt = t.done_at ? new Date(t.done_at) : null;
    let daysLate = 0;
    if (due && doneAt && doneAt > due) daysLate = Math.ceil((doneAt - due) / 86400000);
    if (due && !doneAt && today > due) daysLate = Math.ceil((today - due) / 86400000);
    return {
      title: t.title,
      assignee: t.assignee_name || t.assignee_username,
      assignee_username: t.assignee_username,
      status: t.status,
      done_at: t.done_at,
      due_date: t.due_date,
      on_time: due && doneAt ? doneAt <= due : (doneAt ? true : null),
      days_late: daysLate,
      reminder_count: Number(t.reminder_count || 0),
    };
  });

  const execFindings = [];
  const perPerson = new Map();
  for (const t of taskRows) {
    if (!perPerson.has(t.assignee)) {
      perPerson.set(t.assignee, {
        assignee: t.assignee,
        total: 0,
        done: 0,
        on_time: 0,
        late: 0,
        undone: 0,
        reminders: 0,
        max_days_late: 0,
      });
    }
    const p = perPerson.get(t.assignee);
    p.total += 1;
    p.reminders += t.reminder_count;
    if (t.status === 'done') {
      p.done += 1;
      if (t.on_time === false) {
        p.late += 1;
        p.max_days_late = Math.max(p.max_days_late, t.days_late);
        if (t.reminder_count > 0) {
          execFindings.push(`任务「${t.title}」责任人 ${t.assignee}:逾期 ${t.days_late} 天,系统催促 ${t.reminder_count} 次后才完成`);
        } else {
          execFindings.push(`任务「${t.title}」责任人 ${t.assignee}:逾期 ${t.days_late} 天完成`);
        }
      } else {
        p.on_time += 1;
      }
    } else {
      p.undone += 1;
      execFindings.push(
        `任务「${t.title}」责任人 ${t.assignee}:至复盘时仍未完成${t.days_late > 0 ? `(已逾期 ${t.days_late} 天` : '('}${t.reminder_count > 0 ? `,催促 ${t.reminder_count} 次无果)` : ')'}`
      );
    }
  }
  const doneCount = taskRows.filter((t) => t.status === 'done').length;
  const onTimeCount = taskRows.filter((t) => t.status === 'done' && t.on_time !== false).length;
  const execution = {
    total: taskRows.length,
    done: doneCount,
    on_time: onTimeCount,
    on_time_rate: taskRows.length ? Math.round((onTimeCount / taskRows.length) * 1000) / 10 : 0,
    per_person: Array.from(perPerson.values()),
    findings: execFindings,
    verdict:
      execFindings.length === 0
        ? '全部任务按时完成,本轮结果差异与执行力无关,可直接归因于方案本身。'
        : `本轮存在 ${execFindings.length} 项执行问题(见上),方案与结果的差异需优先从执行力找原因。`,
  };

  let attribution = `本轮共 ${taskRows.length} 项任务,已完成 ${doneCount} 项,按时完成率 ${execution.on_time_rate}%。`
    + `基线 ${round.baseline_value}${round.unit},目标 ${round.target_value}${round.unit},观察期实际 ${actual}${round.unit},达成率 ${(rate * 100).toFixed(1)}%。`;
  const llm = getLlm();
  if (llm) {
    try {
      const prompt = `你是餐厅经营分析师。请基于以下事实,用中文写一段150字以内的归因分析,要求:客观、直截了当、不留情面也不夸大。`
        + `必须明确回答:结果与目标的差异,多大程度是执行力问题(逾期/催促无果/未完成),多大程度是方案本身问题。有执行问题就点名说清,没有就明说执行到位。`
        + `⚠️ 归因只能基于下方传入的执行数据,禁止引入任何传入数据以外的推测原因（如节假日影响、天气因素、竞争对手等）。\n`
        + `问题:${round.problem_title};指标:${round.metric_label};基线:${round.baseline_value}${round.unit};目标:${round.target_value}${round.unit};实际:${actual}${round.unit};达成率:${(rate * 100).toFixed(1)}%\n`
        + `任务执行明细:${JSON.stringify(taskRows)}\n执行问题清单:${JSON.stringify(execFindings)}`;
      const llmText = await llm(prompt);
      if (llmText) attribution = String(llmText).trim();
    } catch {
      /* 用确定性文本兜底 */
    }
  }

  return {
    actual_value: round2(actual),
    achievement_rate: Math.round(rate * 10000) / 10000,
    success,
    report: {
      baseline: Number(round.baseline_value),
      target: Number(round.target_value),
      actual: round2(actual),
      achievement_rate: Math.round(rate * 1000) / 10,
      success,
      unit: round.unit,
      tasks: taskRows,
      execution,
      attribution,
      suggestion: success
        ? '达成目标,建议确认进入下一轮(新基线=本轮实际值,目标上一档)'
        : '未达成目标,建议同目标重跑一轮,系统将重组任务方案(未起效动作将被替换)',
      metric_snapshot: metric.detail,
      generated_at: new Date().toISOString(),
    },
  };
}
