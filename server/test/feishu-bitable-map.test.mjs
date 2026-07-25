/**
 * domains/feishu-bitable/map.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripAttachmentLikeFields, mapFeishuFieldToHrms } from '../domains/feishu-bitable/map.js';

test('stripAttachmentLikeFields 去掉附件/图片键', () => {
  assert.deepEqual(
    stripAttachmentLikeFields({
      门店: '洪潮',
      附件: [1],
      photo_file: 'x',
      现场图片: 'y',
      评价: '好',
    }),
    { 门店: '洪潮', 评价: '好' }
  );
  assert.deepEqual(stripAttachmentLikeFields(null), {});
});

test('mapFeishuFieldToHrms table_visit：日期/人数/布尔/时间归一', () => {
  const mapped = mapFeishuFieldToHrms(
    {
      record_id: 'rec1',
      fields: {
        记录日期: '2026-07-01',
        所属门店: { text: '洪潮大宁久光店' },
        所属品牌: ['商', '业'],
        就餐人数: '3人',
        消费金额: '¥128.5',
        是否有预订: '是',
        预订时间: '18:30',
        高峰时段: true,
        服务评分: 4.5,
        顾客反馈: { name: '味道不错' },
      },
    },
    'table_visit'
  );
  assert.equal(mapped.date, '2026-07-01');
  assert.equal(mapped.store, '洪潮大宁久光店');
  assert.equal(mapped.brand, '商, 业');
  assert.equal(mapped.guestCount, 3);
  assert.equal(mapped.amount, 128.5);
  assert.equal(mapped.hasReservation, true);
  assert.equal(mapped.reservationTime, '18:30:00');
  assert.equal(mapped.peakHours, true);
  assert.equal(mapped.serviceRating, 4.5);
  assert.equal(mapped.feedback, '味道不错');
  assert.equal(mapped.recordId, 'rec1');
});

test('mapFeishuFieldToHrms：毫秒时间戳日期；非 table_visit 空映射', () => {
  const ms = Date.UTC(2026, 6, 2);
  const mapped = mapFeishuFieldToHrms(
    { fields: { 日期: ms } },
    'table_visit'
  );
  assert.equal(mapped.date, '2026-07-02');
  assert.deepEqual(mapFeishuFieldToHrms({ fields: { a: 1 } }, 'other'), {});
});
