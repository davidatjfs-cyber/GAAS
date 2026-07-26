/**
 * Table-visit metrics API (P2 peel from agents.js).
 */
import {
  loadTableVisitMetricsByStore as loadTableVisitMetricsByStoreBody,
  loadUnifiedTableVisitRowsByStore as loadUnifiedTableVisitRowsByStoreBody,
} from './table-visit-metrics-helpers.js';
import { extractTableVisitDishes } from './table-visit-metrics-pure.js';

/**
 * @param {object} deps
 */
export function createTableVisitMetricsApi(deps) {
  const loadUnified = (store, startDate, endDate) =>
    loadUnifiedTableVisitRowsByStoreBody(deps, store, startDate, endDate);

  return {
    loadUnifiedTableVisitRowsByStore: loadUnified,
    loadTableVisitMetricsByStore: (store, startDate, endDate) =>
      loadTableVisitMetricsByStoreBody(
        { ...deps, loadUnifiedTableVisitRowsByStore: loadUnified },
        store,
        startDate,
        endDate
      ),
    extractTableVisitDishes,
  };
}
