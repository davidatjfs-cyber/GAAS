/**
 * 增长日报文本组装（从 growth-api.js 外提）。
 */
import { STORE_ID_TO_NAME } from '../../brands-config.js';

const GROWTH_STORE_CODE_TO_NAME = STORE_ID_TO_NAME;

export function cnHour(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return (d.getUTCHours() + 8) % 24;
}

export function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function growthStoreName(storeCode) {
  const k = String(storeCode || '').trim();
  return GROWTH_STORE_CODE_TO_NAME[k] || k;
}

export async function buildStoreReport(pool, storeCode, yd) {
  const dbd = shiftDate(yd, -1);
  const lwSame = shiftDate(yd, -7);

  function pct(a, b) {
    if (!b) return null;
    const v = ((a - b) / b) * 100;
    return (v >= 0 ? '▲' : '▼') + Math.abs(v).toFixed(1) + '%';
  }
  function fmtMoney(n) {
    return '¥' + Number(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  const [snapYd, snapDbd, snapLw, topDishes] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(revenue),0)::numeric AS rev, COALESCE(SUM(lunch_qty),0)::int AS lunch_qty, COALESCE(SUM(dinner_qty),0)::int AS dinner_qty
                FROM sales_growth_snapshot WHERE snapshot_date=$1 AND store_code=$2`,
      [yd, storeCode]
    ),
    pool.query(
      `SELECT COALESCE(SUM(revenue),0)::numeric AS rev FROM sales_growth_snapshot WHERE snapshot_date=$1 AND store_code=$2`,
      [dbd, storeCode]
    ),
    pool.query(
      `SELECT COALESCE(SUM(revenue),0)::numeric AS rev FROM sales_growth_snapshot WHERE snapshot_date=$1 AND store_code=$2`,
      [lwSame, storeCode]
    ),
    pool.query(
      `SELECT dish_name, revenue::numeric AS rev, qty AS qty FROM sales_growth_snapshot
                WHERE snapshot_date=$1 AND store_code=$2 AND dish_name IS NOT NULL AND dish_name<>''
                ORDER BY revenue DESC LIMIT 5`,
      [yd, storeCode]
    ),
  ]);

  const rev = Number(snapYd.rows[0]?.rev || 0);
  const prevRev = Number(snapDbd.rows[0]?.rev || 0);
  const lwRev = Number(snapLw.rows[0]?.rev || 0);
  const lunchQty = Number(snapYd.rows[0]?.lunch_qty || 0);
  const dinnerQty = Number(snapYd.rows[0]?.dinner_qty || 0);

  const [ordersYd, periodOrders, weekOrders, memberMiss] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM pos_orders
                WHERE biz_date=$1 AND store_id=$2 AND order_status NOT IN ('cancelled','voided')`,
      [yd, storeCode]
    ),
    pool.query(
      `SELECT order_time, amount_after_discount FROM pos_orders
                WHERE biz_date=$1 AND store_id=$2 AND order_status NOT IN ('cancelled','voided') AND order_time IS NOT NULL`,
      [yd, storeCode]
    ),
    pool.query(
      `SELECT biz_date, order_time, amount_after_discount FROM pos_orders
                WHERE biz_date >= $1 AND biz_date <= $2 AND store_id=$3
                  AND order_status NOT IN ('cancelled','voided') AND order_time IS NOT NULL
                ORDER BY biz_date ASC`,
      [lwSame, yd, storeCode]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM growth_customer_profiles
                WHERE (CURRENT_DATE - COALESCE(pos_last_order_at::date, NOW()::date)) BETWEEN 7 AND 20`
    ),
  ]);

  const orderCnt = Number(ordersYd.rows[0]?.cnt || 0);
  let lunchRev = 0,
    lunchCnt = 0,
    dinnerRev = 0,
    dinnerCnt = 0;
  for (const row of periodOrders.rows) {
    const h = cnHour(row.order_time);
    if (h == null) continue;
    const v = Number(row.amount_after_discount || 0);
    if (h >= 11 && h < 14) {
      lunchRev += v;
      lunchCnt++;
    }
    if (h >= 17 && h < 21) {
      dinnerRev += v;
      dinnerCnt++;
    }
  }

  const dayLunch = {};
  for (const row of weekOrders.rows) {
    const h = cnHour(row.order_time);
    if (h == null || h < 11 || h >= 14) continue;
    const k = String(row.biz_date).slice(0, 10);
    dayLunch[k] = (dayLunch[k] || 0) + Number(row.amount_after_discount || 0);
  }
  const lunchDays = Object.keys(dayLunch).sort().slice(-4);
  let lunchTrend = '';
  if (lunchDays.length >= 3) {
    const vals = lunchDays.map((d) => dayLunch[d]);
    const drops = vals.slice(1).filter((v, i) => v < vals[i]).length;
    if (drops >= 2) lunchTrend = `午市连续${drops + 1}天下滑 ⚠️`;
  }

  const missCount = Number(memberMiss.rows[0]?.cnt || 0);
  const totalRev = rev || 1;

  const lines = [
    `【增长日报 · ${growthStoreName(storeCode)} · ${yd}】`,
    '',
    '━━ 昨日销售 ━━',
    `总营收：${fmtMoney(rev)}  订单数：${orderCnt}单`,
    prevRev > 0 ? `环比昨日：${pct(rev, prevRev) || '-'}（前日${fmtMoney(prevRev)}）` : '环比昨日：暂无数据',
    lwRev > 0 ? `环比上周同期：${pct(rev, lwRev) || '-'}` : '环比上周同期：暂无数据',
  ];

  if (topDishes.rows.length) {
    lines.push('', '━━ TOP菜品（按营收）━━');
    ['①', '②', '③', '④', '⑤'].forEach((n, i) => {
      const r = topDishes.rows[i];
      if (!r) return;
      const clean = r.dish_name.replace(/[\d&（(【\[].{0,20}$/, '').trim() || r.dish_name.slice(0, 10);
      lines.push(`${n} ${clean.slice(0, 10).padEnd(10)}  ${fmtMoney(r.rev)}  ${Math.round(Number(r.qty))}单`);
    });
  }

  lines.push('', '━━ 时段分析 ━━');
  if (lunchCnt > 0)
    lines.push(
      `午市(11-14): ${fmtMoney(lunchRev)} / ${lunchCnt}单（占比${((lunchRev / totalRev) * 100).toFixed(0)}%）`
    );
  if (dinnerCnt > 0)
    lines.push(
      `晚市(17-21): ${fmtMoney(dinnerRev)} / ${dinnerCnt}单（占比${((dinnerRev / totalRev) * 100).toFixed(0)}%）`
    );
  if (!lunchCnt && !dinnerCnt) lines.push(`午市菜品${lunchQty}份 / 晚市菜品${dinnerQty}份（快照数据）`);

  lines.push('', '━━ 本周规律 ━━');
  lines.push(lunchTrend || '数据积累中，暂无规律');

  lines.push('', '━━ 今日建议 ━━');
  const sugg = [];
  if (lunchTrend) sugg.push('① 午市弱势，建议今日推荐单人套餐');
  if (topDishes.rows[0] && Number(topDishes.rows[0].qty) > 30)
    sugg.push(
      `${sugg.length ? '②' : '①'} ${topDishes.rows[0].dish_name.slice(0, 8)}昨日售出${Math.round(Number(topDishes.rows[0].qty))}单，接近上限，提前备货`
    );
  if (missCount > 0)
    sugg.push(
      `${['①', '②', '③'][sugg.length] || sugg.length + 1 + '.'} 有${missCount}名会员7天未到店，建议今日触达`
    );
  if (!sugg.length) sugg.push('① 今日经营正常，保持当前节奏');
  lines.push(...sugg);

  return lines.join('\n');
}

export async function buildGrowthDailyReport(pool, targetDate) {
  const yd =
    targetDate || shiftDate(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), -1);
  const storesRes = await pool.query(
    `SELECT DISTINCT store_code FROM sales_growth_snapshot WHERE snapshot_date=$1 ORDER BY store_code`,
    [yd]
  );
  if (!storesRes.rows.length) return `【增长日报 · ${yd}】\n暂无 ${yd} 的 POS 数据`;
  const reports = await Promise.all(storesRes.rows.map((r) => buildStoreReport(pool, r.store_code, yd)));
  return reports.join('\n\n' + '━'.repeat(20) + '\n\n');
}
