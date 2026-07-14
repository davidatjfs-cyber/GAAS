-- 115: 客户AI知识库改为数据库可编辑（后台"知识库编辑"页），DB为空时代码内置默认值兜底

CREATE TABLE IF NOT EXISTS sales_knowledge_items (
  id BIGSERIAL PRIMARY KEY,
  item_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pain_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sales_knowledge_items (item_key, title, body, pain_keys, sort_order) VALUES
  ('what-is', '产品是什么', '我们提供的是餐厅AI增长服务，不是单一软件。系统连接POS、客户、员工与经营数据，帮助完成客户自动维护、门店自主运营和人才复制三个闭环。', '[]'::jsonb, 10),
  ('repurchase', '复购/老客', '系统按消费时间、次数、金额和偏好分层（新客、活跃、VIP、储值、流失风险），自动生成维护动作，并追踪回店与营业额归因。', '["复购","老客","流失","营销"]'::jsonb, 20),
  ('revenue-decline', '营业额下降', 'AI会按时段、菜品、渠道自动归因营业额变化的原因(不是单纯看总数下滑)，找到具体是出餐慢、客流下降还是客单下降，再给出对应的整改动作并跟踪结果。', '["营业额下降"]'::jsonb, 30),
  ('execution', '店长执行', '每天发现经营异常，生成可执行建议并追踪店长/员工是否完成；老板看到的是问题、责任人、是否解决、结果是否改善。', '["门店执行","执行","店长"]'::jsonb, 40),
  ('training', '人才培养', '培训、考试、认证与绩效可串成闭环，减少人员流动带来的能力不稳定。', '["人才培养","培训","人才","员工"]'::jsonb, 50),
  ('multi-store', '多店管理', '系统按门店维度汇总经营异常并自动排名，老板每天只看需要关注的门店和问题，而不是逐店翻数据；督导可以直接看到哪些店执行慢、哪些店在改善。', '["多店管理","缺少经营数据"]'::jsonb, 60),
  ('marketing-roi', '营销归因/ROI', '每次营销触达(短信/企微/券)都会跟踪客户是否回店、产生了多少营业额，把投放和实际回店营收对应起来，而不是只看发了多少条、领了多少券。', '["营销归因"]'::jsonb, 70),
  ('trial', '30天试跑', '适合有POS与客户手机号基础的门店。先验证数据条件与回店归因，再决定正式合作；不以功能堆砌代替结果验证。', '[]'::jsonb, 80),
  ('boundary', '合作边界', '标准产品、轻交付。单店重度定制不做；非标准POS需先评估；价格按门店规模方案，折扣需人工审批。', '[]'::jsonb, 90),
  ('price-range', '价格原则', '按门店规模提供基础/连锁/集团方案区间。具体报价需顾问结合门店数、数据条件与试跑范围确认，机器人不报最终成交价。', '[]'::jsonb, 100)
ON CONFLICT (item_key) DO NOTHING;
