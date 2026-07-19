/**
 * 文字转语音：AI回复文本 → 阿里云百炼 Qwen-Audio-TTS → mp3 → ffmpeg转amr
 * (企微语音消息要求的格式)。复用已验证可用的 QWEN_API_KEY(DashScope)，跟语音识别(sales-asr.js)
 * 用同一个账号、同一套 run-task/continue-task/finish-task 协议，不再依赖MiniMax的账号配置。
 */
import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import WebSocket from 'ws';

const DEFAULT_TTS_MODEL = 'qwen-audio-3.0-tts-plus';
const DEFAULT_VOICE = 'longanlingxin'; // Qwen Audio Plus兼容的25岁“温暖共情”真人音色
const DEFAULT_INSTRUCTION = '像一位30岁左右的真人女性餐饮顾问在微信里给客户讲明白一件事。先理解内容再自然讲出来，不是照着文字念。语气温暖、克制、可信，句子有长有短，重点处自然停顿；不要播音腔、客服腔、说明书腔或逐字匀速朗读。';
const NATURAL_TTS_MODEL = 'qwen-audio-3.0-tts-flash';
const NATURAL_TTS_VOICE = 'longanxiaoxin';
const TTS_WS_PATH = '/api-ws/v1/inference';

/**
 * TTS用的是单独申请的"范围限定"API Key(只授权CosyVoice模型)，这类scoped key必须走
 * 控制台给出的专属workspace地址，不能像ASR那样用通用的 dashscope.aliyuncs.com 域名
 * (试过用通用域名调用一直报 418，换成专属Host后才通)。
 */
function getDashscopeTtsConfig() {
  return {
    apiKey: String(process.env.DASHSCOPE_TTS_API_KEY || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '').trim(),
    wsHost: String(process.env.DASHSCOPE_TTS_WS_HOST || '').trim(),
    model: String(process.env.DASHSCOPE_TTS_MODEL || DEFAULT_TTS_MODEL).trim(),
    voice: String(process.env.DASHSCOPE_TTS_VOICE || DEFAULT_VOICE).trim(),
    instruction: String(process.env.DASHSCOPE_TTS_INSTRUCTION || DEFAULT_INSTRUCTION).trim(),
    rate: Number(process.env.DASHSCOPE_TTS_RATE || 0.96),
    naturalRolloutPercent: Number(process.env.DASHSCOPE_TTS_NATURAL_ROLLOUT_PERCENT || 0),
  };
}

export function prepareSpeechText(text = '') {
  return String(text || '')
    .replace(/POS/gi, 'P O S')
    .replace(/1\s*[～~-]\s*2家/g, '一到两家')
    .replace(/30天/g, '三十天')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildTtsParameters(config = {}) {
  const model = String(config.model || DEFAULT_TTS_MODEL).trim();
  const voice = String(config.voice || DEFAULT_VOICE).trim();
  const requestedRate = Number(config.rate ?? 0.96);
  const rate = Number.isFinite(requestedRate) ? Math.min(1.2, Math.max(0.8, requestedRate)) : 0.96;
  const parameters = {
    text_type: 'PlainText',
    voice,
    format: 'mp3',
    sample_rate: 24000,
    volume: 50,
    rate,
    pitch: 1.0,
    enable_ssml: false,
  };
  if (/^qwen-audio-|^cosyvoice-v3\.5-/.test(model)) {
    parameters.instruction = String(config.instruction || DEFAULT_INSTRUCTION).trim();
  }
  return { model, voice, parameters };
}

export function classifySpeechTone(text = '') {
  const value = String(text || '');
  if (/(抱歉|不好意思|理解|担心|顾虑|投诉|确实|着急)/.test(value)) return 'empathy';
  if (/(在吗|您好|你好|没问题|好的|当然|可以的)/.test(value) && value.length < 70) return 'quick';
  if (/(首先|其次|具体|数据|方案|试用|评估|步骤|流程|比如|例如|\d)/.test(value) || value.length > 85) return 'explain';
  if (/[？?]$/.test(value)) return 'question';
  return 'conversation';
}

export function buildNaturalSpeechDirection(text = '') {
  const tone = classifySpeechTone(text);
  const common = '像一位有经验的真人女性餐饮顾问在微信语音里给客户讲解。先理解内容，再像当面聊天一样讲出来，不是在朗读一段文字。不改变原文含义和事实；避免播音腔、客服腔、说明书腔和逐字匀速朗读。句子之间有自然节奏变化，重点稍作停顿。';
  const styles = {
    empathy: { rate: 0.93, instruction: '先带出理解和关心，再自然说明；重点前轻微停顿，句尾克制地收住，不要过度热情。' },
    quick: { rate: 0.98, instruction: '像刚看到微信后马上回应，亲切轻快，带很轻的微笑感，短句干净利落。' },
    explain: { rate: 1.0, instruction: '像客户刚问到你熟悉的功能，先用一句话讲核心，再自然补充细节。语速接近日常聊天，不要放慢成培训授课，也不要念标题、编号或标签。' },
    question: { rate: 0.97, instruction: '像面对面继续聊天一样自然发问，语气真诚，问句尾音不要夸张上扬。' },
    conversation: { rate: 0.96, instruction: '保持松弛、可信的聊天感，长短句节奏有变化，句尾自然收住。' },
  };
  return { tone, rate: styles[tone].rate, instruction: `${common}${styles[tone].instruction}` };
}

export function stableRolloutBucket(value = '') {
  const key = String(value || '').trim();
  if (!key) return 100;
  return createHash('sha256').update(key).digest().readUInt32BE(0) % 100;
}

export function buildTtsCandidateConfigs(text = '', { rolloutKey = '', rolloutPercent = 0, baseConfig = {} } = {}) {
  const percent = Number.isFinite(Number(rolloutPercent)) ? Math.min(100, Math.max(0, Number(rolloutPercent))) : 0;
  if (percent < 100 && stableRolloutBucket(rolloutKey) >= percent) return [{ ...baseConfig, variant: 'baseline' }];
  const direction = buildNaturalSpeechDirection(text);
  return [
    { ...baseConfig, model: NATURAL_TTS_MODEL, voice: NATURAL_TTS_VOICE, instruction: direction.instruction, rate: direction.rate, variant: 'natural_v1', tone: direction.tone },
    { ...baseConfig, model: DEFAULT_TTS_MODEL, voice: DEFAULT_VOICE, instruction: direction.instruction, rate: direction.rate, variant: 'natural_fallback', tone: direction.tone },
  ];
}

export function buildDashscopeTtsWsUrl(wsHost) {
  const raw = String(wsHost || '').trim();
  if (!raw) throw new Error('dashscope_tts_ws_host_missing');
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `wss://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch (_) {
    throw new Error('dashscope_tts_ws_host_invalid');
  }
  if (url.protocol !== 'wss:' || !url.hostname || url.username || url.password || url.hash) {
    throw new Error('dashscope_tts_ws_host_invalid');
  }
  if (!url.pathname || url.pathname === '/') {
    url.pathname = TTS_WS_PATH;
  } else if (url.pathname.replace(/\/$/, '') !== TTS_WS_PATH) {
    throw new Error('dashscope_tts_ws_host_invalid');
  }
  return url.toString();
}

export function buildDashscopeTtsHttpUrl(wsHost) {
  const wsUrl = new URL(buildDashscopeTtsWsUrl(wsHost));
  wsUrl.protocol = 'https:';
  wsUrl.pathname = '/api/v1/services/audio/tts/SpeechSynthesizer';
  wsUrl.search = '';
  return wsUrl.toString();
}

function mp3ToAmr(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-f', 'mp3', '-i', 'pipe:0', '-ar', '8000', '-ac', '1', '-c:a', 'libopencore_amrnb', '-b:a', '12.2k', '-f', 'amr', 'pipe:1']);
    const chunks = [];
    const errChunks = [];
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => errChunks.push(d));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString().slice(-500)}`));
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.write(mp3Buffer);
    ff.stdin.end();
  });
}

/** 通过DashScope CosyVoice流式合成把文字转成mp3二进制；跟sales-asr.js的连接协议对称(那边收二进制发文字，这边发文字收二进制) */
function synthesizeMp3(text, { timeoutMs = 20000, config = null } = {}) {
  return new Promise((resolve, reject) => {
    const resolved = config || getDashscopeTtsConfig();
    const { apiKey, wsHost } = resolved;
    const task = buildTtsParameters(resolved);
    if (!apiKey) return reject(new Error('dashscope_tts_api_key_missing'));
    let wsUrl;
    try {
      wsUrl = buildDashscopeTtsWsUrl(wsHost);
    } catch (e) {
      return reject(e);
    }
    const taskId = randomUUID();
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `bearer ${apiKey}` },
    });
    const audioChunks = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.terminate();
      reject(new Error('tts_timeout'));
    }, timeoutMs);

    function finish(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) { /* ignore */ }
      if (err) reject(err); else resolve(Buffer.concat(audioChunks));
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model: task.model,
          parameters: task.parameters,
          input: {},
        },
      }));
    });

    ws.on('message', (raw, isBinary) => {
      if (isBinary) { audioChunks.push(raw); return; }
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      const event = msg?.header?.event;
      if (event === 'task-started') {
        ws.send(JSON.stringify({
          header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: { text: prepareSpeechText(text).slice(0, 500) } },
        }));
        ws.send(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }));
      } else if (event === 'task-finished') {
        finish(null);
      } else if (event === 'task-failed') {
        console.error('[sales-tts] task-failed raw message:', JSON.stringify(msg));
        finish(new Error(msg?.header?.error_message || 'tts_task_failed'));
      } else if (event === 'result-generated') {
        // 音频数据通过二进制帧接收，该事件只是正常进度通知。
      } else if (event) {
        console.log('[sales-tts] unhandled event:', event, JSON.stringify(msg).slice(0, 300));
      }
    });

    ws.on('error', (e) => finish(e));
    ws.on('close', () => { if (!settled) finish(new Error('tts_connection_closed_before_result')); });
  });
}

async function synthesizeHttpMp3(text, { timeoutMs = 30000, config = null } = {}) {
  const resolved = config || getDashscopeTtsConfig();
  const { apiKey, wsHost } = resolved;
  if (!apiKey) throw new Error('dashscope_tts_api_key_missing');
  const task = buildTtsParameters(resolved);
  const endpoint = buildDashscopeTtsHttpUrl(wsHost);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: task.model,
        input: {
          text: prepareSpeechText(text).slice(0, 500),
          voice: task.voice,
          format: task.parameters.format,
          sample_rate: task.parameters.sample_rate,
          volume: task.parameters.volume,
          rate: task.parameters.rate,
          pitch: task.parameters.pitch,
          instruction: task.parameters.instruction,
        },
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.output?.audio?.url) {
      throw new Error(payload?.message || payload?.code || `tts_http_${response.status}`);
    }
    const audioResponse = await fetch(payload.output.audio.url, { signal: controller.signal });
    if (!audioResponse.ok) throw new Error(`tts_audio_download_${audioResponse.status}`);
    return Buffer.from(await audioResponse.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** 文本 → amr语音Buffer；失败返回 null，调用方应回退到文字回复而不是让客户没收到任何消息 */
export async function synthesizeSpeechAmr(text, { rolloutKey = '' } = {}) {
  const primary = getDashscopeTtsConfig();
  const candidates = buildTtsCandidateConfigs(text, {
    rolloutKey,
    rolloutPercent: primary.naturalRolloutPercent,
    baseConfig: primary,
  });
  if (!candidates.some((candidate) => candidate.model === 'cosyvoice-v2')) {
    candidates.push({ ...primary, model: 'cosyvoice-v2', voice: 'longwan_v2', instruction: '', rate: 0.98, variant: 'legacy_fallback' });
  }
  for (const config of candidates) {
    try {
      const mp3 = /^qwen-audio-/.test(config.model)
        ? await synthesizeHttpMp3(text, { config })
        : await synthesizeMp3(text, { config });
      if (!mp3?.length) throw new Error('tts_empty_audio');
      const amr = await mp3ToAmr(mp3);
      console.log(`[sales-tts] synthesized variant=${config.variant || 'baseline'} model=${config.model} tone=${config.tone || 'static'}`);
      return amr;
    } catch (e) {
      console.error(`[sales-tts] synthesize failed model=${config.model}:`, e?.message || e);
    }
  }
  return null;
}
