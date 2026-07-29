-- 培训实操认证支持多图：除首张 media_url 外，完整列表落 media_urls
ALTER TABLE training_certifications
  ADD COLUMN IF NOT EXISTS media_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
