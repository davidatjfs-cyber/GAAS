/**
 * P5.4 peel: knowledge file parse + cloud upload (from runCreateKnowledgeBackground).
 */
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import axios from 'axios';
import { childLogger } from '../../utils/logger.js';

const log = childLogger({ domain: 'knowledge', handler: 'create-background' });

function classifyKnowledgeUploadFile(body, file) {
  const declaredType = String(body?.type || '').trim();
  const mime0 = String(file?.mimetype || '').trim();
  const origName = String(file?.originalname || '');
  return {
    declaredType,
    mime0,
    origName,
    itemTitle: (body?.title || origName.replace(/\.[^.]+$/, '') || '未命名文件'),
    looksLikeImage:
      /^image\//i.test(mime0) ||
      declaredType === 'img' ||
      /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(origName),
    looksLikePDF:
      /^application\/pdf/i.test(mime0) || declaredType === 'pdf' || /\.pdf$/i.test(origName),
    looksLikeVideo:
      /^video\//i.test(mime0) ||
      declaredType === 'video' ||
      /\.(mp4|mov|webm|avi)$/i.test(origName),
    looksLikeDoc:
      /^application\/(vnd\.openxmlformats-officedocument\.wordprocessingml|msword)/i.test(mime0) ||
      declaredType === 'doc' ||
      /\.(docx?|odt)$/i.test(origName),
  };
}

async function parseKnowledgeImage(ctx, localPath, inserted, itemTitle) {
  const { pool, notifyAdminsOcrFailed } = ctx;
  try {
    const { callVisionLLM } = await import('../../agents.js');
    const vr = await callVisionLLM(
      localPath,
      '请完整提取图片中的全部文字（含标题、表格、列表、备注），按阅读顺序输出，使用简体中文。',
      { maxTokens: 8192 }
    );
    if (vr?.ok && String(vr.content || '').trim()) {
      await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [
        String(vr.content).trim(),
        inserted.id,
      ]);
      return true;
    }
    const reason = vr?.error || '视觉模型返回内容为空';
    log.warn({ msg: 'knowledge_image_ocr_failed', detail: [reason] });
    void notifyAdminsOcrFailed(itemTitle, '图片', reason);
  } catch (ocrErr) {
    const reason = String(ocrErr?.message || ocrErr);
    log.warn({ msg: 'knowledge_image_ocr_error', detail: [reason] });
    void notifyAdminsOcrFailed(itemTitle, '图片', reason);
  }
  return false;
}

async function parseKnowledgeVideo(ctx, localPath, inserted, itemTitle) {
  const { pool, notifyAdminsOcrFailed } = ctx;
  let tmpDir = null;
  try {
    tmpDir = `/tmp/video_frames_${inserted.id}`;
    fs.mkdirSync(tmpDir, { recursive: true });
    const probe = execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', localPath],
      { encoding: 'utf-8', timeout: 15000 }
    );
    const duration = parseFloat(probe.trim()) || 30;
    const frameCount = Math.min(Math.max(6, Math.ceil(duration / 3)), 18);
    const interval = duration / (frameCount + 1);
    const frames = [];
    for (let i = 1; i <= frameCount; i++) {
      const t = interval * i;
      const outFile = `${tmpDir}/frame_${String(i).padStart(3, '0')}.jpg`;
      execFileSync(
        'ffmpeg',
        ['-ss', String(t), '-i', localPath, '-vframes', '1', '-q:v', '3', '-vf', 'scale=1280:-1', '-y', outFile],
        { encoding: 'utf-8', timeout: 30000 }
      );
      if (fs.existsSync(outFile)) frames.push(outFile);
    }
    if (frames.length === 0) {
      void notifyAdminsOcrFailed(itemTitle, '视频', 'ffmpeg 未提取到帧');
      return false;
    }
    const qwenApiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || '';
    const qwenBaseUrl = process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const messages = [
      {
        type: 'text',
        text:
          '你是资深餐饮SOP编写专家。视频标题为「' +
          itemTitle +
          '」。分析截图编写标准操作流程(SOP)。\n\n重要说明：如果视频中多个物料（如多只鸭子）依次进行相同操作，这是**同一工序**应用于多个物料，不是多道工序。请正确合并为一道工序。标题已明确食材，请直接使用。\n\n要求：(1)分步骤格式，每步包含：步骤编号、操作动作、建议时长、操作要点、注意事项；(2)使用专业烹饪术语；(3)包括设备、工具、温度参考值。输出简体中文Markdown。',
      },
    ];
    for (const f of frames) {
      const buf = fs.readFileSync(f);
      messages.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` } });
    }
    let rawText = '';
    if (qwenApiKey) {
      const resp = await axios.post(
        `${qwenBaseUrl}/chat/completions`,
        {
          model: 'qwen-vl-max',
          messages: [{ role: 'user', content: messages }],
          temperature: 0.1,
          max_tokens: 8192,
        },
        {
          headers: { Authorization: `Bearer ${qwenApiKey}`, 'Content-Type': 'application/json' },
          timeout: 120000,
        }
      );
      rawText = String(resp.data?.choices?.[0]?.message?.content || '').trim();
    } else {
      const { callVisionLLM } = await import('../../agents.js');
      const vr = await callVisionLLM(messages, '', { maxTokens: 8192 });
      rawText = String(vr?.content || '').trim();
    }
    if (!rawText) {
      log.warn({ msg: 'knowledge_video_analysis_returned_empty' });
      void notifyAdminsOcrFailed(itemTitle, '视频', '视觉模型返回为空');
      return false;
    }
    const { callLLM } = await import('../../agents.js');
    const fmtResp = await callLLM(
      [
        {
          role: 'system',
          content:
            '你是餐饮SOP编辑专家。你的任务：(1)用专业知识纠正AI视觉分析的工序误判——特别是"烫皮"工序，标准工艺为**一道烫皮**（过程中多次浸入沸水以确保均匀受热），如果原文出现"第二次烫皮""重复烫皮""再次烫皮"或类似内容，必须**合并进第一次烫皮步骤**，保留其时间数据和操作要点，不得作为独立步骤；(2)格式化输出：每步有编号、操作动作、建议时长、操作要点、注意事项；(3)添加标题和关键控制点。输出简体中文Markdown。',
        },
        { role: 'user', content: '整理以下SOP内容，纠正工序误判：\n\n' + rawText },
      ],
      { maxTokens: 4096 }
    );
    const finalText = String(fmtResp?.content || rawText).trim();
    await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [
      finalText,
      inserted.id,
    ]);
    return true;
  } catch (vidErr) {
    const reason = String(vidErr?.message || vidErr);
    log.warn({ msg: 'knowledge_video_process_error', detail: [reason] });
    void notifyAdminsOcrFailed(itemTitle, '视频', reason);
    return false;
  } finally {
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {
        /* ignore */
      }
    }
  }
}

async function parseKnowledgePdf(ctx, localPath, inserted, itemTitle) {
  const { pool, notifyAdminsOcrFailed } = ctx;
  try {
    try {
      const text = execFileSync('pdftotext', [localPath, '-'], {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      }).trim();
      if (text) {
        await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [
          text,
          inserted.id,
        ]);
        return true;
      }
    } catch (_pdftotextErr) {
      /* fall through */
    }
    let tmpDir = null;
    try {
      tmpDir = `/tmp/pdf_ocr_${inserted.id}`;
      fs.mkdirSync(tmpDir, { recursive: true });
      execFileSync('pdftoppm', ['-png', '-r', '200', localPath, `${tmpDir}/page`], {
        encoding: 'utf-8',
        timeout: 30000,
      });
      const pages = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.png')).sort();
      if (pages.length === 0) {
        void notifyAdminsOcrFailed(itemTitle, 'PDF', 'pdftoppm 转换 PDF 页面数为 0');
        return false;
      }
      const { callVisionLLM } = await import('../../agents.js');
      const content = [
        {
          type: 'text',
          text: '请完整提取这份文档中所有文字内容，包括标题、正文、列表等，按阅读顺序输出，使用简体中文。',
        },
      ];
      for (const page of pages) {
        const buf = fs.readFileSync(`${tmpDir}/${page}`);
        content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${buf.toString('base64')}` } });
      }
      const vr = await callVisionLLM(content, '', { maxTokens: 8192 });
      if (vr?.ok && String(vr.content || '').trim()) {
        await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [
          String(vr.content).trim(),
          inserted.id,
        ]);
        return true;
      }
      const reason = vr?.error || 'PDF 图片转换后视觉模型返回为空';
      log.warn({ msg: 'knowledge_pdf_ocr_failed', detail: [reason] });
      void notifyAdminsOcrFailed(itemTitle, 'PDF 扫描件', reason);
    } finally {
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {
          /* ignore */
        }
      }
    }
  } catch (pdfErr) {
    const reason = String(pdfErr?.message || pdfErr);
    log.warn({ msg: 'knowledge_pdf_parse_error', detail: [reason] });
    void notifyAdminsOcrFailed(itemTitle, 'PDF', reason);
  }
  return false;
}

async function parseKnowledgeDoc(ctx, localPath, inserted, itemTitle) {
  const { pool, notifyAdminsOcrFailed } = ctx;
  try {
    const mammoth = require('mammoth');
    const docResult = await mammoth.extractRawText({ path: localPath });
    const docText = String(docResult?.value || '').trim();
    if (docText) {
      await pool.query('UPDATE knowledge_base SET content = $1, updated_at = now() WHERE id = $2', [
        docText,
        inserted.id,
      ]);
      return true;
    }
    log.warn({ msg: 'knowledge_word_document_returned_empty_text', detail: [itemTitle] });
    void notifyAdminsOcrFailed(itemTitle, 'Word文档', 'mammoth提取文本为空');
  } catch (docErr) {
    const reason = String(docErr?.message || docErr);
    log.warn({ msg: 'knowledge_word_document_parse_error', detail: [reason] });
    void notifyAdminsOcrFailed(itemTitle, 'Word文档', reason);
  }
  return false;
}

export async function parseKnowledgeUploadedFile(ctx, { inserted, localPath, body, file }) {
  if (!inserted?.id || !localPath || !fs.existsSync(localPath)) return;
  const kinds = classifyKnowledgeUploadFile(body, file);
  if (kinds.looksLikeImage) await parseKnowledgeImage(ctx, localPath, inserted, kinds.itemTitle);
  if (kinds.looksLikeVideo) await parseKnowledgeVideo(ctx, localPath, inserted, kinds.itemTitle);
  if (kinds.looksLikePDF) await parseKnowledgePdf(ctx, localPath, inserted, kinds.itemTitle);
  if (kinds.looksLikeDoc) await parseKnowledgeDoc(ctx, localPath, inserted, kinds.itemTitle);
}

export async function uploadKnowledgeFileToCloud(ctx, { inserted, localPath, file, body, tenantId }) {
  const {
    pool,
    inferContentType,
    buildInlineContentDisposition,
    getCosClient,
    getOssClient,
    buildCosPublicUrl,
    buildOssPublicUrl,
    COS_BUCKET,
    COS_REGION,
    OSS_PART_SIZE_MB,
    OSS_PARALLEL,
    OSS_RETRY_COUNT,
    OSS_TIMEOUT_MS,
  } = ctx;
  if (!localPath || !inserted?.id) return;
  const orig = String(file?.originalname || 'file');
  const ext = path.extname(orig).slice(0, 16);
  const tenantForKey = String(tenantId || 'default').trim() || 'default';
  const objectKey = `hrms/knowledge/${tenantForKey}/${randomUUID()}${ext}`;
  const contentType = inferContentType({
    declaredType: body?.type,
    originalName: orig,
    mimeType: file?.mimetype,
  });

  let finalUrl = '';
  const cos = getCosClient();
  if (cos) {
    await new Promise((resolve, reject) => {
      cos.sliceUploadFile(
        { Bucket: COS_BUCKET, Region: COS_REGION, Key: objectKey, FilePath: localPath },
        (err, data) => {
          if (err) return reject(err);
          return resolve(data);
        }
      );
    });
    try {
      await new Promise((resolve, reject) => {
        cos.putObjectCopy(
          {
            Bucket: COS_BUCKET,
            Region: COS_REGION,
            Key: objectKey,
            CopySource: `${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${objectKey}`,
            MetadataDirective: 'Replaced',
            ContentType: contentType,
            ContentDisposition: buildInlineContentDisposition(orig),
          },
          (err, data) => {
            if (err) return reject(err);
            return resolve(data);
          }
        );
      });
    } catch (_e) {
      /* ignore */
    }
    finalUrl = buildCosPublicUrl(objectKey) || '';
  } else {
    const oss = getOssClient();
    if (oss) {
      const partSize = Math.max(1, OSS_PART_SIZE_MB) * 1024 * 1024;
      const parallel = Math.max(1, OSS_PARALLEL);
      await oss.multipartUpload(objectKey, localPath, {
        partSize,
        parallel,
        retryCount: Math.max(0, OSS_RETRY_COUNT),
        timeout: Math.max(10000, OSS_TIMEOUT_MS),
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': buildInlineContentDisposition(orig),
        },
      });
      finalUrl = buildOssPublicUrl(objectKey) || '';
    }
  }

  if (!finalUrl) return;
  await pool.query('update knowledge_base set file_path = $1, updated_at = now() where id = $2', [
    finalUrl,
    inserted.id,
  ]);
  try {
    fs.unlinkSync(localPath);
  } catch (_e) {
    /* ignore */
  }
}

export async function runCreateKnowledgeBackgroundBody(ctx, payload) {
  const { inserted, localPath, body, file, tenantId } = payload;
  try {
    await parseKnowledgeUploadedFile(ctx, { inserted, localPath, body, file });
  } catch (e) {
    log.warn({ msg: 'knowledge_file_parse_block', err: e?.message || e });
  }
  try {
    await uploadKnowledgeFileToCloud(ctx, { inserted, localPath, file, body, tenantId });
  } catch (e) {
    log.warn({ msg: 'knowledge_async_cloud_upload_failed', err: e?.message || String(e) });
  }
}
