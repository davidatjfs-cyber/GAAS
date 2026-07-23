// 解析生日字段，返回 { month, day } 或 null
export function parseBirthdayMonthDay(birthday) {
  const s = String(birthday || '').trim();
  if (!s) return null;
  // 支持格式: YYYY-MM-DD, MM-DD, YYYY/MM/DD, MM/DD
  const match = s.match(/(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

// 获取下个月的年月
export function getNextMonth(today) {
  const y = today.getFullYear();
  const m = today.getMonth() + 1; // 1-12
  if (m === 12) return { year: y + 1, month: 1 };
  return { year: y, month: m + 1 };
}

// 检查是否是月底（当月最后3天）
export function isEndOfMonth(today) {
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return today.getDate() >= lastDay - 2;
}
