export function buildOpsFeedback(task, completedAt, photoCount, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const contentVerified = !!opts.contentVerified;

  let score = contentVerified ? 5 : 3;
  const dueAt = new Date(task?.due_at || 0);
  const required = Math.max(1, Number(task?.required_photos || 1));
  if (Number.isFinite(dueAt.getTime()) && completedAt > dueAt) score -= 1;
  if (photoCount < required) score -= 2;
  if (photoCount === required) score -= 0;
  if (photoCount > required) score += 0;
  score = Math.max(1, Math.min(5, score));

  const lateText = Number.isFinite(dueAt.getTime()) && completedAt > dueAt ? '本次提交晚于计划时间，' : '';
  const photoText = photoCount < required
    ? `照片不足（需${required}张，实传${photoCount}张），`
    : '照片数量达标，';

  if (!contentVerified) {
    const feedback = `${lateText}${photoText}系统当前仅校验“时间与照片张数”，尚未校验图片内容与任务是否匹配。该结果仅供提醒，请由值班经理人工复核后再做评价。`;
    return { score, feedback, verificationStatus: 'unverified' };
  }

  const feedback = `${lateText}${photoText}图片内容与任务匹配，执行情况良好。下一次请按检查项逐条拍摄并备注异常点。`;
  return { score, feedback, verificationStatus: 'verified' };
}
