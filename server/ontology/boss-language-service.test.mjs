import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanBossText,
  buildBossReportFields,
  summarizeIssueForBoss,
  summarizeOpportunityForBoss,
} from './boss-language-service.js';

test('cleanBossText strips technical jargon and empty input', () => {
  assert.match(cleanBossText(''), /数据不足/);
  assert.match(cleanBossText('  '), /数据不足/);
  assert.equal(cleanBossText('营业额下滑'), '营业额下滑');
  assert.match(cleanBossText('metric schema 异常'), /数据不足/);
  assert.match(cleanBossText('指标ID不对'), /数据不足/);
});

test('buildBossReportFields maps owner-facing copy', () => {
  const fields = buildBossReportFields({
    title: '本周复盘',
    summary: '客流稳定',
    findings: ['午市偏弱'],
    actions: ['调整套餐'],
    riskWarning: '暂无紧急风险',
    expectedImpact: '预计提升午市营收',
    actualImpact: '回店率提升',
    confidenceNote: '基于近7日数据',
  });
  assert.equal(fields.boss_title, '本周复盘');
  assert.equal(fields.boss_summary, '客流稳定');
  assert.deepEqual(fields.key_findings_for_owner, ['午市偏弱']);
  assert.deepEqual(fields.next_actions_for_owner, ['调整套餐']);
  assert.equal(fields.actual_business_impact, '回店率提升');
  assert.equal(fields.confidence_note, '基于近7日数据');
});

test('summarizeIssueForBoss maps known issue types', () => {
  assert.match(summarizeIssueForBoss({ issue_type: 'revenue_decline' }), /掉头/);
  assert.match(summarizeIssueForBoss({ issue_type: 'repeat_decline' }), /老客/);
  assert.match(summarizeIssueForBoss({ issue_type: 'unknown', issue_title: '自定义标题' }), /自定义标题/);
});

test('summarizeOpportunityForBoss maps known opportunity types', () => {
  assert.match(summarizeOpportunityForBoss({ opportunity_type: 'vip_retention' }), /高价值/);
  assert.match(summarizeOpportunityForBoss({ opportunity_type: 'lunch_revenue_recovery' }), /午市/);
  assert.match(summarizeOpportunityForBoss({ opportunity_type: 'x', title: '机会A' }), /机会A/);
});
