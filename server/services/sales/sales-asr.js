/**
 * 语音转文字：客户发来的企微语音消息(amr) → ffmpeg转16k单声道PCM → 阿里云百炼
 * Paraformer实时语音识别(WebSocket) → 文字，接入现有客户AI对话逻辑。
 * 复用已有的 QWEN_API_KEY(DashScope)，不需要额外开通新账号。
 */
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'sales', handler: 'asr' });

const DASHSCOPE_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
const ASR_MODEL = 'paraformer-realtime-v2';

function getDashscopeKey() {
  return String(process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '').trim();
}

/** amr(企微语音默认格式) → 16kHz单声道PCM，Paraformer实时识别要求的输入格式 */
function amrToPcm16k(amrBuffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-f', 'amr', '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1']);
    const chunks = [];
    const errChunks = [];
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => errChunks.push(d));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString().slice(-500)}`));
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.write(amrBuffer);
    ff.stdin.end();
  });
}

/**
 * 把PCM音频整段推给DashScope实时识别任务，收集所有sentence文本拼成完整转写结果。
 * 语音条通常几秒到几十秒，不是真正的直播流，这里简化成"建连→一次性推完音频→等结果→关闭"，
 * 不做增量partial展示(客户AI不需要实时看到识别过程，只要最终文字)。
 */
function recognizePcm(pcmBuffer, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = getDashscopeKey();
    if (!apiKey) return reject(new Error('dashscope_api_key_missing'));
    const taskId = randomUUID();
    const ws = new WebSocket(DASHSCOPE_WS_URL, {
      headers: { Authorization: `bearer ${apiKey}` },
    });
    let sentences = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.terminate();
      reject(new Error('asr_timeout'));
    }, timeoutMs);

    function finish(err, text) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch (_) { /* ignore */ }
      if (err) reject(err); else resolve(text);
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({
        header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: ASR_MODEL,
          parameters: { format: 'pcm', sample_rate: 16000 },
          input: {},
        },
      }));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
      const event = msg?.header?.event;
      if (event === 'task-started') {
        // 分块推流(每块约100ms音频)，避免一次性发太大帧
        const chunkBytes = 3200; // 16000Hz * 2byte * 0.1s
        for (let i = 0; i < pcmBuffer.length; i += chunkBytes) {
          ws.send(pcmBuffer.subarray(i, i + chunkBytes));
        }
        ws.send(JSON.stringify({
          header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
          payload: { input: {} },
        }));
      } else if (event === 'result-generated') {
        const sentence = msg?.payload?.output?.sentence;
        if (sentence?.text) sentences = [sentence.text]; // 实时识别持续覆盖同一句直到final，取最后一次
      } else if (event === 'task-finished') {
        finish(null, sentences.join('').trim());
      } else if (event === 'task-failed') {
        finish(new Error(msg?.header?.error_message || 'asr_task_failed'), null);
      }
    });

    ws.on('error', (e) => finish(e, null));
    ws.on('close', () => finish(new Error('asr_connection_closed_before_result'), null));
  });
}

/** 对外唯一入口：amr语音Buffer → 识别文字；识别失败返回 null 而不是抛出，调用方按"没听清"处理 */
export async function transcribeAmrVoice(amrBuffer) {
  try {
    const pcm = await amrToPcm16k(amrBuffer);
    const text = await recognizePcm(pcm);
    return text || null;
  } catch (e) {
    log.error({ msg: 'transcribe_failed', err: e?.message || String(e) });
    return null;
  }
}

/** 浏览器录音(webm/ogg/wav/mp3…) → 文字；识别失败返回 null */
export async function transcribeBrowserVoice(audioBuffer, { mimeType = 'audio/webm' } = {}) {
  try {
    const fmt = guessFfmpegFormat(mimeType);
    const pcm = await anyAudioToPcm16k(audioBuffer, fmt);
    const text = await recognizePcm(pcm);
    return text || null;
  } catch (e) {
    log.error({ msg: 'transcribe_browser_failed', err: e?.message || String(e) });
    return null;
  }
}

function guessFfmpegFormat(mimeType = '') {
  const m = String(mimeType || '').toLowerCase();
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a')) return 'mp4';
  if (m.includes('amr')) return 'amr';
  return 'webm';
}

function anyAudioToPcm16k(buffer, inputFormat) {
  return new Promise((resolve, reject) => {
    const args = ['-f', inputFormat, '-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 's16le', 'pipe:1'];
    // webm/ogg 有时容器探测比强制 -f 更稳
    if (inputFormat === 'webm' || inputFormat === 'ogg') {
      args.splice(0, 2); // drop -f inputFormat，让 ffmpeg 自探
    }
    const ff = spawn('ffmpeg', args);
    const chunks = [];
    const errChunks = [];
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => errChunks.push(d));
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errChunks).toString().slice(-500)}`));
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.write(buffer);
    ff.stdin.end();
  });
}
