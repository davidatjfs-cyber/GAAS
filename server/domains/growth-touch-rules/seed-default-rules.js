/**
 * Seed default growth_touch_rules for the default tenant (P4 peel).
 */
import { tenantContext } from '../../utils/database.js';
import { DEFAULT_TOUCH_RULES, REMOVED_TOUCH_RULE_KEYS } from './default-rules.js';

/**
 * @param {{ query: Function }} pool
 * @param {object[]} [rules]
 * @param {string[]} [removedKeys]
 */
export async function seedDefaultTouchRules(
  pool,
  rules = DEFAULT_TOUCH_RULES,
  removedKeys = REMOVED_TOUCH_RULE_KEYS,
) {
  // ALLOWED_SYSTEM_DEFAULT: 启动期仅给 default 播种触达规则（single 现网）；multi 应走平台开通种子
  // 启动期默认规则种子，无HTTP请求上下文，固定按default租户播种
  await tenantContext.run('default', async () => {
    for (const rule of rules) {
      await pool.query(
        // 仅作首次默认种子：已存在则保留运营在 HRMS UI 上的编辑（渠道/短信模板/券额/频次/审批），
        // 避免每次进程重启用代码默认值覆盖用户配置。
        `INSERT INTO growth_touch_rules (rule_key, name, enabled, priority, auto_execute, criteria, action_type, action_payload, tenant_id)
         VALUES ($1,$2,TRUE,$3,$4,$5::jsonb,$6,$7::jsonb,'default')
         ON CONFLICT (rule_key, tenant_id) DO NOTHING`,
        [
          rule.rule_key,
          rule.name,
          rule.priority,
          rule.auto_execute !== false,
          JSON.stringify(rule.criteria || {}),
          rule.action_type,
          JSON.stringify(rule.action_payload || {}),
        ],
      );
    }
    await pool.query(
      `DELETE FROM growth_touch_rules WHERE rule_key = ANY($1::text[])`,
      [removedKeys],
    );
  });
}
