/**
 * P4 peel: uploadPracticeMedia AI scoring helpers.
 */

export function resolvePracticeMediaType(originalExt) {
  return ['.mp4', '.mov', '.webm'].includes(String(originalExt || '').toLowerCase()) ? 'video' : 'image';
}

export function buildRubricScoringPrompt(rubric, topicTitle, mediaType) {
  const dishInfo = rubric.dish_name ? `考核菜品：${rubric.dish_name}（${rubric.station || '未知工位'}）` : '';
  return `你是餐饮实操考试审评官。请根据以下步骤评分表，逐项判断员工操作是否合格，给出具体得分和扣分原因。

【评分表】
${dishInfo}
项目：
${rubric.items.map((item, i) => {
    const name = item.action || item.name || `步骤${i + 1}`;
    const checks = item.checks || [];
    const quality = item.quality_standard ? `质量标准：${item.quality_standard}` : '';
    const failure = item.common_failure ? `常见失败：${item.common_failure}` : '';
    const critical = item.is_critical ? '【关键步骤】' : '';
    return `  ${i + 1}. ${critical} ${name}（${item.weight}分）: ${checks.join('；')}${quality ? `\n     质量：${quality}` : ''}${failure ? `\n     注意：${failure}` : ''}`;
  }).join('\n')}
一票否决项：${(rubric.fail_criteria || []).join('；')}
合格线：${rubric.pass_threshold || 80}分
实操科目：${topicTitle}

请先认真观看${mediaType === 'video' ? '完整视频' : '全部图片（多角度/多步骤）'}，然后逐项评分。严格返回JSON：
{
  "steps": [{"name":"步骤名称","score":12,"max":15,"feedback":"得分或扣分具体原因"}],
  "total_score": 88,
  "verdict": "passed/review/failed",
  "fail_reason": "一票否决原因（无则填null）",
  "summary": "整体评价，50字以内"
}
verdict说明：passed=总分≥${rubric.pass_threshold || 80}且无一票否决，review=总分60-79或存疑，failed=总分<60或有一票否决。
注意：只能输出JSON，不要任何额外文字。`;
}

export function buildJudgmentPrompt(session) {
  return `你是餐饮培训评审官。请根据以下实操任务要求，判断图片/视频帧中的操作是否合格。
任务要求：${session.practice_task || '按要求完成操作'}
考核要点：${JSON.stringify(session.key_points)}
请返回JSON：{"verdict":"passed/review/failed","feedback":"具体说明，50字以内"}
verdict说明：passed=合格，review=需人工复核，failed=不合格需重练。`;
}

function applyParsedScoring(parsed, parseScoringJson) {
  const p = parseScoringJson(parsed);
  return {
    aiVerdict: p.aiVerdict,
    aiFeedback: p.aiFeedback,
    aiStepScores: p.aiStepScores,
    aiTotalScore: p.aiTotalScore,
  };
}

function applySimpleVerdict(parsed) {
  return {
    aiVerdict: parsed.verdict || 'review',
    aiFeedback: parsed.feedback || '',
    aiStepScores: null,
    aiTotalScore: null,
  };
}

export async function scorePracticeMediaWithRubric({
  rubric,
  topicTitle,
  mediaType,
  filePath,
  filePaths,
  mediaUrl,
  uploadsDir,
  pathModule,
  fsModule,
  execFileSync,
  callVisionLLM,
  callVisionLLMVideo,
  parseScoringJson,
  randomUUID,
  serverBaseUrl,
  log,
}) {
  const scoringPrompt = buildRubricScoringPrompt(rubric, topicTitle, mediaType);
  const baseUrl = serverBaseUrl || process.env.SERVER_BASE_URL || 'https://nnyx.cc';
  const imagePaths = Array.isArray(filePaths) && filePaths.length
    ? filePaths.filter(Boolean)
    : (filePath ? [filePath] : []);

  try {
    if (mediaType === 'image') {
      let visionResult;
      if (imagePaths.length > 1) {
        const parts = [];
        for (const p of imagePaths) {
          const buf = fsModule.readFileSync(p);
          const ext = pathModule.extname(p).replace('.', '') || 'jpeg';
          parts.push({
            type: 'image_url',
            image_url: { url: `data:image/${ext};base64,${buf.toString('base64')}` },
          });
        }
        parts.push({ type: 'text', text: scoringPrompt });
        visionResult = await callVisionLLM(parts, '');
      } else {
        visionResult = await callVisionLLM(imagePaths[0] || filePath, scoringPrompt);
      }
      const text = visionResult?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { aiRawResponse: visionResult, ...applyParsedScoring(jsonMatch[0], parseScoringJson) };
      }
      return { aiRawResponse: visionResult, aiVerdict: 'review', aiFeedback: '', aiStepScores: null, aiTotalScore: null };
    }

    const videoUrl = `${baseUrl}${mediaUrl}`;
    let visionResult = await callVisionLLMVideo(videoUrl, scoringPrompt);
    if (!visionResult?.ok) {
      const frames = [];
      const frameDir = pathModule.join(uploadsDir, `frames-${randomUUID()}`);
      fsModule.mkdirSync(frameDir, { recursive: true });
      try {
        execFileSync('ffmpeg', ['-i', filePath, '-vf', 'fps=1/5,scale=480:-1', '-frames:v', '8', pathModule.join(frameDir, '%03d.jpg')], { timeout: 60000 });
        const frameFiles = fsModule.readdirSync(frameDir).sort().slice(0, 8);
        for (const f of frameFiles) {
          const buf = fsModule.readFileSync(pathModule.join(frameDir, f));
          frames.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` } });
        }
        frames.push({ type: 'text', text: scoringPrompt });
        visionResult = await callVisionLLM(frames, '');
      } finally {
        try { fsModule.rmSync(frameDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      }
    }
    const text = visionResult?.content || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return { aiRawResponse: visionResult, ...applyParsedScoring(jsonMatch[0], parseScoringJson) };
    }
    return { aiRawResponse: visionResult, aiVerdict: 'review', aiFeedback: '', aiStepScores: null, aiTotalScore: null };
  } catch (scoreErr) {
    log.error?.('[Training] Rubric scoring error:', scoreErr?.message);
    return {
      aiRawResponse: null,
      aiVerdict: 'review',
      aiFeedback: 'AI评分失败，需人工审核',
      aiStepScores: null,
      aiTotalScore: null,
    };
  }
}

export async function scorePracticeMediaWithoutRubric({
  session,
  mediaType,
  filePath,
  filePaths,
  uploadsDir,
  pathModule,
  fsModule,
  execFileSync,
  callVisionLLM,
  randomUUID,
}) {
  const judgmentPrompt = buildJudgmentPrompt(session);
  const imagePaths = Array.isArray(filePaths) && filePaths.length
    ? filePaths.filter(Boolean)
    : (filePath ? [filePath] : []);

  try {
    if (mediaType === 'image') {
      let visionResult;
      if (imagePaths.length > 1) {
        const parts = [];
        for (const p of imagePaths) {
          const buf = fsModule.readFileSync(p);
          const ext = pathModule.extname(p).replace('.', '') || 'jpeg';
          parts.push({
            type: 'image_url',
            image_url: { url: `data:image/${ext};base64,${buf.toString('base64')}` },
          });
        }
        parts.push({ type: 'text', text: judgmentPrompt });
        visionResult = await callVisionLLM(parts, '');
      } else {
        visionResult = await callVisionLLM(imagePaths[0] || filePath, judgmentPrompt);
      }
      const text = visionResult?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { aiRawResponse: visionResult, ...applySimpleVerdict(JSON.parse(jsonMatch[0])) };
      }
      return { aiRawResponse: visionResult, aiVerdict: 'review', aiFeedback: '', aiStepScores: null, aiTotalScore: null };
    }

    try {
      const framePath = pathModule.join(uploadsDir, `frame-${randomUUID()}.jpg`);
      execFileSync('ffmpeg', ['-i', filePath, '-ss', '00:00:05', '-frames:v', '1', framePath], { timeout: 30000 });
      const visionResult = await callVisionLLM(framePath, judgmentPrompt);
      const text = visionResult?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      let result = { aiRawResponse: visionResult, aiVerdict: 'review', aiFeedback: '', aiStepScores: null, aiTotalScore: null };
      if (jsonMatch) {
        result = { aiRawResponse: visionResult, ...applySimpleVerdict(JSON.parse(jsonMatch[0])) };
      }
      try { fsModule.unlinkSync(framePath); } catch (_) { /* ignore */ }
      return result;
    } catch (_ffmpegErr) {
      return {
        aiRawResponse: null,
        aiVerdict: 'review',
        aiFeedback: '视频处理失败，需人工审核',
        aiStepScores: null,
        aiTotalScore: null,
      };
    }
  } catch (_aiErr) {
    return {
      aiRawResponse: null,
      aiVerdict: 'review',
      aiFeedback: 'AI 判定失败，需人工审核',
      aiStepScores: null,
      aiTotalScore: null,
    };
  }
}
