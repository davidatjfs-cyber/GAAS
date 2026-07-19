#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

export function normalizeTranscript(text = '') {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function levenshteinDistance(left = '', right = '') {
  const a = [...left];
  const b = [...right];
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

export function characterErrorRate(expected = '', actual = '') {
  const normalizedExpected = normalizeTranscript(expected);
  const normalizedActual = normalizeTranscript(actual);
  return levenshteinDistance(normalizedExpected, normalizedActual) / Math.max(1, [...normalizedExpected].length);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifest || !args['audio-dir'] || !args.out || !args.env || !args['asr-module']) {
    throw new Error('usage: node customer-voice-roundtrip-eval.mjs --manifest manifest.json --audio-dir dir --out result.json --env .env --asr-module sales-asr.js');
  }
  process.loadEnvFile(resolve(args.env));
  const { transcribeAmrVoice } = await import(pathToFileURL(resolve(args['asr-module'])).href);
  const manifest = JSON.parse(await readFile(resolve(args.manifest), 'utf8'));
  const results = [];
  for (let sampleIndex = 0; sampleIndex < manifest.samples.length; sampleIndex += 1) {
    const sample = manifest.samples[sampleIndex];
    for (const variant of sample.variants) {
      process.stdout.write(`[${sampleIndex + 1}/${manifest.samples.length}] ${sample.sample_id} version ${variant.blind_label}... `);
      const audio = await readFile(resolve(args['audio-dir'], variant.amr));
      const transcript = await transcribeAmrVoice(audio);
      const cer = transcript ? characterErrorRate(sample.text, transcript) : 1;
      results.push({ sample_id: sample.sample_id, blind_label: variant.blind_label, candidate_id: variant.candidate_id, transcript, cer });
      process.stdout.write(`${transcript ? `CER=${cer.toFixed(3)}` : 'failed'}\n`);
      await writeFile(resolve(args.out), JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
    }
  }
  const summary = manifest.candidate_key.map((candidate) => {
    const rows = results.filter((row) => row.candidate_id === candidate.id);
    const meanCer = rows.reduce((total, row) => total + row.cer, 0) / Math.max(1, rows.length);
    return { blind_label: candidate.blind_label, candidate_id: candidate.id, mean_cer: meanCer, clarity_score: Math.max(0, 100 * (1 - meanCer)), failed: rows.filter((row) => !row.transcript).length };
  });
  const report = { generated_at: new Date().toISOString(), summary, results };
  await writeFile(resolve(args.out), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
