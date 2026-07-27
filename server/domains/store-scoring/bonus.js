/**
 * 奖金计算（纯函数）：门店评级 + 员工得分 → 奖金/工资系数。
 * 从 new-scoring-model.js 拆出。
 */
export function calculateBonus(brand, storeRating, employeeScore) {
  const bonusBase = brand === '洪潮' ? 2000 : 1500; // 马己仙1500, 洪潮2000
  
  if (!storeRating || storeRating === 'D') {
    // D级：工资8折（返回特殊标记，由薪资模块处理）
    return { bonus: 0, salaryMultiplier: 0.8, reason: '门店D级，工资8折' };
  }
  
  if (storeRating === 'C') {
    // C级：奖金归0
    return { bonus: 0, salaryMultiplier: 1.0, reason: '门店C级，奖金归0' };
  }
  
  // A/B级：按个人得分比例拿奖金
  const scoreRatio = (employeeScore || 100) / 100;
  const bonus = Math.round(scoreRatio * bonusBase);
  return { bonus, salaryMultiplier: 1.0, reason: `门店${storeRating}级，得分${employeeScore}，系数${scoreRatio.toFixed(2)}` };
}
