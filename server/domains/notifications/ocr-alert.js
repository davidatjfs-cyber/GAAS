/**
 * notifyAdminsOcrFailed
 * (behavior-preserving extract from index.js)
 *
 * 知识库文件 OCR/解析失败时飞书告警管理员
 * @param {string} itemTitle   文件标题
 * @param {string} fileType    类型描述（如图片、PDF、PDF 扫描件）
 * @param {string} reason      失败原因
 */

export function createNotifyAdminsOcrFailed({ pool, sendLarkMessage }) {
  return async function notifyAdminsOcrFailed(itemTitle, fileType, reason) {
    try {
      const r = await pool.query(
        `SELECT open_id FROM feishu_users
         WHERE registered = true AND open_id IS NOT NULL
           AND role = 'admin'
           AND open_id NOT LIKE '%probe%'
         LIMIT 20`
      );
      const rows = r.rows || [];
      if (!rows.length) {
        console.warn('[knowledge-ocr] no admin open_id for Feishu alert');
        return;
      }
      const timeStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
      const msg =
`【知识库文件解析失败告警】
文件：${itemTitle}
类型：${fileType || '未知'}
原因：${String(reason || '未知错误').slice(0, 500)}
时间：${timeStr}（上海）
说明：该文件自动解析失败，如需使用请在知识库中重新上传或手动填写内容。请检查视觉模型配置或服务器依赖（poppler-utils）是否正常安装。`;
      const sends = rows.map((row) =>
        sendLarkMessage(row.open_id, msg, { skipDedup: true }).catch((e) => ({ err: e?.message || e }))
      );
      const settled = await Promise.all(sends);
      const failed = settled.filter((x) => x && x.err);
      if (failed.length) {
        console.error('[knowledge-ocr] some Feishu admin alerts failed:', failed.length, failed[0]?.err);
      }
    } catch (e) {
      console.error('[knowledge-ocr] notify admins failed:', e?.message);
    }
  };
}
