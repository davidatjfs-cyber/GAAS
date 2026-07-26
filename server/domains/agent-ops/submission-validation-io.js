/**
 * Ops 巡检提交校验 — IO（P2 peel from agents.js）。
 */

export async function checkPhotoDuplicate(pool, photoHash, log) {
  try {
    const result = await pool().query(
      'SELECT COUNT(*) as count FROM agent_messages WHERE content_type LIKE %image% AND agent_data::text ILIKE $1',
      [`%${photoHash}%`]
    );
    return (result.rows[0]?.count || 0) > 1;
  } catch (e) {
    log.error('[ops] check duplicate failed:', e?.message);
    return false;
  }
}

export async function validatePhotoAuthenticityBody(deps, imageUrl, expectedLocation, submitTime) {
  const { callVisionLLM, checkPhotoDuplicate: checkDup, log } = deps;
  log.info('[ops] validating photo authenticity...');

  try {
    const visionResult = await callVisionLLM([
      { type: 'image', image_url: imageUrl },
      { type: 'text', text: `请分析这张照片：1.拍摄地点是否为${expectedLocation} 2.照片中的环境特征 3.是否有时间显示 4.照片真实性评估` },
    ]);

    const now = Date.now();
    const timeDiff = Math.abs(now - submitTime);
    const isTimeValid = timeDiff < 5 * 60 * 1000;

    const photoHash = imageUrl.split('/').pop();
    const isDuplicate = await checkDup(photoHash);

    const validation = {
      isAuthentic: isTimeValid && !isDuplicate,
      timeValid: isTimeValid,
      notDuplicate: !isDuplicate,
      locationMatch: visionResult.content?.includes(expectedLocation) || false,
      confidence: 0.8,
    };

    log.info('[ops] photo validation result:', validation);
    return validation;
  } catch (e) {
    log.error('[ops] photo validation failed:', e?.message);
    return { isAuthentic: false, error: e?.message };
  }
}
