/**
 * Store rating lookup for employee profile display (Wave A10b peel from agents.js).
 */

/** @internal exported for unit tests */
export function shanghaiCalendarYm(nowFn = Date.now) {
  return new Date(nowFn()).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 7);
}

/** @internal exported for unit tests */
export function shanghaiPrevCalendarYm(nowFn = Date.now) {
  const cur = shanghaiCalendarYm(nowFn);
  const [y, m] = cur.split('-').map((x) => parseInt(x, 10));
  let mm = m - 1;
  let yy = y;
  if (mm < 1) {
    mm = 12;
    yy -= 1;
  }
  return `${yy}-${String(mm).padStart(2, '0')}`;
}

/**
 * @param {object} deps
 * @returns {(storeLabel: string, lockedPeriodYm?: string|null) => Promise<object>}
 */
export function createFetchStoreRatingForProfileDisplay(deps) {
  const {
    pool,
    resolveAgentCanonicalStore,
    dailyReportIlikePatterns,
    feishuStoreSearchPatterns,
    nowFn = Date.now,
  } = deps;

  return async function fetchStoreRatingForProfileDisplay(storeLabel, lockedPeriodYm = null) {
    const raw = String(storeLabel || '').trim();
    if (!raw) return { rating: null, period: null };
    const canon = String(resolveAgentCanonicalStore(raw) || raw).trim();
    const patSets = [
      ...new Set([
        ...dailyReportIlikePatterns(raw),
        ...feishuStoreSearchPatterns(raw),
        ...dailyReportIlikePatterns(canon),
        ...feishuStoreSearchPatterns(canon),
      ]),
    ];
    const curYm = shanghaiCalendarYm(nowFn);
    const prevYm = shanghaiPrevCalendarYm(nowFn);
    const wantYm = String(lockedPeriodYm || '').trim() || prevYm;
    const strictPeriod = !!String(lockedPeriodYm || '').trim();

    const keys = [canon, raw].filter((k, i, a) => k && a.indexOf(k) === i);

    for (const key of keys) {
      const r = await pool().query(
        `SELECT rating, period FROM store_ratings WHERE store = $1 AND period = $2 LIMIT 1`,
        [key, wantYm]
      );
      if (r.rows?.[0]?.rating) return { rating: r.rows[0].rating, period: r.rows[0].period };
    }

    let r = await pool().query(
      `SELECT rating, period FROM store_ratings
     WHERE period = $1 AND store ILIKE ANY($2::text[])
     ORDER BY (actual_revenue > 0) DESC,
       actual_revenue DESC NULLS LAST,
       LENGTH(store) DESC NULLS LAST
     LIMIT 1`,
      [wantYm, patSets]
    );
    if (r.rows?.[0]?.rating) {
      return {
        rating: r.rows[0].rating,
        period: r.rows[0].period,
        requestedPeriod: wantYm,
        isFallback: false,
      };
    }

    if (strictPeriod) {
      for (const key of keys) {
        r = await pool().query(
          `SELECT rating, period FROM store_ratings
         WHERE store = $1 AND period <= $2
         ORDER BY period DESC NULLS LAST
         LIMIT 1`,
          [key, wantYm]
        );
        if (r.rows?.[0]?.rating) {
          const row = r.rows[0];
          return {
            rating: row.rating,
            period: row.period,
            requestedPeriod: wantYm,
            isFallback: row.period !== wantYm,
          };
        }
      }
      r = await pool().query(
        `SELECT rating, period FROM store_ratings
       WHERE store ILIKE ANY($1::text[]) AND period <= $2
       ORDER BY period DESC NULLS LAST,
         (actual_revenue > 0) DESC,
         actual_revenue DESC NULLS LAST,
         LENGTH(store) DESC NULLS LAST
       LIMIT 1`,
        [patSets, wantYm]
      );
      if (r.rows?.[0]?.rating) {
        const row = r.rows[0];
        return {
          rating: row.rating,
          period: row.period,
          requestedPeriod: wantYm,
          isFallback: row.period !== wantYm,
        };
      }
      return { rating: null, period: wantYm, requestedPeriod: wantYm, isFallback: false };
    }

    for (const key of keys) {
      r = await pool().query(
        `SELECT rating, period FROM store_ratings
       WHERE store = $1 AND period < $2
       ORDER BY period DESC NULLS LAST
       LIMIT 1`,
        [key, curYm]
      );
      if (r.rows?.[0]?.rating) return { rating: r.rows[0].rating, period: r.rows[0].period };
    }

    r = await pool().query(
      `SELECT rating, period FROM store_ratings
     WHERE store ILIKE ANY($1::text[]) AND period < $2
     ORDER BY period DESC NULLS LAST,
       (actual_revenue > 0) DESC,
       actual_revenue DESC NULLS LAST,
       LENGTH(store) DESC NULLS LAST
     LIMIT 1`,
      [patSets, curYm]
    );
    if (r.rows?.[0]?.rating) return { rating: r.rows[0].rating, period: r.rows[0].period };

    for (const key of keys) {
      r = await pool().query(
        `SELECT rating, period FROM store_ratings WHERE store = $1 ORDER BY period DESC NULLS LAST LIMIT 1`,
        [key]
      );
      if (r.rows?.[0]?.rating) return { rating: r.rows[0].rating, period: r.rows[0].period };
    }

    r = await pool().query(
      `SELECT rating, period FROM store_ratings
     WHERE store ILIKE ANY($1::text[])
     ORDER BY period DESC NULLS LAST,
       (actual_revenue > 0) DESC,
       actual_revenue DESC NULLS LAST,
       LENGTH(store) DESC NULLS LAST
     LIMIT 1`,
      [patSets]
    );
    const row = r.rows?.[0];
    return {
      rating: row?.rating || null,
      period: row?.period || null,
      requestedPeriod: wantYm,
      isFallback: !!(row?.period && row.period !== wantYm),
    };
  };
}
