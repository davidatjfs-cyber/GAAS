#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const DEFAULT_INSTRUCTION = '像一位30岁左右的真人女性餐饮顾问在微信里自然回复客户。语气温暖、克制、可信，有自然停顿和轻微呼吸感；不要播音腔，不要客服腔，不要逐字匀速朗读，不要夸张情绪。';
const CANDIDATES = [
  { id: 'baseline', model: 'qwen-audio-3.0-tts-plus', voice: 'longanlingxin', mode: 'static' },
  { id: 'lingxin_dynamic', model: 'qwen-audio-3.0-tts-plus', voice: 'longanlingxin', mode: 'dynamic' },
  { id: 'xiaoxin_flash', model: 'qwen-audio-3.0-tts-flash', voice: 'longanxiaoxin', mode: 'dynamic' },
  { id: 'fengyue_flash', model: 'qwen-audio-3.0-tts-flash', voice: 'longanfengyue', mode: 'dynamic' },
];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

export function anonymizeSpeechText(text = '') {
  return String(text || '')
    .replace(/https?:\/\/\S+/gi, '[链接]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[编号]')
    .replace(/[\u4e00-\u9fffA-Za-z0-9]{2,24}(?:有限责任公司|有限公司)/g, '某公司')
    .trim();
}

export function prepareSpeechText(text = '') {
  return anonymizeSpeechText(text)
    .replace(/POS/gi, 'P O S')
    .replace(/1\s*[～~-]\s*2家/g, '一到两家')
    .replace(/30天/g, '三十天')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifySpeechTone(text = '') {
  const value = String(text || '');
  if (/(抱歉|不好意思|理解|担心|顾虑|投诉|确实|着急)/.test(value)) return 'empathy';
  if (/(在吗|您好|你好|没问题|好的|当然|可以的)/.test(value) && value.length < 70) return 'quick';
  if (/(首先|其次|具体|数据|方案|试用|评估|步骤|流程|比如|例如|\d)/.test(value) || value.length > 85) return 'explain';
  if (/[？?]$/.test(value)) return 'question';
  return 'conversation';
}

export function buildSpeechDirection(text = '', mode = 'dynamic') {
  if (mode === 'static') return { tone: 'baseline', rate: 0.96, instruction: DEFAULT_INSTRUCTION };
  const tone = classifySpeechTone(text);
  const common = '像一位有经验的真人女性餐饮顾问在微信语音里回复。自然随意但专业，不改变原文含义；避免播音腔、客服腔和逐字匀速朗读。';
  const styles = {
    empathy: { rate: 0.93, text: '先带出理解和关心，再自然说明；重点前轻微停顿，句尾克制地收住，不要过度热情。' },
    quick: { rate: 0.98, text: '像刚看到微信后马上回应，亲切轻快，带很轻的微笑感，短句干净利落。' },
    explain: { rate: 0.95, text: '从容解释，按意群自然停顿；数字和关键结论稍作强调，不要像念方案或做宣讲。' },
    question: { rate: 0.97, text: '像面对面继续聊天一样自然发问，语气真诚，问句尾音不要夸张上扬。' },
    conversation: { rate: 0.96, text: '保持松弛、可信的聊天感，长短句节奏有变化，句尾自然收住。' },
  };
  return { tone, rate: styles[tone].rate, instruction: `${common}${styles[tone].text}` };
}

function parseEnv(text = '') {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

function buildEndpoint(wsHost) {
  const raw = String(wsHost || '').trim();
  if (!raw) throw new Error('DASHSCOPE_TTS_WS_HOST is missing');
  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `wss://${raw}`);
  url.protocol = 'https:';
  url.pathname = '/api/v1/services/audio/tts/SpeechSynthesizer';
  url.search = '';
  return url.toString();
}

async function synthesizeMp3({ endpoint, apiKey, candidate, text, direction }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: candidate.model,
      input: {
        text,
        voice: candidate.voice,
        format: 'mp3',
        sample_rate: 24000,
        volume: 50,
        rate: direction.rate,
        pitch: 1,
        instruction: direction.instruction,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.output?.audio?.url) throw new Error(payload?.message || payload?.code || `tts_http_${response.status}`);
  const audioResponse = await fetch(payload.output.audio.url);
  if (!audioResponse.ok) throw new Error(`tts_audio_download_${audioResponse.status}`);
  return Buffer.from(await audioResponse.arrayBuffer());
}

async function convertToAmr(mp3Path, amrPath) {
  await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp3Path, '-ar', '8000', '-ac', '1', '-c:a', 'libopencore_amrnb', '-b:a', '12.2k', amrPath]);
}

async function probeAudio(path) {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,bit_rate,size', '-show_entries', 'stream=codec_name,sample_rate,channels', '-of', 'json', path]);
  const data = JSON.parse(stdout);
  return { ...data.format, ...(data.streams?.[0] || {}) };
}

function blindOrder(candidates) {
  return [...candidates]
    .map((candidate) => ({ candidate, key: createHash('sha256').update(`gaas-voice-eval:${candidate.id}`).digest('hex') }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ candidate }, index) => ({ ...candidate, blind_label: String.fromCharCode(65 + index) }));
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function buildHtml(manifest) {
  const publicManifest = {
    generated_at: manifest.generated_at,
    samples: manifest.samples.map((sample) => ({
      sample_id: sample.sample_id,
      text: sample.text,
      variants: sample.variants.map(({ blind_label, mp3, amr, tone }) => ({ blind_label, mp3, amr, tone })),
    })),
  };
  const payload = JSON.stringify(publicManifest).replace(/</g, '\\u003c');
  const metrics = ['真人感', '信任感', '语气匹配', '清晰度'];
  const sampleMarkup = publicManifest.samples.map((sample) => `
<section class="sample"><div class="sample-head"><div class="sample-id">${escapeHtml(sample.sample_id)}</div><div class="sample-text">${escapeHtml(sample.text)}</div></div><div class="variants">
${sample.variants.map((variant) => `<article class="variant" data-sample="${escapeHtml(sample.sample_id)}" data-variant="${escapeHtml(variant.blind_label)}"><h3><span>版本 ${escapeHtml(variant.blind_label)}</span><span>●</span></h3><audio controls preload="none" src="${escapeHtml(variant.amr)}"></audio><div class="format"><button data-src="${escapeHtml(variant.amr)}" class="active">AMR 实际发送</button><button data-src="${escapeHtml(variant.mp3)}">MP3 原声</button></div><div class="scores">${metrics.map((metric) => `<label class="score"><span>${metric}</span><input type="range" min="1" max="5" step="1" value="3" data-metric="${metric}"><output>3</output></label>`).join('')}</div></article>`).join('\n')}
</div></section>`).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>客户 AI 声音盲听室</title><style>
:root{--paper:#f4efe4;--ink:#18211b;--accent:#d94d2b;--line:#bdb5a5;--soft:#e8e0d2}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Songti SC","Noto Serif CJK SC",serif}header{padding:46px clamp(22px,5vw,72px) 28px;border-bottom:1px solid var(--line);display:grid;grid-template-columns:1fr auto;gap:28px;align-items:end}h1{font-size:clamp(38px,7vw,84px);line-height:.92;letter-spacing:-.06em;margin:0;max-width:800px}.kicker{font-family:"PingFang SC",sans-serif;font-size:12px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}.note{font-family:"PingFang SC",sans-serif;max-width:360px;line-height:1.7;font-size:14px}.toolbar{position:sticky;top:0;z-index:5;background:rgba(244,239,228,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:12px clamp(22px,5vw,72px);display:flex;gap:12px;align-items:center}.toolbar button{border:1px solid var(--ink);background:transparent;padding:9px 14px;cursor:pointer}.toolbar button.primary{background:var(--ink);color:var(--paper)}#progress{margin-left:auto;font-family:monospace}.samples{padding:24px clamp(22px,5vw,72px) 80px}.sample{border-bottom:1px solid var(--line);padding:34px 0}.sample-head{display:grid;grid-template-columns:74px 1fr;gap:20px;margin-bottom:24px}.sample-id{font:700 24px/1 monospace;color:var(--accent)}.sample-text{font-size:20px;line-height:1.65}.variants{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.variant{background:rgba(255,255,255,.28);border:1px solid var(--line);padding:16px}.variant h3{font:700 15px/1 "PingFang SC",sans-serif;margin:0 0 14px;display:flex;justify-content:space-between}.format{display:flex;gap:6px;margin:10px 0}.format button{font:12px monospace;border:0;border-bottom:1px solid transparent;background:none;padding:4px;cursor:pointer}.format button.active{border-color:var(--accent);color:var(--accent)}audio{width:100%;height:34px}.scores{display:grid;gap:8px;margin-top:14px;font:12px "PingFang SC",sans-serif}.score{display:grid;grid-template-columns:54px 1fr 18px;gap:8px;align-items:center}.score input{accent-color:var(--accent)}@media(max-width:980px){header{grid-template-columns:1fr}.variants{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.variants{grid-template-columns:1fr}.sample-head{grid-template-columns:1fr}.sample-text{font-size:17px}}
</style></head><body><header><div><div class="kicker">GAAS / Voice Lab / Blind Test</div><h1>听见一个<br>真正的人</h1></div><div class="note">回复文字已锁定不变。请优先听 AMR，它代表客户在企业微信中真正听到的效果；MP3 用来判断模型原始音质。</div></header><div class="toolbar"><button id="all-amr">全部切到 AMR</button><button id="all-mp3">全部切到 MP3</button><button id="export" class="primary">导出评分</button><span id="progress">0 / ${publicManifest.samples.length * 16}</span></div><main class="samples" id="samples">${sampleMarkup}</main><script>
const manifest=${payload};const key=(s,v,m)=>'voice-eval:'+s+':'+v+':'+m;
function bind(){document.querySelectorAll('.format button').forEach(b=>b.onclick=()=>{const card=b.closest('.variant');card.querySelector('audio').src=b.dataset.src;card.querySelectorAll('.format button').forEach(x=>x.classList.toggle('active',x===b))});document.querySelectorAll('.score input').forEach(i=>{const c=i.closest('.variant');i.value=localStorage.getItem(key(c.dataset.sample,c.dataset.variant,i.dataset.metric))||3;i.nextElementSibling.value=i.value;i.oninput=()=>{i.nextElementSibling.value=i.value;localStorage.setItem(key(c.dataset.sample,c.dataset.variant,i.dataset.metric),i.value);updateProgress()}})}function updateProgress(){document.querySelector('#progress').textContent=Object.keys(localStorage).filter(k=>k.startsWith('voice-eval:')).length+' / '+(manifest.samples.length*16)}document.querySelector('#all-amr').onclick=()=>document.querySelectorAll('.variant').forEach(c=>c.querySelectorAll('.format button')[0].click());document.querySelector('#all-mp3').onclick=()=>document.querySelectorAll('.variant').forEach(c=>c.querySelectorAll('.format button')[1].click());document.querySelector('#export').onclick=()=>{const scores={};Object.keys(localStorage).filter(k=>k.startsWith('voice-eval:')).forEach(k=>scores[k]=localStorage[k]);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({generated_at:new Date().toISOString(),scores},null,2)],{type:'application/json'}));a.download='voice-eval-scores.json';a.click()};bind();updateProgress();
</script></body></html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.corpus || !args.out || !args.env) throw new Error('usage: node scripts/customer-voice-eval.mjs --corpus corpus.ndjson --out output-dir --env /path/to/.env');
  const outputDir = resolve(args.out);
  const env = parseEnv(await readFile(resolve(args.env), 'utf8'));
  const apiKey = env.DASHSCOPE_TTS_API_KEY || env.QWEN_API_KEY || env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DashScope API key is missing');
  const endpoint = buildEndpoint(env.DASHSCOPE_TTS_WS_HOST);
  const allCorpus = (await readFile(resolve(args.corpus), 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const requestedLimit = Number(args.limit || allCorpus.length);
  const corpus = allCorpus.slice(0, Number.isFinite(requestedLimit) ? Math.max(1, requestedLimit) : allCorpus.length);
  const selectedCandidates = args.candidate ? CANDIDATES.filter((candidate) => candidate.id === args.candidate) : CANDIDATES;
  if (!selectedCandidates.length) throw new Error(`Unknown candidate: ${args.candidate}`);
  const candidates = blindOrder(selectedCandidates);
  await mkdir(outputDir, { recursive: true });
  const manifest = { generated_at: new Date().toISOString(), samples: [], candidate_key: candidates.map(({ blind_label, ...candidate }) => ({ blind_label, ...candidate })) };
  for (let sampleIndex = 0; sampleIndex < corpus.length; sampleIndex += 1) {
    const source = corpus[sampleIndex];
    const text = prepareSpeechText(source.text);
    const sample = { sample_id: source.sample_id, length_bucket: source.length_bucket, text, variants: [] };
    for (const candidate of candidates) {
      const direction = buildSpeechDirection(text, candidate.mode);
      const stem = `${source.sample_id}-${candidate.blind_label}`;
      const mp3Path = join(outputDir, `${stem}.mp3`);
      const amrPath = join(outputDir, `${stem}.amr`);
      process.stdout.write(`[${sampleIndex + 1}/${corpus.length}] ${source.sample_id} version ${candidate.blind_label}... `);
      try {
        let resumed = true;
        try {
          await Promise.all([access(mp3Path), access(amrPath)]);
        } catch (_) {
          resumed = false;
          const mp3 = await synthesizeMp3({ endpoint, apiKey, candidate, text, direction });
          await writeFile(mp3Path, mp3);
          await convertToAmr(mp3Path, amrPath);
        }
        const [mp3Probe, amrProbe] = await Promise.all([probeAudio(mp3Path), probeAudio(amrPath)]);
        sample.variants.push({
          blind_label: candidate.blind_label,
          candidate_id: candidate.id,
          tone: direction.tone,
          rate: direction.rate,
          mp3: basename(mp3Path),
          amr: basename(amrPath),
          mp3_probe: mp3Probe,
          amr_probe: amrProbe,
        });
        process.stdout.write(resumed ? 'resumed\n' : 'ok\n');
      } catch (error) {
        sample.variants.push({ blind_label: candidate.blind_label, candidate_id: candidate.id, tone: direction.tone, rate: direction.rate, error: error?.message || String(error) });
        process.stdout.write(`failed: ${error?.message || error}\n`);
      }
    }
    manifest.samples.push(sample);
    await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }
  await writeFile(join(outputDir, 'index.html'), buildHtml(manifest));
  console.log(`Generated ${manifest.samples.length * candidates.length} blind variants in ${outputDir}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(error); process.exitCode = 1; });
