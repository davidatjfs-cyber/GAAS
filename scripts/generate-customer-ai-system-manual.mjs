import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_KNOWLEDGE, PRODUCT_KNOWLEDGE_VERSION, PRODUCT_MODULES, buildProductBenchmark } from '../server/services/sales/sales-product-knowledge.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs', 'customer-ai-system-manual.md');
const grouped = Map.groupBy(PRODUCT_KNOWLEDGE, (item) => item.module);
const lines = [
  '# 客户AI系统模块使用手册', '',
  '> 本手册由客户AI的正式结构化知识源自动生成。面向外部客户，只包含已在GAAS正式代码中存在且适合公开的功能事实。', '',
  `- 知识版本：${PRODUCT_KNOWLEDGE_VERSION}`,
  `- 功能模块：${grouped.size} 个`,
  `- 知识卡：${PRODUCT_KNOWLEDGE.length} 条`,
  `- 自动检索评测问题：${buildProductBenchmark().length} 条`, '',
  '## 使用原则', '',
  '1. 实际菜单、按钮和数据范围以登录账号的角色、岗位权限组与门店范围为准。',
  '2. 涉及POS接入、营销归因和AI判断时，只说明条件与边界，不承诺一定接入或保证效果。',
  '3. 找不到确切知识时明确说明并记录问题，不根据相似功能编造。',
  '4. 系统功能变化后修改结构化知识源，再重新生成本手册并运行检索评测。', '',
];

for (const [module, items] of grouped) {
  lines.push(`## ${PRODUCT_MODULES[module] || module}`, '');
  for (const item of items) {
    lines.push(`### ${item.title}`, '', item.answer, '');
    lines.push(`常见问法：${item.keywords.join('、')}`, '');
    if (item.steps.length) {
      lines.push('操作步骤：', '');
      item.steps.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
      lines.push('');
    }
    lines.push(`权限说明：${item.roles}。`, '');
    if (item.limits) lines.push(`注意事项：${item.limits}`, '');
    lines.push(`代码依据：${item.sources.join('、')}`, '');
  }
}

fs.mkdirSync(path.dirname(output), { recursive: true });
while (lines[lines.length - 1] === '') lines.pop();
fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ output, modules: grouped.size, cards: PRODUCT_KNOWLEDGE.length, benchmark: buildProductBenchmark().length }));
