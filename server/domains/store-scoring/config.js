/**
 * 门店评级 / 员工评分模型静态配置 + 运行时可覆写配置读取。
 * 从 new-scoring-model.js 拆出。
 */
import { pool } from '../../utils/database.js';

/** 数据不足以得出 A～D 时的等级（禁止用 C/D 当「假默认值」误导） */
export const EMPLOYEE_RATING_PENDING = '待定';

// ─────────────────────────────────────────────
// 1. 门店评级模型配置
// ─────────────────────────────────────────────
export const STORE_RATING_CONFIG = {
  name: '门店评级模型',
  type: 'store_rating',
  period: 'monthly', // 按月评级
  rules: {
    'A': { min_rate: 95.01, description: '达成率>95%' },
    'B': { min_rate: 90.01, max_rate: 95.00, description: '达成率>90%' },
    'C': { min_rate: 85.00, max_rate: 90.00, description: '达成率>=85%' },
    'D': { max_rate: 85.00, description: '达成率<85%' }
  },
  data_sources: {
    actual_revenue: 'daily_reports',
    target_revenue: 'revenue_targets'
  },
  new_store_grace_period: 1 // 第一个月不评级
};

// 奖金配置
export const BONUS_CONFIG = {
  '马己仙': { base: 1500 },
  '洪潮': { base: 2000 },
  // 门店A/B级：奖金 = 得分/100 * base
  // 门店C级：奖金归0
  // 门店D级：工资8折
};

// ─────────────────────────────────────────────
// 2. 员工评分模型配置
// ─────────────────────────────────────────────
export const EMPLOYEE_SCORE_CONFIG = {
  name: '员工评分模型',
  type: 'employee_score',
  period: 'monthly', // 按月评分
  base_score: 100,
  scoring: {
    base_score: 100,
    exception_bonus: '零异常加分',
    exception_deduction: '异常扣分'
  },
  execution_rules: {
    store_production_manager: {
      // 马己仙5档口、洪潮6档口：每日开档+收档各须档口齐，原料≥1；月度按「未完全达标自然日数」评级
      data_sources: ['开档报告', '收档报告', '原料收货日报'],
      expected_frequency: 'daily',
      rating_thresholds: {
        'A': { max_noncompliant_days: 2 },
        'B': { max_noncompliant_days: 5 },
        'C': { max_noncompliant_days: 10 },
        'D': { default: true }
      }
    },
    store_manager: {
      // 按品牌区分
      '马己仙': {
        data_sources: ['例会报告'],
        expected_frequency: 'daily',
        score_threshold: 7,
        // 未提交次数和得分低于7分次数同时满足
        rating_thresholds: {
          'A': { max_missing: 2, max_low_score: 2 },
          'B': { max_missing: 4, max_low_score: 4 },
          'C': { max_missing: 6, max_low_score: 6 },
          'D': { default: true }
        }
      },
      '洪潮': {
        data_sources: ['企微会员'],
        // 企微会员每月新增数量（洪潮大宁久光店长执行力）
        rating_thresholds: {
          'A': { min_new_members: 400 },
          'B': { min_new_members: 349 },
          'C': { min_new_members: 300 },
          'D': { default: true }
        }
      }
    }
  },
  attitude_rules: {
    data_source: 'master_tasks',
    reminder_count: 3,
    rating_thresholds: {
      'A': { max_incomplete: 2 },
      'B': { max_incomplete: 4 },
      'C': { default: true }
    }
  },
  ability_rules: {
    store_production_manager: {
      // 不分品牌，基于实际毛利率与目标的差值
      data_source: 'monthly_margins',
      rating_thresholds: {
        'A': { min_diff: 1.01 },    // 实际>目标+1个点
        'B': { min_diff: -1.00, max_diff: 1.00 }, // 目标±1个点以内
        'C': { min_diff: -2.00, max_diff: -1.01 }, // 少于1个点以上
        'D': { max_diff: -2.00 }    // 少于2个点及以上
      }
    },
    store_manager: {
      // 基于大众点评星级，按品牌区分
      data_source: 'daily_reports',
      rating_thresholds: {
        '洪潮': {
          'A': { min_rating: 4.6 },
          'B': { min_rating: 4.5 },
          'C': { min_rating: 4.3 },
          'D': { max_rating: 4.3 }
        },
        '马己仙': {
          'A': { min_rating: 4.5 },
          'B': { min_rating: 4.4 },
          'C': { min_rating: 4.0 },
          'D': { max_rating: 4.0 }
        }
      }
    }
  }
};

export const DEFAULT_EMPLOYEE_RATING_CONFIG = {
  levelLabels: { A: 'A', B: 'B', C: 'C', D: 'D' },
  execution: {
    store_production_manager: {
      A_max_noncompliant_days: 2,
      B_max_noncompliant_days: 5,
      C_max_noncompliant_days: 10,
      A_max_missing: 6,
      B_max_missing: 13,
      C_max_missing: 20,
      D_min_missing: 21
    },
    store_manager: {
      hongchao: { A_min_new_members: 400, B_min_new_members: 349, C_min_new_members: 300, D_max_new_members: 299 },
      majixian: { low_score_threshold: 7, A_max_missing: 2, A_max_low_score: 2, B_max_missing: 4, B_max_low_score: 4, C_max_missing: 6, C_max_low_score: 6, D_min_missing: 7, D_min_low_score: 7 }
    }
  },
  attitude: { A_max_incomplete: 2, B_max_incomplete: 4, C_max_incomplete: 8 },
  ability: {
    store_production_manager: { A_min_diff: 1.01, B_min_diff: -1, B_max_diff: 1, C_min_diff: -2, C_max_diff: -1.01, D_max_diff: -2 },
    store_manager: {
      hongchao: { A_min_rating: 4.6, B_min_rating: 4.5, C_min_rating: 4.3, D_max_rating: 4.2 },
      majixian: { A_min_rating: 4.5, B_min_rating: 4.4, C_min_rating: 4.0, D_max_rating: 3.9 }
    }
  }
};

export async function getRuntimeEmployeeRatingConfig() {
  try {
    const r = await pool().query(
      `select config from hr_rating_configs where config_key = 'employee_rating' and enabled = true limit 1`
    );
    const cfg = r.rows?.[0]?.config;
    return cfg && typeof cfg === 'object' ? cfg : DEFAULT_EMPLOYEE_RATING_CONFIG;
  } catch (_) {
    return DEFAULT_EMPLOYEE_RATING_CONFIG;
  }
}
