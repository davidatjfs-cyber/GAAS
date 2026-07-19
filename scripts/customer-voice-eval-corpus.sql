WITH deduplicated AS (
  SELECT DISTINCT ON (content)
    btrim(content) AS content,
    created_at
  FROM sales_messages
  WHERE direction = 'outbound'
    AND sender = 'ai'
    AND char_length(btrim(content)) BETWEEN 10 AND 180
    AND content NOT LIKE '%人工控场中%'
  ORDER BY content, created_at DESC
), bucketed AS (
  SELECT
    content,
    created_at,
    ntile(4) OVER (ORDER BY char_length(content), md5(content)) AS length_bucket
  FROM deduplicated
), ranked AS (
  SELECT
    content,
    created_at,
    length_bucket,
    row_number() OVER (PARTITION BY length_bucket ORDER BY md5(content)) AS bucket_rank
  FROM bucketed
), picked AS (
  SELECT content, created_at, length_bucket
  FROM ranked
  WHERE bucket_rank <= 5
)
SELECT json_build_object(
  'sample_id', 'S' || lpad(row_number() OVER (ORDER BY length_bucket, md5(content))::text, 2, '0'),
  'length_bucket', length_bucket,
  'text', regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(content, 'https?://[^[:space:]]+', '[链接]', 'gi'),
        '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}', '[邮箱]', 'gi'
      ),
      '(^|[^0-9])1[3-9][0-9]{9}([^0-9]|$)', '\1[手机号]\2', 'g'
    ),
    '[[:alnum:]一-龥]{2,24}(有限责任公司|有限公司)', '某公司', 'g'
  )
)::text
FROM picked
ORDER BY length_bucket, md5(content);
