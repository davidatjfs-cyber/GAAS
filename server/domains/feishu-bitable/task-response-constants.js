/** Task-response Bitable table schema (P2 peel from agents.js). */

export const TASK_RESPONSE_CONFIG_KEY = 'task_responses';
export const TASK_RESPONSE_TABLE_NAME = '异常任务回复';
export const TASK_RESPONSE_FIELDS = [
  { field_name: '任务编号', type: 1 },
  { field_name: '异常类型', type: 1 },
  { field_name: '门店', type: 1 },
  { field_name: '品牌', type: 1 },
  { field_name: '严重程度', type: 1 },
  { field_name: '异常描述', type: 1 },
  { field_name: '回复说明', type: 1 },
  { field_name: '整改照片', type: 17 },
  {
    field_name: '处理状态',
    type: 3,
    property: { options: [{ name: '待回复' }, { name: '已回复' }, { name: '已处理' }] },
  },
];

export const DEFAULT_TASK_RESP_FORM_URL =
  'https://qcniocx2wuu8.feishu.cn/base/BTAjbflrlaMRHesADUfc8usznqh?table=tblT86H1uuTJydne&view=vewOvsJql9';
export const DEFAULT_TASK_RESP_HOST = 'qcniocx2wuu8.feishu.cn';
export const DEFAULT_TASK_RESP_VIEW_ID = 'vewOvsJql9';

export function createInitialTaskResponseState() {
  return {
    tableId: '',
    formViewId: '',
    formUrl: '',
    initialized: false,
    failCount: 0,
    disabled: false,
  };
}
