-- 148: growth_campaign_jobs 加 retry_count，防止单个任务卡死无限阻塞整条队列。
-- 背景：2026-07-19创建的两条newcomer_8d任务(id 741/742)在小程序端处理时挂死(未知原因，
-- 可能是postCampaignSms网络调用超时)，从未回写postJobResult，一直停在status='running'。
-- /api/growth/winback/pending-jobs 认领逻辑按created_at asc取最老的一条，"running超3分钟"
-- 会被重新认领——但重新认领后同样的挂死bug再次触发，如此循环了2天，把后面183条正常任务
-- 全部堵死，谁都发不出去。retry_count达到阈值后自动判failed、不再重新认领，让队列能往下走。
ALTER TABLE growth_campaign_jobs ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
