/**
 * 文字转语音：AI回复文本 → 阿里云百炼 CosyVoice(WebSocket流式合成) → mp3 → ffmpeg转amr
 * (企微语音消息要求的格式)。复用已验证可用的 QWEN_API_KEY(DashScope)，跟语音识别(sales-asr.js)
 * 用同一个账号、同一套 run-task/continue-task/finish-task 协议，不再依赖MiniMax的账号配置。
 */
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';

const TTS_MODEL = 'cosyvoice-v2';
const DEFAULT_VOICE = 'longwan'; // CosyVoice经典预置女声(温柔知性)；longanlingxi是qwen-audio-3.0系列的音色，跟cosyvoice-v2不匹配导致InvalidParameter

/**
 * TTS用的是单独申请的"范围限定"API Key(只授权CosyVoice模型)，这类scoped key必须走
 * 控制台给出的专属workspace地址，不能像ASR那样用通用的 dashscope.aliyuncs.com 域名
 * (试过用通用域名调用一直报 418，换成专属Host后才通)。
 */
function getDashscopeTtsConfig() {
  return {
    apiKey: String(process.env.DASHSCOPE_TTS_API_KEY || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '').trim(),
    wsHost: String(process.env.DASHSCOPE_TTS_WS_HOST || '').trim(),
  };
}

function mp3ToAmr(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-f', 'mp3', '-i', 'pipe:0', '-ar', '8000', '-ac', '1', '-f', 'amr', 'pipe:1']);
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
function synthesizeMp3(text, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const { apiKey, wsHost } = getDashscopeTtsConfig();
    if (!apiKey) return reject(new Error('dashscope_tts_api_key_missing'));
    if (!wsHost) return reject(new Error('dashscope_tts_ws_host_missing'));
    const taskId = randomUUID();
    // 诊断用：临时改回通用地址(跟sales-asr.js的ASR连接一样)，排查是不是workspace专属地址
    // 本身不支持路由TTS请求——如果这样能通，说明问题出在专属地址而不是Key权限本身。
    const ws = new WebSocket(`wss://dashscope.aliyuncs.com/api-ws/v1/inference`, {
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
          model: TTS_MODEL,
          parameters: { text_type: 'PlainText', voice: DEFAULT_VOICE, format: 'mp3', sample_rate: 22050, volume: 50, rate: 1.0, pitch: 1.0, enable_ssml: false },
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
          payload: { input: { text: String(text || '').slice(0, 500) } },
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
      } else if (event) {
        console.log('[sales-tts] unhandled event:', event, JSON.stringify(msg).slice(0, 300));
      }
    });

    ws.on('error', (e) => finish(e));
    ws.on('close', () => { if (!settled) finish(new Error('tts_connection_closed_before_result')); });
  });
}

/** 文本 → amr语音Buffer；失败返回 null，调用方应回退到文字回复而不是让客户没收到任何消息 */
export async function synthesizeSpeechAmr(text) {
  try {
    const mp3 = await synthesizeMp3(text);
    if (!mp3?.length) { console.error('[sales-tts] 合成结果为空音频'); return null; }
    return await mp3ToAmr(mp3);
  } catch (e) {
    console.error('[sales-tts] synthesize failed:', e?.message || e);
    return null;
  }
}
