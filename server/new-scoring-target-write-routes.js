/**
 * 新评分模型API接口
 */

import { pool, resolveTenantIdDefault } from './utils/database.js';

import { childLogger } from './utils/logger.js';

const log = childLogger({ domain: 'new-scoring', handler: 'api' });

// ─────────────────────────────────────────────
// 门店评级API
// ─────────────────────────────────────────────

export function registerNewScoringTargetWriteRoutes(app, authRequired) {

  app.post('/api/scoring/revenue-targets', authRequired, async (req, res) => {
    try {
      const { store, brand, period, target_revenue } = req.body;
      
      if (!store || !brand || !period || !target_revenue) {
        return res.status(400).json({ 
          error: 'missing_parameters',
          message: '需要提供 store, brand, period 和 target_revenue 参数'
        });
      }
      
      await pool().query(`
        INSERT INTO revenue_targets (store, brand, period, target_revenue, tenant_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (store, brand, period, tenant_id)
        DO UPDATE SET target_revenue = EXCLUDED.target_revenue
      `, [store, brand, period, target_revenue, resolveTenantIdDefault()]);
      
      res.json({
        success: true,
        message: '营业目标设置成功'
      });
      
    } catch (error) {
      log.error({ msg: 'api_set_revenue_targets_error', err: error?.message || String(error) });
      res.status(500).json({ 
        error: 'server_error',
        message: error.message
      });
    }
  });
  
  // 设置毛利率目标
  app.post('/api/scoring/margin-targets', authRequired, async (req, res) => {
    try {
      const { store, brand, period, target_margin } = req.body;
      
      if (!store || !brand || !period || !target_margin) {
        return res.status(400).json({ 
          error: 'missing_parameters',
          message: '需要提供 store, brand, period 和 target_margin 参数'
        });
      }
      
      await pool().query(`
        INSERT INTO margin_targets (store, brand, period, target_margin, tenant_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (store, brand, period, tenant_id)
        DO UPDATE SET target_margin = EXCLUDED.target_margin
      `, [store, brand, period, target_margin, resolveTenantIdDefault()]);
      
      res.json({
        success: true,
        message: '毛利率目标设置成功'
      });
      
    } catch (error) {
      log.error({ msg: 'api_set_margin_targets_error', err: error?.message || String(error) });
      res.status(500).json({ 
        error: 'server_error',
        message: error.message
      });
    }
  });
  
  // 更新营业日报
}
