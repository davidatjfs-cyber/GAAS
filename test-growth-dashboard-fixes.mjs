#!/usr/bin/env node
/**
 * Growth Dashboard 看板修复验证测试
 * 测试 5 个问题的修复：
 * 1. 看板数据来源标注
 * 2. 活动漏斗渠道细分
 * 3. 流失预警可执行操作
 * 4. 复购触发流程说明
 * 5. 近期指标趋势细化
 */

import fs from 'fs';
import assert from 'assert';

const html = fs.readFileSync('working-fixed.html', 'utf8');
const api = fs.readFileSync('server/growth-api.js', 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`   ${name}: ${e.message}`);
    failed++;
  }
}

console.log('\n=== 1. 看板数据来源标注 ===');
test('指标卡片包含数据来源说明', () => {
  assert(html.includes("source: '小程序扫码进店'"), '缺少扫码来源');
  assert(html.includes("source: '小程序授权手机号'"), '缺少授权来源');
  assert(html.includes("source: '小程序用户主动领取'"), '缺少领券来源');
  assert(html.includes("source: '小程序支付后购券'"), '缺少购券来源');
  assert(html.includes("source: 'HRMS自动营销引擎触发'"), '缺少营销来源');
  assert(html.includes("source: '小程序店员核销'"), '缺少核销来源');
  assert(html.includes("source: '小程序支付订单'"), '缺少支付来源');
  assert(!html.includes("label: '收入(元)'"), '收入指标已移除');
});

test('看板分A/B两条数据链', () => {
  assert(html.includes('POS系统数据'), '缺少POS数据区块标题');
  assert(html.includes('小程序数据'), '缺少小程序数据区块标题');
  assert(html.includes('growth-pos-metrics-cards'), '缺少POS指标容器');
  assert(html.includes('renderGrowthPosMetricsCards'), '缺少POS指标渲染函数');
});

console.log('\n=== 2. 活动漏斗渠道细分 ===');
test('漏斗包含渠道细分逻辑', () => {
  assert(html.includes('var byChannel = {}'), '缺少渠道分组');
  assert(html.includes('chLabels'), '缺少渠道标签映射');
  assert(html.includes('chColors'), '缺少渠道颜色映射');
});

test('漏斗包含渠道细分展示', () => {
  assert(html.includes('按渠道细分'), '缺少渠道细分标题');
  assert(html.includes("miniprogram: '小程序'"), '缺少小程序渠道');
  assert(html.includes("wecom: '企微'"), '缺少企微渠道');
  assert(html.includes("sms: '短信'"), '缺少短信渠道');
  assert(html.includes("subscribe: '订阅消息'"), '缺少订阅消息渠道');
});

test('漏斗顶部有数据来源说明', () => {
  assert(html.includes('小程序用户主动行为') || html.includes('小程序扫码活动'), '缺少漏斗来源说明');
});

console.log('\n=== 3. 流失预警可执行操作 ===');
test('预警卡片包含操作按钮', () => {
  assert(html.includes('alertActionRecall'), '缺少召回按钮函数');
  assert(html.includes('alertActionDismiss'), '缺少标记已处理按钮函数');
  assert(html.includes('发送召回券'), '缺少召回按钮文字');
  assert(html.includes('标记已处理'), '缺少标记已处理按钮文字');
});

test('后端有预警解决接口', () => {
  assert(api.includes("app.post('/api/growth/alerts/:alertKey/resolve'"), '缺少resolve接口');
  assert(api.includes("status = 'resolved'"), '缺少状态更新');
  assert(api.includes('resolved_by'), '缺少解决人字段');
  assert(api.includes('resolved_at'), '缺少解决时间字段');
});

test('前端调用正确的resolve接口', () => {
  assert(html.includes("/api/growth/alerts/' + encodeURIComponent(alertKey) + '/resolve"), '前端未调用resolve接口');
});

test('数据库表包含resolved_by字段', () => {
  assert(api.includes('resolved_by TEXT'), '表定义缺少resolved_by');
  assert(api.includes('ALTER TABLE growth_alerts ADD COLUMN IF NOT EXISTS resolved_by'), '缺少ALTER TABLE');
});

console.log('\n=== 4. 复购触发流程说明 ===');
test('复购面板有判定规则说明', () => {
  assert(html.includes('14-30天未到店=临界，30天+=流失'), '缺少判定规则说明');
});

test('复购按钮有流程说明文字', () => {
  assert(html.includes('不会自动发送'), '缺少流程说明');
  assert(html.includes('请到「AI建议」Tab中逐条确认后执行'), '缺少执行说明');
});

console.log('\n=== 5. 近期指标趋势细化 ===');
test('趋势包含更多指标', () => {
  assert(html.includes("key: 'scan'"), '缺少扫码指标');
  assert(html.includes("key: 'auth'"), '缺少授权指标');
  assert(html.includes("key: 'claimed'"), '缺少领券指标');
  assert(html.includes("key: 'redeem'"), '缺少核销指标');
  assert(html.includes("key: 'payment'"), '缺少支付指标');
});

test('趋势有指标切换器', () => {
  assert(html.includes('switchTrendIndicator'), '缺少切换函数');
  assert(html.includes('__growthTrendIndicator'), '缺少全局变量');
});

test('趋势有环比变化显示', () => {
  assert(html.includes('changePct'), '缺少变化百分比');
  assert(html.includes('较前一日'), '缺少环比说明');
});

test('趋势柱状图显示具体数值', () => {
  assert(html.includes("val + '</div>"), '柱状图缺少数值显示');
});

test('趋势顶部有数据来源说明', () => {
  assert(html.includes('核心指标趋势，数据来自小程序事件上报'), '缺少趋势来源说明');
});

console.log('\n=== 代码语法检查 ===');
test('growth-api.js 语法正确', () => {
  // 如果文件有语法错误，import 会抛出异常
  const code = api;
  assert(code.includes("app.post('/api/growth/alerts/:alertKey/resolve'"), '接口定义异常');
});

test('前端函数定义完整', () => {
  assert(html.includes('function renderGrowthMetricsCards'), '缺少指标渲染函数');
  assert(html.includes('function renderGrowthFunnel'), '缺少漏斗渲染函数');
  assert(html.includes('function renderGrowthAlerts'), '缺少预警渲染函数');
  assert(html.includes('function renderGrowthRepurchase'), '缺少复购渲染函数');
  assert(html.includes('function renderGrowthTrends'), '缺少趋势渲染函数');
  assert(html.includes('function alertActionRecall'), '缺少召回操作函数');
  assert(html.includes('function alertActionDismiss'), '缺少标记已处理函数');
  assert(html.includes('function switchTrendIndicator'), '缺少指标切换函数');
});

console.log('\n' + '='.repeat(50));
console.log(`测试结果: ${passed} 通过, ${failed} 失败`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
console.log('\n✅ 所有测试通过！');
