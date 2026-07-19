import test from 'node:test';
import assert from 'node:assert/strict';
import { characterErrorRate, levenshteinDistance, normalizeTranscript } from './customer-voice-roundtrip-eval.mjs';

test('normalizes punctuation and spaces before comparing transcripts', () => {
  assert.equal(normalizeTranscript('好的，P O S 数据。'), '好的pos数据');
});

test('computes character edit distance', () => {
  assert.equal(levenshteinDistance('方案', '方法'), 1);
  assert.equal(levenshteinDistance('数据', '数据'), 0);
});

test('reports zero error for punctuation-only differences', () => {
  assert.equal(characterErrorRate('好的，我们继续。', '好的我们继续'), 0);
});
