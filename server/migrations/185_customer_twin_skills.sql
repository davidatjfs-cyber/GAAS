-- 185: 岗位教练技能化改造
-- 14 项前厅技能 + 每人每技能进度（级别/次数/成功数）+ 卡片归属技能列

CREATE TABLE IF NOT EXISTS job_coach_skills (
  skill_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 100,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO job_coach_skills (skill_key, label, description, sort_order) VALUES
  ('selling', '推销', '充值/菜品/会员/活动等一切销售活动的推荐与促成', 10),
  ('dish_intro', '菜品介绍', '招牌菜/常见菜的介绍、卖点表达', 20),
  ('dine_complaint', '堂食客诉', '堂食客诉处理（含真实客诉卡）', 30),
  ('table_visit', '桌访', '到桌顾客回访与反馈收集', 40),
  ('delivery_complaint', '外卖客诉', '外卖客诉处理（含真实客诉卡）', 50),
  ('delivery_anomaly', '外卖异常', '超时/洒漏/少餐/骑手冲突等异常处理', 60),
  ('greeting', '迎宾', '迎宾/等位/领位/落座服务', 70),
  ('dish_knowledge', '菜品知识', '菜品食材/产地/做法/口味/特点知识', 80),
  ('allergy_knowledge', '忌口知识', '过敏原/宗教忌口/辣糖盐限制/点单问询', 90),
  ('food_safety_knowledge', '食安知识', '食品安全规范/保质期/温度/交叉污染', 100),
  ('food_safety_incident', '食安事件', '异物/过敏/变质等食安事故处理', 110),
  ('kitchen_collab', '与厨房配合', '点单/传菜/催单/沽清/错菜/退换菜联动', 120),
  ('output_quality', '出品质量', '温度/分量/摆盘/颜色/味道的合格判定与返工', 130),
  ('cooking_knowledge', '烹饪知识', '技法/火候/出品原理（嫩脆香/去腥）', 140)
ON CONFLICT (skill_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS job_coach_skill_progress (
  id BIGSERIAL PRIMARY KEY,
  username CITEXT NOT NULL,
  skill_key TEXT NOT NULL REFERENCES job_coach_skills(skill_key) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'normal',
  trained_count INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  tenant_id VARCHAR(80) NOT NULL DEFAULT 'default',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (username, skill_key, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_jcsp_user
  ON job_coach_skill_progress (username, tenant_id);

ALTER TABLE job_coach_incident_cards
  ADD COLUMN IF NOT EXISTS skill_key TEXT;

CREATE INDEX IF NOT EXISTS idx_jcic_skill
  ON job_coach_incident_cards (skill_key);
