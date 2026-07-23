import PDFDocument from 'pdfkit';
import {
  billingAccountGate,
  billingFontBoldPath,
  billingFontRegularPath,
  getPlatformBillingAccount,
  getTenantPlatformProfile,
  savePlatformBillingAccount,
} from './helpers.js';

const BILLING_CYCLE_LABELS = { monthly: '按月', quarterly: '按季', yearly: '按年' };

// 账期起点=下次开票日期往前推一个周期。这个日期是平台配置页里人工维护的"下次开票"，
// 不是凭空计算的——账期准确性依赖这个字段被及时维护，PDF只负责把它换算成一个区间展示。
function computeBillingPeriod(nextInvoiceAt, cycle) {
  const end = nextInvoiceAt ? new Date(nextInvoiceAt) : null;
  if (!end || Number.isNaN(end.getTime())) return null;
  const start = new Date(end);
  if (cycle === 'quarterly') start.setMonth(start.getMonth() - 3);
  else if (cycle === 'yearly') start.setFullYear(start.getFullYear() - 1);
  else start.setMonth(start.getMonth() - 1); // monthly 或未设置时的默认假设
  return { start, end };
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 */
export function registerTenantPlatformBillingRoutes(app, deps) {
  const { pool, platformAdminRequired } = deps;

  const BILLING_FONT_REGULAR = billingFontRegularPath();
  const BILLING_FONT_BOLD = billingFontBoldPath();

  app.get('/api/admin/platform/billing-account', platformAdminRequired, billingAccountGate, async (_req, res) => {
    try {
      res.json({ ok: true, account: await getPlatformBillingAccount(pool) });
    } catch (e) { res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' }); }
  });

  app.put('/api/admin/platform/billing-account', platformAdminRequired, billingAccountGate, async (req, res) => {
    try {
      const saved = await savePlatformBillingAccount(pool, req.body?.account || req.body || {});
      res.json({ ok: true, account: saved });
    } catch (e) { res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' }); }
  });

  // 账单PDF下载——现在只做"生成可下载文件"这一步，不做自动发送；销售/客服下载后
  // 自行通过邮箱/微信手动发给客户。内容来自platform_profile.billing这个已有的配置对象，
  // 不需要新表；只是把已经录入的账单计划/周期/联系人信息渲染成一份能给客户看的PDF。
  //
  // 中文字体：pdfkit内置字体(Helvetica等)不含中文字形，直接doc.text()写中文会变成乱码方框——
  // 这是上线后被发现的真实bug，不是假设性风险。必须显式注册一个含中文字形的TrueType字体
  // (server/assets/fonts/NotoSansSC-*.ttf，OFL开源协议，可随仓库分发)。用doc.font()指定字体名
  // 而不是每次都传完整路径，方便下面在常规/粗体之间切换。
  app.get('/api/admin/tenants/:tenantId/billing/pdf', platformAdminRequired, async (req, res) => {
    const tenantId = String(req.params.tenantId || '').trim();
    try {
      const tenantRow = await pool.query('SELECT name FROM tenants WHERE tenant_id = $1 LIMIT 1', [tenantId]);
      if (!tenantRow.rows.length) return res.status(404).json({ error: 'tenant_not_found' });
      const profile = await getTenantPlatformProfile(pool, tenantId, tenantRow.rows[0].name);
      const billing = profile.billing || {};
      const tenantName = tenantRow.rows[0].name || tenantId;
      const brandColor = /^#[0-9a-fA-F]{6}$/.test(profile.brand_color || '') ? profile.brand_color : '#0d7a5f';
      const fmtDate = (v) => {
        if (!v) return '未配置';
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
      };

      // 签约价格/账期是sales_leads上的机密字段，权威来源只有这一个，不能让账单金额跟
      // platform_profile.billing里那个自由文本的账单计划/周期各说各话、对不上账。
      const leadRow = await pool.query(
        `SELECT id, contract_price_fen, contract_billing_cycle, contract_billing_day
           FROM sales_leads WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
        [tenantId]
      );
      const lead = leadRow.rows?.[0] || null;
      const hasContractPrice = lead && Number(lead.contract_price_fen) > 0;
      const period = hasContractPrice ? computeBillingPeriod(billing.next_invoice_at, lead.contract_billing_cycle) : null;
      const billingAccount = await getPlatformBillingAccount(pool);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="billing-${tenantId}-${new Date().toISOString().slice(0, 10)}.pdf"`);
      const doc = new PDFDocument({ size: 'A4', margin: 56 });
      doc.registerFont('cn', BILLING_FONT_REGULAR);
      doc.registerFont('cn-bold', BILLING_FONT_BOLD);
      doc.pipe(res);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      // 顶部品牌条 + 标题
      doc.rect(doc.page.margins.left, doc.page.margins.top, pageWidth, 4).fill(brandColor);
      doc.moveDown(1.2);
      doc.font('cn-bold').fontSize(20).fillColor('#1a1a1a').text(tenantName);
      doc.font('cn').fontSize(11).fillColor('#666').text('账单 / Billing Statement');
      doc.moveDown(1);

      // 分隔线
      const hr = () => {
        const y = doc.y;
        doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor('#e0dcd3').lineWidth(1).stroke();
        doc.moveDown(0.8);
      };
      hr();

      // 本期账单金额——放在最显眼的位置，金额只来自sales_leads的机密字段，
      // 没配置就明确写"未设置"，绝不编造一个数字。
      const amountBoxY = doc.y;
      doc.rect(doc.page.margins.left, amountBoxY, pageWidth, 64).fill('#f7f4ee');
      doc.font('cn').fontSize(9).fillColor('#999').text('本期账单金额', doc.page.margins.left + 16, amountBoxY + 10);
      if (hasContractPrice) {
        doc.font('cn-bold').fontSize(22).fillColor(brandColor).text(
          `¥ ${(Number(lead.contract_price_fen) / 100).toFixed(2)}`,
          doc.page.margins.left + 16, amountBoxY + 24
        );
        if (period) {
          doc.font('cn').fontSize(9).fillColor('#666').text(
            `账期：${period.start.toISOString().slice(0, 10)} 至 ${period.end.toISOString().slice(0, 10)}（${BILLING_CYCLE_LABELS[lead.contract_billing_cycle] || ''}）`,
            doc.page.margins.left + 200, amountBoxY + 32
          );
        }
      } else {
        doc.font('cn-bold').fontSize(13).fillColor('#a15c00').text(
          '未设置签约价格，请联系总经理/财务在客户档案中补充后再发送本账单',
          doc.page.margins.left + 16, amountBoxY + 28, { width: pageWidth - 32 }
        );
      }
      doc.y = amountBoxY + 64 + 16;
      hr();

      // 两列信息区：左边租户/计划信息，右边联系与送达信息
      const colGap = 24;
      const colWidth = (pageWidth - colGap) / 2;
      const leftX = doc.page.margins.left;
      const rightX = leftX + colWidth + colGap;
      const topY = doc.y;

      const field = (x, y, label, value) => {
        doc.font('cn').fontSize(9).fillColor('#999').text(label, x, y);
        doc.font('cn').fontSize(12).fillColor('#1a1a1a').text(value || '未配置', x, y + 13, { width: colWidth });
      };

      field(leftX, topY, '租户编号', tenantId);
      field(leftX, topY + 46, '账单计划', billing.plan_name);
      field(leftX, topY + 92, '账单周期', billing.billing_cycle);
      field(leftX, topY + 138, '下次开票日期', fmtDate(billing.next_invoice_at));

      field(rightX, topY, '账单联系人', billing.billing_contact);
      field(rightX, topY + 46, '联系人邮箱', billing.billing_contact_email);
      field(rightX, topY + 92, '联系人微信', billing.billing_contact_wechat);
      field(rightX, topY + 138, '送达方式', billing.delivery_method === 'wechat' ? '微信' : '邮箱');

      doc.y = topY + 138 + 40;
      hr();

      // 收款账户——只要平台管理员填过其中一项就展示，避免全空时还打印一堆"未配置"的表格。
      const hasBillingAccount = billingAccount.account_name || billingAccount.bank_account_no || billingAccount.bank_name;
      if (hasBillingAccount) {
        doc.font('cn-bold').fontSize(10).fillColor('#1a1a1a').text('收款账户信息');
        doc.moveDown(0.4);
        const acctTopY = doc.y;
        field(leftX, acctTopY, '收款单位', billingAccount.account_name);
        field(leftX, acctTopY + 46, '开户行', billingAccount.bank_name + (billingAccount.bank_branch ? `（${billingAccount.bank_branch}）` : ''));
        field(rightX, acctTopY, '银行账号', billingAccount.bank_account_no);
        doc.y = acctTopY + 46 + 40;
        hr();
      }

      if (billing.notes) {
        doc.font('cn-bold').fontSize(10).fillColor('#1a1a1a').text('备注');
        doc.moveDown(0.3);
        doc.font('cn').fontSize(10).fillColor('#444').text(billing.notes, { width: pageWidth });
        doc.moveDown(1);
        hr();
      }

      doc.font('cn').fontSize(9).fillColor('#999');
      doc.text(`生成时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}`);
      doc.text('本账单由平台系统自动生成');

      doc.end();
    } catch (e) {
      if (!res.headersSent) return res.status(500).json({ error: 'server_error', message: e?.message || 'internal_error' });
      res.end();
    }
  });
}
