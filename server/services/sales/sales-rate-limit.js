/**
 * 内存级限流：不引入新依赖，只是给敏感只读接口(线索详情/时间线/续费健康度/提成等)加一道
 * "连续遍历自增ID"的粗粒度防护。单进程内存计数，重启清零——这符合当前部署规模，
 * 不是为了防护专业攻击者，是为了不让一次失误的脚本/被盗账号短时间内拖走全部客户数据。
 */
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60; // 每人每路由族每分钟最多60次，正常人工操作不会碰到这个量级
const buckets = new Map();
let lastSweep = Date.now();

function sweepIfNeeded(now) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart > WINDOW_MS) buckets.delete(key);
  }
}

/** routeFamily 用来把同一类接口(比如所有 leads/:id/xxx)算进同一个桶，而不是按具体ID分别计数 */
export function sensitiveRateLimit(routeFamily) {
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    sweepIfNeeded(now);
    const username = req.platformAdmin?.username || req.ip || 'anonymous';
    const key = `${routeFamily}:${username}`;
    let entry = buckets.get(key);
    if (!entry || now - entry.windowStart > WINDOW_MS) {
      entry = { windowStart: now, count: 0 };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > MAX_PER_WINDOW) {
      console.warn(`[sales-rate-limit] ${username} 在 ${routeFamily} 上1分钟内请求${entry.count}次，已限流`);
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }
    next();
  };
}
