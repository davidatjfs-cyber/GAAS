#!/usr/bin/env node
// 一次性把当前生产在用的短信模板（阿里云已报备的真实code+正文，2026-07-13批次）灌进
// sms_templates 表，完成从"只在.env里配code、正文只存在阿里云后台"到"DB是唯一权威源"
// 的切换。正文来自用户在阿里云短信模板管理后台核对过的截图/工单号，不是猜测。
// 用法：DATABASE_URL=... node server/scripts/seed-sms-templates-from-env.js
import 'dotenv/config';
import pg from 'pg';
import { upsertSmsTemplate } from '../sms-templates.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const rows = [
  // 签名
  { brand_suffix: 'MAJIXIAN', slot: 'SIGN', sign_name: '马己仙' },
  { brand_suffix: 'HONGCHAO', slot: 'SIGN', sign_name: '上海连年由喜餐饮管理' },
  { brand_suffix: 'DEFAULT', slot: 'SIGN', sign_name: process.env.ALIYUN_SMS_SIGN_NAME || '上海连年由喜餐饮管理有限' },

  // ABC 六模板轮换（VIP维护/活跃客经营/常客降温/沉睡召回60-90/90-180/VIP专属召回/新客二次召回/
  // 长期流失181-365/超1年/到店未买单潜客召回，共10个活动共用这6个模板轮换发）
  { brand_suffix: 'HONGCHAO', slot: 'ABCGIFTA', template_code: 'SMS_509625170', sign_name: '上海连年由喜餐饮管理', vars: ['date', 'code'],
    content: '洪潮大宁久光店最近出新菜单了，为您预留一份养生炖汤免费品鉴，请于${date}前到店报券码${code}拒收请回复R' },
  { brand_suffix: 'HONGCHAO', slot: 'ABCGIFTB', template_code: 'SMS_509520175', sign_name: '上海连年由喜餐饮管理', vars: ['date', 'code'],
    content: '洪潮大宁久光店最近更新菜单了，为您预留一份手打虾饼免费品鉴，请于${date}前到店报券码${code}拒收请回复R' },
  { brand_suffix: 'HONGCHAO', slot: 'ABCGIFTC', template_code: 'SMS_509395210', sign_name: '上海连年由喜餐饮管理', vars: ['date', 'code'],
    content: '洪潮大宁久光店最近更新菜单，为您预留一份香煎蚝仔烙免费品鉴，请于${date}前到店报券码${code}拒收请回复R' },
  { brand_suffix: 'HONGCHAO', slot: 'ABCCOUPON30', template_code: 'SMS_509495179', sign_name: '上海连年由喜餐饮管理', vars: ['date', 'code'],
    content: '洪潮大宁久光店刚刚更新菜单为您准备一张30元无门槛券，${date}前来门店报券码${code}可抵扣拒收请回复R' },
  { brand_suffix: 'HONGCHAO', slot: 'ABCCOUPON50', template_code: 'SMS_509585160', sign_name: '上海连年由喜餐饮管理', vars: ['date', 'code'],
    content: '洪潮大宁久光店刚刚更新菜单为您准备一张50元无门槛券，${date}前来门店报券码${code}核销拒收请回复R' },
  { brand_suffix: 'HONGCHAO', slot: 'ABCCOUPON2X50', template_code: 'SMS_509610166', sign_name: '上海连年由喜餐饮管理', vars: ['date', 'code'],
    content: '洪潮久光店刚刚更新菜单为您准备2张50元无门槛券，${date}前来门店报券码${code}每次限用1张拒收请回复R' },

  { brand_suffix: 'MAJIXIAN', slot: 'ABCGIFTA', template_code: 'SMS_509050176', sign_name: '马己仙', vars: ['date', 'code'],
    content: '音乐广场店想你啦，招牌荔枝木烧鹅，为您预留一份养生炖汤免费品鉴，请于${date}前到店报券码${code}使用,拒收请回复R' },
  { brand_suffix: 'MAJIXIAN', slot: 'ABCGIFTB', template_code: 'SMS_508905180', sign_name: '马己仙', vars: ['date', 'code'],
    content: '音乐广场店想你啦，荔枝木烧鹅，为您预留一份招牌手打虾饼免费品鉴，请于${date}前到店报券码${code}使用拒收请回复R' },
  { brand_suffix: 'MAJIXIAN', slot: 'ABCGIFTC', template_code: 'SMS_509265150', sign_name: '马己仙', vars: ['date', 'code'],
    content: '马己仙大宁音乐广场店想你啦，为您预留一份百合酱蒸凤爪免费品鉴，请于${date}前到店报券码${code}使用,拒收请回复R' },
  { brand_suffix: 'MAJIXIAN', slot: 'ABCCOUPON30', template_code: 'SMS_508950213', sign_name: '马己仙', vars: ['date', 'code'],
    content: '大宁音乐广场店想你啦，招牌荔枝木烧鹅，送您30元无门槛现金抵用券,${date}前到店报券码${code}核销,拒收请回复R' },
  { brand_suffix: 'MAJIXIAN', slot: 'ABCCOUPON50', template_code: 'SMS_508875177', sign_name: '马己仙', vars: ['date', 'code'],
    content: '音乐广场店想你啦，招牌荔枝木烧鹅，为您准备一张50元无门槛回归礼券，${date}前来门店报券码${code}可抵扣拒收请回复R' },
  { brand_suffix: 'MAJIXIAN', slot: 'ABCCOUPON2X50', template_code: 'SMS_509115173', sign_name: '马己仙', vars: ['date', 'code'],
    content: '马己仙音乐广场店想你啦，为您准备2张50元无门槛回归礼券，${date}前来门店报券码${code}单次限用1张，拒收请回复R' },

  // 就餐时段标签
  { brand_suffix: 'MAJIXIAN', slot: 'MJDINNERWK', template_code: 'SMS_509085194', sign_name: '马己仙', vars: ['value', 'date', 'code'],
    content: '音乐广场店为您准备一张${value}元无门槛晚市券17点后可用，${date}前来门店报券码${code}可抵扣拒收请回复R', sample_values: { value: '50' } },
  { brand_suffix: 'MAJIXIAN', slot: 'MJDWGIFT', template_code: 'SMS_509265150', sign_name: '马己仙', vars: ['date', 'code'],
    content: '马己仙大宁音乐广场店想你啦，为您预留一份百合酱蒸凤爪免费品鉴，请于${date}前到店报券码${code}使用,拒收请回复R' },
  { brand_suffix: 'HONGCHAO', slot: 'HCWDLUNCH', template_code: 'SMS_509495178', sign_name: '上海连年由喜餐饮管理', vars: ['date', 'code'],
    content: '洪潮大宁久光店最近更新菜单了${date}前到店赠送养生炖汤一份，凭券码${code}，仅限平日午市使用拒收请回复R' },

  // 新客回头4天/8天（与ABCGIFTB/C共用同一模板，正文相同）
  { brand_suffix: 'HONGCHAO', slot: 'NEW4', template_code: 'SMS_509520175', sign_name: '上海连年由喜餐饮管理', vars: ['date', 'code'],
    content: '洪潮大宁久光店最近更新菜单了，为您预留一份手打虾饼免费品鉴，请于${date}前到店报券码${code}拒收请回复R' },
  { brand_suffix: 'MAJIXIAN', slot: 'NEW4', template_code: 'SMS_508905180', sign_name: '马己仙', vars: ['date', 'code'],
    content: '音乐广场店想你啦，荔枝木烧鹅，为您预留一份招牌手打虾饼免费品鉴，请于${date}前到店报券码${code}使用拒收请回复R' },
  { brand_suffix: 'HONGCHAO', slot: 'NEW8', template_code: 'SMS_509395210', sign_name: '上海连年由喜餐饮管理', vars: ['date', 'code'],
    content: '洪潮大宁久光店最近更新菜单，为您预留一份香煎蚝仔烙免费品鉴，请于${date}前到店报券码${code}拒收请回复R' },
  { brand_suffix: 'MAJIXIAN', slot: 'NEW8', template_code: 'SMS_509265150', sign_name: '马己仙', vars: ['date', 'code'],
    content: '马己仙大宁音乐广场店想你啦，为您预留一份百合酱蒸凤爪免费品鉴，请于${date}前到店报券码${code}使用,拒收请回复R' },

  // 储值余额提醒（stored_value_remind规则，目前enabled=true、每天在跑，唯一还在用env兜底的功能）
  { brand_suffix: 'DEFAULT', slot: 'BALANCE_TEMPLATE', template_code: 'SMS_507260262' },
  { brand_suffix: 'HONGCHAO', slot: 'BALANCE_TEMPLATE', template_code: 'SMS_507290291' },
  { brand_suffix: 'MAJIXIAN', slot: 'BALANCE_TEMPLATE', template_code: 'SMS_507260262' },

  // 2026-07-21 已确认删除：TEMPLATE(老的通用引擎直发)、WINBACK_TEMPLATE(沉睡客召回现金券)
  // 两个slot——核查 growth_touch_rules 发现当前enabled=true的15条sms规则全部带campaign_key，
  // 会走ABC/CAMPAIGN_TYPES系统，不会落到这两个老路径；growth_campaign_jobs里kind='winback'
  // 最后一条记录停在2026-06-05，已闲置超6周，确认是废弃功能。不要再把这两个slot加回来。
];

async function main() {
  let ok = 0, failed = 0;
  for (const row of rows) {
    try {
      await upsertSmsTemplate(pool, { ...row, tenant_id: 'default', updated_by: 'seed-script' });
      ok++;
      console.log(`[ok] ${row.brand_suffix}/${row.slot} -> ${row.template_code || '(仅签名)'}`);
    } catch (e) {
      failed++;
      console.error(`[FAIL] ${row.brand_suffix}/${row.slot}: ${e.message}${e.char_len ? ` (字数${e.char_len}/限${e.limit})` : ''}`);
    }
  }
  console.log(`done: ${ok} ok, ${failed} failed`);
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
