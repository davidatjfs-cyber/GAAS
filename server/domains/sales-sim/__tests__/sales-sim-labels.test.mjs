import test from 'node:test';
import assert from 'node:assert/strict';
import {
  skillLabel, principleLabel, sceneLabel, difficultyLabel,
  formatSkillsLine, formatSkillsGradeLine, scoreGrade, localizeFocus, localizeSourceLabel,
} from '../labels.js';
import { buildReportMessage } from '../notify.js';

test('技能/原则/场景标签均为中文', () => {
  assert.equal(skillLabel('empathy'), '情绪安抚');
  assert.equal(skillLabel('questioning'), '提问能力');
  assert.equal(principleLabel('soothe_first'), '先安抚再处理');
  assert.equal(sceneLabel('complaint'), '投诉');
  assert.equal(difficultyLabel(3), '难度3');
  assert.equal(localizeFocus('questioning'), '提问能力');
  assert.match(formatSkillsLine({ empathy: 54, diagnosis: 74 }), /情绪安抚 54/);
  assert.equal(localizeSourceLabel('参考·金牌客服·complaint'), '参考·金牌客服·投诉');
});

test('四档成绩划分：<80不合格 · 80-90合格 · 91-95优秀 · >95卓越', () => {
  assert.equal(scoreGrade(0), '不合格');
  assert.equal(scoreGrade(79), '不合格');
  assert.equal(scoreGrade(80), '合格');
  assert.equal(scoreGrade(90), '合格');
  assert.equal(scoreGrade(91), '优秀');
  assert.equal(scoreGrade(95), '优秀');
  assert.equal(scoreGrade(96), '卓越');
  assert.equal(scoreGrade(100), '卓越');
  assert.equal(formatSkillsGradeLine({ questioning: 85, closing: 43 }), '提问能力 合格 · 成交推进 不合格');
});

test('训后报告文案不含英文 key', () => {
  const msg = buildReportMessage({
    debrief: {
      score: 55,
      track: 'cs',
      skills: { empathy: 54, diagnosis: 74 },
      improvements: [{ principle_id: 'soothe_first', detail: '投诉场景缺少安抚' }],
      replacements: [{
        original: '真的吗',
        suggested: '非常抱歉给您带来不便',
        source_label: '参考·金牌客服·complaint',
      }],
    },
    rank: { rank_label: '普通客服' },
    personaTitle: '客户 · 短信没发出',
  });
  assert.match(msg, /本场评定：不合格/);
  assert.match(msg, /情绪安抚 不合格/);
  assert.match(msg, /问题定位 不合格/);
  assert.match(msg, /先安抚再处理/);
  assert.match(msg, /金牌客服·投诉/);
  assert.doesNotMatch(msg, /\bempathy\b/);
  assert.doesNotMatch(msg, /\bsoothe_first\b/);
  assert.doesNotMatch(msg, /\bcomplaint\b/);
});
