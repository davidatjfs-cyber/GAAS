import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolvePracticeMediaType,
  buildRubricScoringPrompt,
  buildJudgmentPrompt,
  scorePracticeMediaWithRubric,
  scorePracticeMediaWithoutRubric,
} from '../upload-practice-media-helpers.js';

const rubric = {
  dish_name: '宫保鸡丁',
  station: '热菜',
  items: [{
    action: '切配',
    weight: 10,
    checks: ['均匀'],
    quality_standard: '3mm',
    common_failure: '大小不一',
    is_critical: true,
  }],
  fail_criteria: ['生熟不分'],
  pass_threshold: 85,
};

test('resolvePracticeMediaType: video extensions', () => {
  assert.equal(resolvePracticeMediaType('.mp4'), 'video');
  assert.equal(resolvePracticeMediaType('.MOV'), 'video');
  assert.equal(resolvePracticeMediaType('.webm'), 'video');
});

test('resolvePracticeMediaType: image fallback', () => {
  assert.equal(resolvePracticeMediaType('.jpg'), 'image');
  assert.equal(resolvePracticeMediaType('.png'), 'image');
});

test('buildRubricScoringPrompt includes dish and threshold', () => {
  const prompt = buildRubricScoringPrompt(rubric, '实操一', 'video');
  assert.match(prompt, /宫保鸡丁/);
  assert.match(prompt, /85/);
  assert.match(prompt, /完整视频/);
  assert.match(prompt, /关键步骤/);
});

test('buildJudgmentPrompt includes practice task', () => {
  const prompt = buildJudgmentPrompt({ practice_task: '摆盘', key_points: ['整洁'] });
  assert.match(prompt, /摆盘/);
  assert.match(prompt, /整洁/);
});

test('scorePracticeMediaWithRubric: image with parsed JSON', async () => {
  const parseScoringJson = (raw) => ({
    aiVerdict: 'passed',
    aiFeedback: '很好',
    aiStepScores: [{ name: '切配', score: 10 }],
    aiTotalScore: 90,
  });
  const out = await scorePracticeMediaWithRubric({
    rubric,
    topicTitle: '实操一',
    mediaType: 'image',
    filePath: '/tmp/test.jpg',
    mediaUrl: '/uploads/test.jpg',
    uploadsDir: '/tmp',
    pathModule: path,
    fsModule: fs,
    execFileSync: () => {},
    callVisionLLM: async () => ({ content: '{"total_score":90,"verdict":"passed"}' }),
    callVisionLLMVideo: async () => ({ ok: false }),
    parseScoringJson,
    randomUUID: () => 'uuid-1',
    serverBaseUrl: 'https://test.example',
    log: { error: () => {} },
  });
  assert.equal(out.aiVerdict, 'passed');
  assert.equal(out.aiTotalScore, 90);
});

test('scorePracticeMediaWithRubric: image without JSON returns review', async () => {
  const out = await scorePracticeMediaWithRubric({
    rubric,
    topicTitle: '实操一',
    mediaType: 'image',
    filePath: '/tmp/test.jpg',
    mediaUrl: '/uploads/test.jpg',
    uploadsDir: '/tmp',
    pathModule: path,
    fsModule: fs,
    execFileSync: () => {},
    callVisionLLM: async () => ({ content: 'no json here' }),
    callVisionLLMVideo: async () => ({ ok: false }),
    parseScoringJson: () => ({}),
    randomUUID: () => 'uuid-2',
    log: { error: () => {} },
  });
  assert.equal(out.aiVerdict, 'review');
});

test('scorePracticeMediaWithRubric: video ok path', async () => {
  const out = await scorePracticeMediaWithRubric({
    rubric,
    topicTitle: '实操一',
    mediaType: 'video',
    filePath: '/tmp/test.mp4',
    mediaUrl: '/uploads/test.mp4',
    uploadsDir: '/tmp',
    pathModule: path,
    fsModule: fs,
    execFileSync: () => {},
    callVisionLLM: async () => ({ content: '{}' }),
    callVisionLLMVideo: async () => ({ ok: true, content: '{"total_score":80,"verdict":"review"}' }),
    parseScoringJson: () => ({ aiVerdict: 'review', aiFeedback: 'ok', aiStepScores: [], aiTotalScore: 80 }),
    randomUUID: () => 'uuid-3',
    log: { error: () => {} },
  });
  assert.equal(out.aiVerdict, 'review');
});

test('scorePracticeMediaWithRubric: video fallback to ffmpeg frames', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-'));
  const frameFile = path.join(tmpDir, '001.jpg');
  fs.writeFileSync(frameFile, 'fake');
  const out = await scorePracticeMediaWithRubric({
    rubric,
    topicTitle: '实操一',
    mediaType: 'video',
    filePath: '/tmp/test.mp4',
    mediaUrl: '/uploads/test.mp4',
    uploadsDir: tmpDir,
    pathModule: path,
    fsModule: fs,
    execFileSync: (_cmd, args) => {
      const outDir = args[args.length - 2];
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, '001.jpg'), 'frame');
    },
    callVisionLLM: async () => ({ content: '{"total_score":70,"verdict":"failed"}' }),
    callVisionLLMVideo: async () => ({ ok: false }),
    parseScoringJson: () => ({ aiVerdict: 'failed', aiFeedback: 'bad', aiStepScores: [], aiTotalScore: 70 }),
    randomUUID: () => 'uuid-4',
    log: { error: () => {} },
  });
  assert.equal(out.aiVerdict, 'failed');
  assert.ok(!fs.existsSync(path.join(tmpDir, 'frames-uuid-4')));
});

test('scorePracticeMediaWithRubric: scoring error returns review', async () => {
  const out = await scorePracticeMediaWithRubric({
    rubric,
    topicTitle: '实操一',
    mediaType: 'image',
    filePath: '/tmp/test.jpg',
    mediaUrl: '/uploads/test.jpg',
    uploadsDir: '/tmp',
    pathModule: path,
    fsModule: fs,
    execFileSync: () => {},
    callVisionLLM: async () => { throw new Error('vision down'); },
    callVisionLLMVideo: async () => ({ ok: false }),
    parseScoringJson: () => ({}),
    randomUUID: () => 'uuid-5',
    log: { error: () => {} },
  });
  assert.equal(out.aiVerdict, 'review');
  assert.match(out.aiFeedback, /AI评分失败/);
});

test('scorePracticeMediaWithoutRubric: image parsed verdict', async () => {
  const out = await scorePracticeMediaWithoutRubric({
    session: { practice_task: '摆盘', key_points: ['整洁'] },
    mediaType: 'image',
    filePath: '/tmp/test.jpg',
    uploadsDir: '/tmp',
    pathModule: path,
    fsModule: fs,
    execFileSync: () => {},
    callVisionLLM: async () => ({ content: '{"verdict":"passed","feedback":"合格"}' }),
    randomUUID: () => 'uuid-6',
  });
  assert.equal(out.aiVerdict, 'passed');
  assert.equal(out.aiFeedback, '合格');
});

test('scorePracticeMediaWithoutRubric: video frame extraction success', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-'));
  const out = await scorePracticeMediaWithoutRubric({
    session: { practice_task: '刀工', key_points: ['安全'] },
    mediaType: 'video',
    filePath: '/tmp/test.mp4',
    uploadsDir: tmpDir,
    pathModule: path,
    fsModule: fs,
    execFileSync: (_cmd, _args, _opts) => {
      fs.writeFileSync(path.join(tmpDir, 'frame-uuid-7.jpg'), 'frame');
    },
    callVisionLLM: async () => ({ content: '{"verdict":"review","feedback":"需复核"}' }),
    randomUUID: () => 'uuid-7',
  });
  assert.equal(out.aiVerdict, 'review');
});

test('scorePracticeMediaWithoutRubric: ffmpeg failure returns review', async () => {
  const out = await scorePracticeMediaWithoutRubric({
    session: { practice_task: '刀工', key_points: [] },
    mediaType: 'video',
    filePath: '/tmp/test.mp4',
    uploadsDir: '/tmp',
    pathModule: path,
    fsModule: fs,
    execFileSync: () => { throw new Error('ffmpeg missing'); },
    callVisionLLM: async () => ({}),
    randomUUID: () => 'uuid-8',
  });
  assert.match(out.aiFeedback, /视频处理失败/);
});

test('scorePracticeMediaWithoutRubric: outer catch on image', async () => {
  const out = await scorePracticeMediaWithoutRubric({
    session: { practice_task: '摆盘', key_points: [] },
    mediaType: 'image',
    filePath: '/tmp/test.jpg',
    uploadsDir: '/tmp',
    pathModule: path,
    fsModule: fs,
    execFileSync: () => {},
    callVisionLLM: async () => { throw new Error('ai fail'); },
    randomUUID: () => 'uuid-9',
  });
  assert.match(out.aiFeedback, /AI 判定失败/);
});
