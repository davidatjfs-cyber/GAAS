import { resolveTenantIdDefault } from '../../utils/database.js';
import { cleanText } from '../growth-phase-auth.js';
import { safeDateOnly, todayShanghaiYmd, ymdAddDays } from './dates.js';

function httpError(code, status = 400, message = '') {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

export async function listLearnings(pool, opts = {}) {
  const storeCode = cleanText(opts.storeCode || '', 128);
  const channel = cleanText(opts.channel || '', 80);
  let limit = Math.floor(Number(opts.limit));
  if (!Number.isFinite(limit)) limit = 200;
  limit = Math.min(Math.max(limit, 1), 200);
  const r = await pool.query(
    `SELECT * FROM growth_learnings
     WHERE ($1 = '' OR store_code = $1)
       AND ($2 = '' OR channel = $2)
     ORDER BY created_at DESC
     LIMIT $3`,
    [storeCode, channel, limit]
  );
  return r.rows;
}

export async function createLearning(pool, tenantId, body) {
  const b = body || {};
  const channel = cleanText(b.channel, 80);
  const variable = cleanText(b.variable, 120);
  const winningValue = cleanText(b.winning_value, 500);
  if (!channel || !variable || !winningValue) {
    throw httpError('missing_fields', 400, 'missing channel, variable, or winning_value');
  }
  const r = await pool.query(
    `INSERT INTO growth_learnings (
       source_type, source_id, store_code, channel, scene, audience_tag, variable,
       winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, tenant_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      cleanText(b.source_type || 'manual', 80),
      cleanText(b.source_id || `manual_${Date.now()}`, 200),
      cleanText(b.store_code, 128),
      channel,
      b.scene ? cleanText(b.scene, 80) : null,
      b.audience_tag ? cleanText(b.audience_tag, 120) : null,
      variable,
      winningValue,
      b.losing_value ? cleanText(b.losing_value, 500) : null,
      b.effect_desc ? cleanText(b.effect_desc, 255) : null,
      Math.max(0, Math.floor(Number(b.sample_size) || 0)),
      cleanText(b.confidence || 'medium', 20),
      b.valid_until ? safeDateOnly(b.valid_until) : ymdAddDays(todayShanghaiYmd(), 90),
      tenantId
    ]
  );
  return r.rows[0] || null;
}

const LEARNING_SEEDS = [
  ['manual','seed_sms_01','51866138','sms','晚市','7日未到店','文案风格','个性化称呼（含姓名）','无称呼通用文案','核销率+22%',120,'high'],
  ['manual','seed_sms_02','51866138','sms','晚市','7日未到店','折扣类型','减8元券','8折券','核销率+11%',98,'medium'],
  ['manual','seed_sms_03','51866138','sms','晚市','7日未到店','发送时段','17:00-18:00','11:00-12:00','核销率+18%',84,'medium'],
  ['manual','seed_sms_04','64822111','sms','晚市','7日未到店','文案风格','个性化称呼（含姓名）','无称呼通用文案','核销率+19%',67,'medium'],
  ['manual','seed_sms_05','51866138','sms','午市','新客','折扣类型','单人套餐+赠品','直接打折','核销率+14%',55,'medium'],
  ['manual','seed_sms_06','51866138','sms','节假日','全部客户','文案类型','节日祝福+优惠券','纯优惠券','核销率+9%',200,'high'],
  ['manual','seed_sms_07','64822111','sms','节假日','7日未到店','有效期','3天有效期','7天有效期','核销率+16%',76,'medium'],
  ['manual','seed_xhs_01','51866138','xiaohongshu',null,null,'内容策略','烟火气风格+真实场景图','精修美食图','点击率+31%',1800,'high'],
  ['manual','seed_xhs_02','51866138','xiaohongshu','午市',null,'文案风格','打工人共鸣标题','直白菜品介绍','曝光量+45%',2200,'high'],
  ['manual','seed_xhs_03','64822111','xiaohongshu',null,null,'封面图风格','顾客就餐实拍','摆盘特写','收藏率+22%',1200,'medium'],
  ['manual','seed_xhs_04','51866138','xiaohongshu','晚市',null,'发布时段','18:00-20:00','12:00-14:00','互动率+27%',950,'high'],
  ['manual','seed_wxwork_01','51866138','wechat_work','晚市','7日未到店','消息频率','每月1次','每周1次','取消关注率-38%',180,'high'],
  ['manual','seed_wxwork_02','51866138','wechat_work',null,'高价值客户','内容类型','专属会员权益','通用促销信息','核销率+33%',90,'high'],
  ['manual','seed_wxwork_03','64822111','wechat_work','午市','新客','首次触达时机','到店后3天内','到店后7天内','复购率+25%',63,'medium'],
  ['manual','seed_dianping_01','51866138','dianping',null,null,'评价回复','个性化回复+感谢','模板统一回复','好评率+8%',320,'high'],
  ['manual','seed_dianping_02','51866138','dianping',null,null,'封面图','顾客实拍授权图','商家官拍图','点击率+19%',4500,'high'],
  ['manual','seed_dianping_03','64822111','dianping',null,null,'团购设置','单人套餐（性价比优先）','多人套餐','核销率+41%',220,'high'],
  ['manual','seed_coupon_01','51866138','sms',null,'老客户','券面值','减10元（门槛40）','减8元（无门槛）','核销率+17%',145,'high'],
  ['manual','seed_coupon_02','51866138','sms',null,'新客','有效期','7天','30天','核销率+29%',88,'medium'],
  ['manual','seed_coupon_03','64822111','miniprogram',null,'7日未到店','券样式','菜品绑定券（烧鹅专用）','通用代金券','核销率+23%',72,'medium'],
  ['manual','seed_content_01','51866138','sms','晚市','全部客户','主推菜品','本周热卖（数据支撑）','固定招牌菜','到店率+12%',310,'high'],
  ['manual','seed_content_02','51866138','xiaohongshu',null,null,'话题选择','本地探店+区域话题','品牌自建话题','曝光+67%',3100,'high'],
  ['manual','seed_content_03','64822111','xiaohongshu','午市',null,'图片数量','9张（含菜品+环境+顾客）','3张精选图','互动率+18%',780,'medium'],
  ['manual','seed_activity_01','51866138','sms',null,'高频客户（月均3次+）','活动类型','升级权益（生日月双倍积分）','一次性折扣','留存率+28%',95,'high'],
  ['manual','seed_activity_02','51866138','wechat_work',null,'沉睡客户（90天未到店）','召回方式','定向发放高价值券（满50减20）','通用消息推送','召回率+19%',48,'medium'],
  ['manual','seed_activity_03','64822111','sms',null,'节前7天','触达节点','节前3天发券','节当天发券','核销率+34%',156,'high'],
  ['manual','seed_store_01','51866138','sms','晚市','7日未到店','短信内容场景化','提及具体菜品（烧鹅/荔枝木）','不提菜品','核销率+15%',134,'high'],
  ['manual','seed_store_02','64822111','xiaohongshu',null,null,'达人合作','本地素人探店（1k-5k粉丝）','KOL付费推广','ROI+2.3倍',8,'medium'],
  ['manual','seed_time_01','51866138','sms','午市','上班族','发送时间','工作日11:00','工作日08:00','开率+22%',267,'high'],
  ['manual','seed_time_02','51866138','sms','晚市','家庭客','发送时间','周五17:00','周一17:00','核销率+19%',189,'high'],
  ['manual','seed_time_03','64822111','xiaohongshu',null,null,'发帖时间','周四晚20:00（周末预热）','周一早09:00','互动量+38%',1650,'high'],
];

export async function seedLearnings(pool, tenantId) {
  const today = todayShanghaiYmd();
  const validUntil = ymdAddDays(today, 180);
  let inserted = 0;
  for (const [srcType, srcId, storeCode, channel, scene, audienceTag, variable,
    winVal, loseVal, effectDesc, sampleSize, confidence] of LEARNING_SEEDS) {
    await pool.query(
      `INSERT INTO growth_learnings (
         source_type, source_id, store_code, channel, scene, audience_tag, variable,
         winning_value, losing_value, effect_desc, sample_size, confidence, valid_until, tenant_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT DO NOTHING`,
      [srcType, srcId, storeCode, channel, scene, audienceTag, variable,
        winVal, loseVal, effectDesc, sampleSize, confidence, validUntil, tenantId || resolveTenantIdDefault()]
    ).catch(() => {});
    inserted += 1;
  }
  const count = await pool.query(`SELECT COUNT(*)::int AS cnt FROM growth_learnings`);
  return { seeded: inserted, total: count.rows[0]?.cnt || 0 };
}
