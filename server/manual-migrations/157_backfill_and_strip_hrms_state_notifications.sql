-- Tier 0: notifications 表权威化 — 从 blob 回填 hrms_user_notifications 后 strip
-- id 为 BIGSERIAL，无法保留 NOTIF-* 字符串 id，仅回填内容字段（best-effort）。
-- 运行前建议在 staging 核对 COUNT；仅写脚本，不在 CI/生产自动执行。

INSERT INTO hrms_user_notifications (target_username, title, message, type, meta, created_at, tenant_id)
SELECT
  COALESCE(NULLIF(TRIM(n->>'targetUser'), ''), NULLIF(TRIM(n->>'targetUsername'), ''), NULLIF(TRIM(n->>'to'), '')) AS target_username,
  COALESCE(NULLIF(TRIM(n->>'title'), ''), '通知') AS title,
  COALESCE(TRIM(n->>'message'), '') AS message,
  COALESCE(NULLIF(TRIM(n->>'type'), ''), 'system_notice') AS type,
  COALESCE(n->'meta', n->'data', '{}'::jsonb) AS meta,
  COALESCE(
    NULLIF(TRIM(n->>'createdAt'), '')::timestamptz,
    NOW()
  ) AS created_at,
  hs.key AS tenant_id
FROM hrms_state hs
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(hs.data->'notifications') = 'array' THEN hs.data->'notifications' ELSE '[]'::jsonb END
) AS n
WHERE jsonb_typeof(hs.data->'notifications') = 'array'
  AND jsonb_array_length(hs.data->'notifications') > 0
  AND COALESCE(NULLIF(TRIM(n->>'targetUser'), ''), NULLIF(TRIM(n->>'targetUsername'), ''), NULLIF(TRIM(n->>'to'), '')) IS NOT NULL;

UPDATE hrms_state
   SET data = data - 'notifications',
       updated_at = NOW()
 WHERE data ? 'notifications';
