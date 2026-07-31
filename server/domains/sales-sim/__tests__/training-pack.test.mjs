import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_TRAINING_ARTICLES, CATEGORY_MUST_KNOW, collectKeyPhrasesForHints,
  mustKnowForCategory,
} from '../training-pack.js';
import { INCIDENT_SEED_CARDS } from '../incident-seed-cards.js';
import { scoreIncidentPerformance } from '../incident-cards.js';

test('内置培训包覆盖手册/客诉/外卖/食安/迎宾/收银/店长/后厨/席间/应急/总部', () => {
  assert.ok(BUILTIN_TRAINING_ARTICLES.length >= 12);
  const titles = BUILTIN_TRAINING_ARTICLES.map((a) => a.title).join('|');
  for (const k of ['员工手册', '客诉', '外卖', '食药监', '迎宾', '收银', '店长', '后厨', '席间', '应急', '总部']) {
    assert.ok(titles.includes(k), `missing ${k}`);
  }
  for (const a of BUILTIN_TRAINING_ARTICLES) {
    assert.ok(a.content.length > 170, `${a.title} content too short`);
    assert.ok(a.key_phrases.length >= 5);
  }
});

test('各大类有开练应知要点', () => {
  for (const key of Object.keys(CATEGORY_MUST_KNOW)) {
    assert.ok(mustKnowForCategory(key).length >= 3);
  }
});

test('事故卡自动挂接大类培训包标题', () => {
  const dine = INCIDENT_SEED_CARDS.find((c) => c.card_key === 'dine_foreign_hair');
  assert.ok(dine.kb_title_hints.some((h) => h.includes('陪练内置')));
  const hr = INCIDENT_SEED_CARDS.find((c) => c.category_key === 'newhire_handbook');
  assert.ok(hr.kb_title_hints.some((h) => h.includes('员工手册')));
});

test('素材库体量足够支撑日常抽卡且覆盖全岗位', () => {
  assert.ok(INCIDENT_SEED_CARDS.length >= 100);
  const byCat = {};
  const byProf = {};
  for (const c of INCIDENT_SEED_CARDS) {
    byCat[c.category_key] = (byCat[c.category_key] || 0) + 1;
    byProf[c.job_profile_key] = (byProf[c.job_profile_key] || 0) + 1;
  }
  for (const [k, n] of Object.entries(byCat)) {
    assert.ok(n >= 2, `${k} only ${n}`);
  }
  for (const p of ['foh_server', 'cashier', 'store_manager', 'kitchen_staff', 'hq_ops']) {
    assert.ok((byProf[p] || 0) >= 8, `${p} only ${byProf[p] || 0}`);
  }
});

test('评分纳入培训包关键短语', () => {
  const phrases = collectKeyPhrasesForHints(['前厅客诉处置通用SOP（陪练内置）']);
  assert.ok(phrases.includes('抱歉') || phrases.includes('免单'));
  const scored = scoreIncidentPerformance({
    card: {
      sop_checklist: ['先致歉安抚', '确认事实', '给处理方案'],
      key_phrases: phrases,
      failure_signals: [],
    },
    evals: [{ violations: [], strengths: [] }],
    traineeTexts: ['非常抱歉，我马上确认事实，这道菜免单并给您重做，处理好跟您说。'],
  });
  assert.ok(scored.knowledge_score >= 75);
});
