/**
 * 新评分模型API接口
 */

import { calculateStoreRating, calculateEmployeeScore } from './new-scoring-model.js';
import { inferBrandFromStoreName } from './agents.js';
import { pool } from './utils/database.js';
import { safeExecute } from './utils/error-handler.js';
import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'new-scoring', handler: 'api' });

// ─────────────────────────────────────────────
// 门店评级API
// ─────────────────────────────────────────────

export function registerNewScoringReadRoutes(app, authRequired) {

  app.get('/api/scoring/store-rating', authRequired, async (req, res) => {
    try {
      const { store, period } = req.query;
      
      if (!store || !period) {
        return res.status(400).json({ 
          error: 'missing_parameters',
          message: '需要提供 store 和 period 参数'
        });
      }
      
      const result = await safeExecute('store_rating_api', async () => {
        const brand = inferBrandFromStoreName(store);
        return await calculateStoreRating(store, brand, period);
      });
      
      if (!result) {
        return res.status(500).json({ 
          error: 'calculation_failed',
          message: '门店评级计算失败'
        });
      }
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      log.error({ msg: 'api_store_rating_error', err: error?.message || String(error) });
      res.status(500).json({ 
        error: 'server_error',
        message: error.message
      });
    }
  });
  
  // 获取员工评分
  app.get('/api/scoring/employee-score', authRequired, async (req, res) => {
    try {
      const { store, username, role, period } = req.query;
      
      if (!store || !username || !role || !period) {
        return res.status(400).json({ 
          error: 'missing_parameters',
          message: '需要提供 store, username, role 和 period 参数'
        });
      }
      
      const result = await safeExecute('employee_score_api', async () => {
        return await calculateEmployeeScore(store, username, role, period);
      });
      
      if (!result) {
        return res.status(500).json({ 
          error: 'calculation_failed',
          message: '员工评分计算失败'
        });
      }
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      log.error({ msg: 'api_employee_score_error', err: error?.message || String(error) });
      res.status(500).json({ 
        error: 'server_error',
        message: error.message
      });
    }
  });
  
  // 获取营业日报数据
  app.get('/api/scoring/daily-reports', authRequired, async (req, res) => {
    try {
      const { store, start, end } = req.query;
      
      let query = 'SELECT * FROM daily_reports WHERE 1=1';
      const params = [];
      
      if (store) {
        query += ' AND store = $1';
        params.push(store);
      }
      
      if (start) {
        query += params.length > 0 ? ' AND date >= $' + (params.length + 1) : ' AND date >= $' + (params.length + 1);
        params.push(start);
      }
      
      if (end) {
        query += params.length > 0 ? ' AND date <= $' + (params.length + 1) : ' AND date <= $' + (params.length + 1);
        params.push(end);
      }
      
      query += ' ORDER BY date DESC, store';
      
      const result = await pool().query(query, params);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
      
    } catch (error) {
      log.error({ msg: 'api_daily_reports_error', err: error?.message || String(error) });
      res.status(500).json({ 
        error: 'server_error',
        message: error.message
      });
    }
  });
  
  // 获取营业目标
  app.get('/api/scoring/revenue-targets', authRequired, async (req, res) => {
    try {
      const { store, period } = req.query;
      
      let query = 'SELECT * FROM revenue_targets WHERE 1=1';
      const params = [];
      
      if (store) {
        query += ' AND store = $1';
        params.push(store);
      }
      
      if (period) {
        query += params.length > 0 ? ' AND period = $' + (params.length + 1) : ' AND period = $' + (params.length + 1);
        params.push(period);
      }
      
      query += ' ORDER BY period DESC, store';
      
      const result = await pool().query(query, params);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
      
    } catch (error) {
      log.error({ msg: 'api_revenue_targets_error', err: error?.message || String(error) });
      res.status(500).json({ 
        error: 'server_error',
        message: error.message
      });
    }
  });
  
  // 获取毛利率目标
  app.get('/api/scoring/margin-targets', authRequired, async (req, res) => {
    try {
      const { store, period } = req.query;
      
      let query = 'SELECT * FROM margin_targets WHERE 1=1';
      const params = [];
      
      if (store) {
        query += ' AND store = $1';
        params.push(store);
      }
      
      if (period) {
        query += params.length > 0 ? ' AND period = $' + (params.length + 1) : ' AND period = $' + (params.length + 1);
        params.push(period);
      }
      
      query += ' ORDER BY period DESC, store';
      
      const result = await pool().query(query, params);
      
      res.json({
        success: true,
        data: result.rows,
        count: result.rows.length
      });
      
    } catch (error) {
      log.error({ msg: 'api_margin_targets_error', err: error?.message || String(error) });
      res.status(500).json({ 
        error: 'server_error',
        message: error.message
      });
    }
  });
  
  // 设置营业目标
}
