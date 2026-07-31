/**
 * Talent Engine — Ability Library（平台能力库）
 */

export const BUILTIN_ABILITIES = [
  { ability_key: 'questioning', label: '提问能力', description: '高质量问题、引导真实需求' },
  { ability_key: 'listening', label: '倾听能力', description: '抓住关键信号，不急于回应' },
  { ability_key: 'value', label: '价值表达', description: '把能力翻译成客户能懂的业务结果' },
  { ability_key: 'closing', label: '成交推进', description: '购买信号、异议处理、下一步行动' },
  { ability_key: 'empathy', label: '情绪安抚', description: '先共情再处理，稳定客户情绪' },
  { ability_key: 'diagnosis', label: '问题定位', description: '快速定位根因与期望' },
  { ability_key: 'resolution', label: '解决闭环', description: '处理到位并约定回访' },
  { ability_key: 'retention', label: '关系维护', description: '保留合作意愿与长期关系' },
  // 门店轨预留（Phase1 启用）
  { ability_key: 'service_awareness', label: '服务意识', description: '主动发现需求与体验问题' },
  { ability_key: 'product_knowledge', label: '产品知识', description: '菜品/项目/制度事实准确' },
  { ability_key: 'recommendation', label: '推荐能力', description: '套餐/加购/方案推荐时机与表达' },
  { ability_key: 'communication', label: '沟通能力', description: '清晰、礼貌、可执行的表达' },
  { ability_key: 'exception_handling', label: '异常处理', description: '催菜、上错菜、投诉等异常处置' },
  { ability_key: 'member_conversion', label: '会员转化', description: '会员引导与办卡转化' },
  { ability_key: 'brand_expression', label: '品牌表达', description: '品牌故事与标准话术一致性' },
];

export async function ensureAbilitySeed(pool) {
  for (const a of BUILTIN_ABILITIES) {
    await pool.query(
      `INSERT INTO talent_abilities (ability_key, label, description)
       VALUES ($1,$2,$3)
       ON CONFLICT (ability_key) DO UPDATE SET
         label = EXCLUDED.label,
         description = EXCLUDED.description,
         active = TRUE`,
      [a.ability_key, a.label, a.description]
    );
  }
}

export async function listAbilities(pool, { activeOnly = true } = {}) {
  const r = await pool.query(
    `SELECT ability_key, label, description, active, created_at
       FROM talent_abilities
      WHERE ($1::boolean IS FALSE OR active = TRUE)
      ORDER BY ability_key`,
    [activeOnly]
  );
  return r.rows || [];
}
