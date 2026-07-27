/**
 * BITABLE / LARK configuration (P17 peel from agents.js).
 */

const _isProd = String(process.env.NODE_ENV || '').trim() === 'production';
const LARK_APP_ID = process.env.LARK_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : '');
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || '';
const _LARK_ENCRYPT_KEY = process.env.LARK_ENCRYPT_KEY || '';
const _LARK_VERIFICATION_TOKEN = process.env.LARK_VERIFICATION_TOKEN || '';

// Bitable Configuration - 支持多个配置
const BITABLE_CONFIGS = {
  'ops_checklist': {
    appId: process.env.BITABLE_OPS_APP_ID || (!_isProd ? 'cli_a91dae9f9578dcb1' : ''),
    appSecret: process.env.BITABLE_OPS_APP_SECRET || '',
    appToken: process.env.BITABLE_OPS_APP_TOKEN || 'PtVObRtoPaMAP3stIIFc8DnJngd',
    tableId: process.env.BITABLE_OPS_TABLE_ID || 'tblxHI9ZAKONOTpp',
    name: '运营检查表(含开收档)',
    type: 'checklist',
    pollingInterval: 60000,
    sortField: '["_id DESC"]'
  },
  'table_visit': {
    // App ID：生产必须走 env（已配 BITABLE_*_APP_ID）；非生产保留本地开发兜底
    appId: process.env.BITABLE_TABLEVISIT_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_TABLEVISIT_APP_SECRET || '',
    appToken: process.env.BITABLE_TABLEVISIT_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_TABLEVISIT_TABLE_ID || 'tblpx5Efqc6eHo3L',
    name: '桌访表',
    type: 'table_visit',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'bad_reviews': {
    appId: process.env.BITABLE_TABLEVISIT_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_TABLEVISIT_APP_SECRET || '',
    appToken: process.env.BITABLE_TABLEVISIT_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: 'tblgReexNjWJOJB6',
    name: '差评报告DB',
    type: 'bad_review',
    pollingInterval: 300000,
    sortField: '["创建日期 DESC"]'
  },
  'closing_reports': {
    appId: process.env.BITABLE_CLOSING_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_CLOSING_APP_SECRET || '',
    appToken: process.env.BITABLE_CLOSING_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_CLOSING_TABLE_ID || 'tblXYfSBRrgNGohN',
    name: '收档报告DB',
    type: 'closing_report',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'opening_reports': {
    appId: process.env.BITABLE_OPENING_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_OPENING_APP_SECRET || '',
    appToken: process.env.BITABLE_OPENING_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_OPENING_TABLE_ID || 'tbl32E6d0CyvLvfi',
    name: '开档报告',
    type: 'opening_report',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'meeting_reports': {
    appId: process.env.BITABLE_MEETING_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_MEETING_APP_SECRET || '',
    appToken: process.env.BITABLE_MEETING_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_MEETING_TABLE_ID || 'tblZXgaU0LpSye2m',
    name: '例会报告',
    type: 'meeting_report',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'material_majixian': {
    appId: process.env.BITABLE_MATERIAL_MJX_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_MATERIAL_MJX_APP_SECRET || '',
    appToken: process.env.BITABLE_MATERIAL_MJX_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_MATERIAL_MJX_TABLE_ID || 'tblz4kW1cY22XRlL',
    name: '马己仙原料收货日报',
    type: 'material_report',
    brand: 'majixian',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'material_hongchao': {
    appId: process.env.BITABLE_MATERIAL_HC_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_MATERIAL_HC_APP_SECRET || '',
    appToken: process.env.BITABLE_MATERIAL_HC_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_MATERIAL_HC_TABLE_ID || 'tbllcV1evqTJyzlN',
    name: '洪潮原料收货日报',
    type: 'material_report',
    brand: 'hongchao',
    pollingInterval: 300000,
    sortField: '["日期 DESC"]'
  },
  'loss_reports': {
    appId: process.env.BITABLE_LOSS_APP_ID || (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret: process.env.BITABLE_LOSS_APP_SECRET || '',
    appToken: process.env.BITABLE_LOSS_APP_TOKEN || 'PTWrbUdcbarCshst0QncMoY7nKe',
    tableId: process.env.BITABLE_LOSS_TABLE_ID || 'tblLCxLO0ZbV7uyo',
    name: '报损单',
    type: 'loss_report',
    pollingInterval: 300000,
    sortField: '["创建日期 DESC"]'
  },
  'task_responses': {
    appId:
      process.env.BITABLE_TASK_RESP_APP_ID ||
      process.env.BITABLE_TABLEVISIT_APP_ID ||
      (!_isProd ? 'cli_a9fc0d13c838dcd6' : ''),
    appSecret:
      process.env.BITABLE_TASK_RESP_APP_SECRET ||
      process.env.BITABLE_TABLEVISIT_APP_SECRET ||
      '',
    appToken: process.env.BITABLE_TASK_RESP_APP_TOKEN || 'BTAjbflrlaMRHesADUfc8usznqh',
    tableId: process.env.BITABLE_TASK_RESP_TABLE_ID || 'tblT86H1uuTJydne',
    name: '异常任务回复',
    type: 'task_response',
    pollingInterval: 60000,
    sortField: '["_id DESC"]'
  }
};

// 向后兼容的默认配置
const _BITABLE_APP_ID = process.env.BITABLE_APP_ID || BITABLE_CONFIGS.ops_checklist.appId;
const _BITABLE_APP_SECRET = process.env.BITABLE_APP_SECRET || BITABLE_CONFIGS.ops_checklist.appSecret;
const _BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN || BITABLE_CONFIGS.ops_checklist.appToken;
const _BITABLE_TABLE_ID = process.env.BITABLE_TABLE_ID || BITABLE_CONFIGS.ops_checklist.tableId;

export {
  _isProd,
  LARK_APP_ID,
  LARK_APP_SECRET,
  _LARK_ENCRYPT_KEY,
  _LARK_VERIFICATION_TOKEN,
  BITABLE_CONFIGS,
  _BITABLE_APP_ID,
  _BITABLE_APP_SECRET,
  _BITABLE_APP_TOKEN,
  _BITABLE_TABLE_ID,
};
