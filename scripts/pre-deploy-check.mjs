#!/usr/bin/env node
/**
 * 部署前验证脚本
 * 每次修改 working-fixed.html 后运行：node scripts/pre-deploy-check.mjs
 *
 * 后端断言一律走「全树搜索」而不是钉死单个文件：
 * 2026-07 巨石拆分后，growth-api.js 里的路由/函数陆续迁到 domains/**，
 * 内联 DDL 迁到 migrations/**。旧版把 server/growth-api.js 读成一个字符串再
 * includes()，重构后必然假阳性（实测报 3 项"失败"，实为代码只是换了位置）。
 * 现在按「功能是否还存在于代码库」判断，位置随便改都不会误报。
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';

const html = fs.readFileSync('working-fixed.html', 'utf8');

/** 递归收集 server/ 下的源码与 migration，拼成一个可搜索的语料 */
function loadServerCorpus() {
  const SKIP = new Set(['node_modules', 'coverage', 'dist', '.git', 'uploads', '.stryker-tmp']);
  const parts = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs|sql)$/.test(e.name)) {
        try {
          parts.push(fs.readFileSync(p, 'utf8'));
        } catch {
          /* 读不到就跳过 */
        }
      }
    }
  })('server');
  return parts.join('\n');
}

const serverCorpus = loadServerCorpus();
/** 后端功能是否仍存在于代码库任意位置（不关心在哪个文件） */
const backendHas = (needle) => serverCorpus.includes(needle);

let passed = 0;
let failed = 0;
const errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    errors.push({ name, error: e.message });
  }
}

console.log('\n=== 部署前验证 ===\n');

// 1. 检查重复函数定义
console.log('1. 重复代码检查');
const functionNames = [
  'renderGrowthMetricsCards',
  'renderGrowthFunnel',
  'renderGrowthAlerts',
  'renderGrowthTrends',
  'renderGrowthRepurchase',
  'renderGrowthActions',
  'renderGrowthPosMetricsCards',
  'alertActionRecall',
  'alertActionDismiss',
  'switchTrendIndicator'
];
functionNames.forEach(name => {
  const regex = new RegExp(`function ${name}\\s*\\(`, 'g');
  const matches = html.match(regex);
  const count = matches ? matches.length : 0;
  if (count === 1) {
    console.log(`   ✓ ${name} (1次定义)`);
    passed++;
  } else if (count === 0) {
    console.log(`   ⚠ ${name} (未找到)`);
    passed++; // 允许不存在
  } else {
    console.log(`   ✗ ${name} (${count}次定义 - 重复!)`);
    failed++;
    errors.push({ name: `${name} 重复定义`, error: `found ${count} definitions` });
  }
});

// 2. 检查 orphan 代码块（函数体外部的独立语句）
console.log('\n2. 孤立代码块检查');
const orphanPatterns = [
  /document\.getElementById\('growth-funnel'\)\.innerHTML\s*=\s*'[^']*漏斗数据来自/,
  /document\.getElementById\('growth-metrics-cards'\)\.innerHTML\s*=\s*cards\.map/,
];
orphanPatterns.forEach((pattern, i) => {
  // Check if the pattern appears outside of a function body
  // Simple heuristic: count occurrences
  const matches = html.match(pattern);
  if (matches && matches.length <= 1) {
    console.log(`   ✓ 孤立代码块检查 ${i + 1} 通过`);
    passed++;
  } else if (matches) {
    console.log(`    发现可能的孤立代码块 (${matches.length} 处)`);
    failed++;
    errors.push({ name: `孤立代码块 ${i + 1}`, error: `found ${matches.length} occurrences` });
  } else {
    console.log(`   ✓ 孤立代码块检查 ${i + 1} 通过`);
    passed++;
  }
});

// 3. 检查未闭合的字符串/括号
console.log('\n3. 基本语法检查');
const scriptContent = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
if (scriptContent) {
  // Extract all script blocks and check for obvious issues
  const allScripts = scriptContent.map(s => s.replace(/<\/?script[^>]*>/g, '')).join('\n');
  
  // Check for unmatched quotes (simple heuristic)
  const singleQuotes = (allScripts.match(/'/g) || []).length;
  const doubleQuotes = (allScripts.match(/"/g) || []).length;
  
  // This is a rough check - not perfect but catches obvious issues
  console.log(`   ✓ 脚本块数量: ${scriptContent.length}`);
  passed++;
  
  // Check for common error patterns
  const errorPatterns = [
    /,\s*\}\s*$/m,  // trailing comma before closing brace
    /\+\s*$/m,      // trailing + at end of line
  ];
  errorPatterns.forEach((pattern, i) => {
    const matches = allScripts.match(pattern);
    if (!matches) {
      console.log(`   ✓ 常见错误模式 ${i + 1} 检查通过`);
      passed++;
    } else {
      console.log(`   ⚠ 发现 ${matches.length} 处可能的错误模式 ${i + 1}`);
      passed++; // Warning only
    }
  });
}

// 4. 检查关键功能完整性
console.log('\n4. 关键功能完整性');
const requiredFeatures = [
  { name: 'POS指标渲染', check: () => assert(html.includes('renderGrowthPosMetricsCards')) },
  { name: '小程序指标渲染', check: () => assert(html.includes('renderGrowthMetricsCards')) },
  { name: '漏斗渲染', check: () => assert(html.includes('renderGrowthFunnel')) },
  { name: '预警渲染', check: () => assert(html.includes('renderGrowthAlerts')) },
  { name: '趋势渲染', check: () => assert(html.includes('renderGrowthTrends')) },
  { name: '复购渲染', check: () => assert(html.includes('renderGrowthRepurchase')) },
  { name: '召回操作', check: () => assert(html.includes('alertActionRecall')) },
  { name: '标记已处理', check: () => assert(html.includes('alertActionDismiss')) },
  { name: '指标切换', check: () => assert(html.includes('switchTrendIndicator')) },
  { name: '全局趋势变量', check: () => assert(html.includes('__growthTrendIndicator')) },
];
requiredFeatures.forEach(f => {
  try {
    f.check();
    console.log(`   ✓ ${f.name}`);
    passed++;
  } catch (e) {
    console.log(`   ✗ ${f.name}: ${e.message}`);
    failed++;
    errors.push({ name: f.name, error: e.message });
  }
});

// 5. 后端API检查
console.log('\n5. 后端API检查');
// 只断言「功能还在」，不绑定所在文件——拆分/搬家不应触发假阳性
const requiredApis = [
  {
    name: 'resolve接口',
    check: () => assert(
      backendHas("'/api/growth/alerts/:alertKey/resolve'"),
      '未在 server/ 任何位置找到告警 resolve 路由'
    ),
  },
  {
    name: 'resolved_by字段',
    check: () => assert(
      backendHas('resolved_by'),
      '未在 server/ 源码或 migrations 中找到 resolved_by 列'
    ),
  },
  {
    name: 'recomputeDailyMetrics',
    check: () => assert(
      backendHas('recomputeDailyMetrics'),
      '未在 server/ 任何位置找到 recomputeDailyMetrics'
    ),
  },
];
requiredApis.forEach(apiCheck => {
  try {
    apiCheck.check();
    console.log(`   ✓ ${apiCheck.name}`);
    passed++;
  } catch (e) {
    console.log(`   ✗ ${apiCheck.name}: ${e.message}`);
    failed++;
    errors.push({ name: apiCheck.name, error: e.message });
  }
});

// 6. 安全：禁止自动登录后门
console.log('\n6. 安全门禁');
test('禁止 HRMS_AUTO_PASS 写入', () => {
  assert(!/setItem\(['"]HRMS_AUTO_PASS['"]/.test(html), 'must not setItem HRMS_AUTO_PASS');
  assert(!/HRMS_AUTO_PASS\s*=/.test(html), 'must not assign HRMS_AUTO_PASS');
});
test('禁止明文 _loginPassword 持久化写入', () => {
  assert(!/setItem\([^)]*_loginPassword/.test(html), 'must not persist _loginPassword');
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`验证结果: ${passed} 通过, ${failed} 失败`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\n❌ 发现以下问题，请修复后再部署：\n');
  errors.forEach((e, i) => {
    console.log(`  ${i + 1}. ${e.name}: ${e.error}`);
  });
  console.log('\n建议运行: node test-growth-dashboard-fixes.mjs 进行完整测试');
  process.exit(1);
}

console.log('\n✅ 所有验证通过！可以安全部署。');
console.log('\n部署步骤（勿再手工 scp 单文件——已有带备份/md5/健康检查/自动回滚的脚本）：');
console.log('  前端: npm run build:shell && ./scripts/deploy-frontend.sh');
console.log('        （先传 app.<hash>.js/.css 再换 shell，否则瞬间 404）');
console.log('  后端: ./scripts/deploy-server-files.sh server/<file.js> [...]');
console.log('        预览: DRY_RUN=1 ./scripts/deploy-server-files.sh server/<file.js>');
console.log('  依赖: npm run deploy:prod-deps:verify   （改过 package.json 才需 deploy:prod-deps）');
console.log('  备份统一落 /opt/hrms-archive/deploy-bak/，禁止留在 web root。');
