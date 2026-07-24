/**
 * COS/OSS client + public URL helpers (OSS currently stubbed).
 */

export function createObjectStorageHelpers({
  COS,
  cosSecretId,
  cosSecretKey,
  cosBucket,
  cosRegion,
  cosPublicBaseUrl,
}) {
  function getOssClient() {
    return null;
  }

  function getCosClient() {
    if (!cosSecretId || !cosSecretKey || !cosBucket || !cosRegion) return null;
    return new COS({
      SecretId: cosSecretId,
      SecretKey: cosSecretKey,
    });
  }

  function buildCosPublicUrl(objectKey) {
    const key = String(objectKey || '').replace(/^\/+/, '');
    if (!key) return '';
    const base = String(cosPublicBaseUrl || '').trim().replace(/\/$/, '');
    if (base) return `${base}/${key}`;
    if (!cosBucket || !cosRegion) return '';
    return `https://${cosBucket}.cos.${cosRegion}.myqcloud.com/${key}`;
  }

  function buildOssPublicUrl(_objectKey) {
    return '';
  }

  return { getOssClient, getCosClient, buildCosPublicUrl, buildOssPublicUrl };
}
