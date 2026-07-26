/**
 * Ops 巡检提交校验 — 纯规则 helpers（P2 peel from agents.js）。
 */

export function extractScore(text) {
  if (!text) return 0;
  const match = text.match(/(\d+(?:\.\d+)?)\s*\/\s*10|评分[：:]\s*(\d+(?:\d+)?)/i);
  return match ? parseFloat(match[1] || match[2]) : 0;
}

export function validateSubmissionLogic(submission) {
  const issues = [];

  if (submission.checkType === '开档检查' && submission.checkStatus === '不合格') {
    if (!submission.checkRemark || submission.checkRemark.length < 10) {
      issues.push('不合格项需要详细说明原因');
    }
  }

  if (submission.checkPhotos && submission.checkPhotos.length > 0) {
    if (submission.checkRemark.includes('干净') && submission.checkPhotos.length === 0) {
      issues.push('描述环境干净但未提供照片验证');
    }
  }

  const submitHour = new Date(submission.submitTime).getHours();
  if (submission.checkType === '开档检查' && (submitHour < 8 || submitHour > 12)) {
    issues.push('开档检查时间异常，应在上午8-12点进行');
  }

  return {
    isValid: issues.length === 0,
    issues,
    suggestion: issues.length > 0 ? `检测到以下问题：${issues.join('；')}。请核实后重新提交。` : '',
  };
}
