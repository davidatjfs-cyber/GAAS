-- 历史兼容：晋升流程已完成的旧培训认证不回撤；新培训仍必须完成实操审核。
ALTER TABLE training_certifications
  ADD COLUMN IF NOT EXISTS legacy_accepted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_training_cert_legacy_accepted
  ON training_certifications (employee_username, topic_id, tenant_id)
  WHERE legacy_accepted = TRUE;

-- 只承接已经进入/完成晋升流程的历史能力项，不把普通培训提交或失败记录伪造成通过。
WITH promoted_topics AS (
  SELECT DISTINCT
    lower(track->>'applicantUsername') AS username,
    (jsonb_array_elements_text(track->'requiredTopicIds'))::int AS topic_id,
    'default'::varchar(80) AS tenant_id
  FROM hrms_state s
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.data->'promotionTracks', '[]'::jsonb)) track
  WHERE s.key = 'default'
    AND track->>'status' IN ('qualification_approved', 'assessment_passed', 'promoted')
    AND jsonb_typeof(track->'requiredTopicIds') = 'array'
    AND jsonb_array_length(track->'requiredTopicIds') > 0
), latest_cert AS (
  SELECT DISTINCT ON (c.employee_username, c.topic_id, c.tenant_id)
    c.id, c.session_id
  FROM training_certifications c
  JOIN promoted_topics p
    ON lower(c.employee_username) = p.username
   AND c.topic_id = p.topic_id
   AND c.tenant_id = p.tenant_id
  ORDER BY c.employee_username, c.topic_id, c.tenant_id, c.created_at DESC, c.id DESC
)
UPDATE training_certifications c
SET legacy_accepted = TRUE,
    manager_verdict = 'passed',
    review_status = 'legacy_accepted',
    final_score = COALESCE(c.final_score, c.ai_total_score, 100),
    certified_at = COALESCE(c.certified_at, c.created_at),
    status = 'valid'
FROM latest_cert l
WHERE c.id = l.id;

UPDATE training_sessions s
SET status = 'certified',
    certified_at = COALESCE(s.certified_at, NOW())
WHERE EXISTS (
  SELECT 1 FROM training_certifications c
  WHERE c.session_id = s.id AND c.legacy_accepted = TRUE
);
