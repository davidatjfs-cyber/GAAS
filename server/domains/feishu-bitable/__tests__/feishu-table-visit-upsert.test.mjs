import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertTableVisitRecordFromMapped } from '../table-visit-upsert.js';

function makePoolCapture() {
  const calls = [];
  return {
    calls,
    pool: {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rowCount: 1, rows: [] };
      },
    },
  };
}

test('upsertTableVisitRecordFromMapped: 缺 pool/hrmsData 抛错', async () => {
  await assert.rejects(
    () => upsertTableVisitRecordFromMapped(null, { date: '2024-01-01' }),
    (err) => err instanceof Error && err.message === 'missing_pool_or_hrms_data'
  );
  await assert.rejects(
    () => upsertTableVisitRecordFromMapped({ query: async () => {} }, null),
    (err) => err instanceof Error && err.message === 'missing_pool_or_hrms_data'
  );
});

test('upsertTableVisitRecordFromMapped: SQL 含 rush_dish_content 与全列 upsert', async () => {
  const { pool, calls } = makePoolCapture();
  await upsertTableVisitRecordFromMapped(pool, {
    date: '2024-06-01',
    store: '洪潮',
    brand: '洪潮',
    tableNumber: 'A1',
    guestCount: 2,
    amount: 100,
    hasReservation: true,
    dissatisfactionDish: null,
    feedback: 'ok',
    reservationTime: '18:30',
    customerType: null,
    orderType: null,
    serviceRating: 5,
    foodRating: 4,
    environmentRating: 5,
    waiterName: '张三',
    promotionInfo: null,
    weather: null,
    peakHours: null,
    customerComplaint: null,
    complaintResolution: null,
    satisfactionLevel: null,
    repeatCustomer: null,
    specialRequests: null,
    paymentMethod: null,
    orderDuration: null,
    tableTurnover: null,
    dishRecommendations: null,
    allergicInfo: null,
    celebrationType: null,
    visitPurpose: null,
    companionInfo: null,
    customerAge: null,
    customerGender: null,
    visitFrequency: null,
    preferredDishes: null,
    unsatisfiedItems: null,
    suggestedImprovements: null,
    staffPerformance: null,
    facilityIssues: null,
    hygieneRating: null,
    valueRating: null,
    ambianceRating: null,
    noiseLevel: null,
    temperature: null,
    lighting: null,
    musicVolume: null,
    seatingComfort: null,
    queueTime: null,
    serviceSpeed: null,
    orderAccuracy: null,
    staffAttitude: null,
    problemResolution: null,
    managerIntervention: null,
    compensationProvided: null,
    followUpRequired: null,
    followUpDetails: null,
    additionalNotes: 'note',
    rushDishContent: '红烧肉催菜',
    recordId: 'rec_abc',
  });

  assert.equal(calls.length, 1);
  const { sql, params } = calls[0];
  assert.match(sql, /insert into table_visit_records/i);
  assert.match(sql, /rush_dish_content/);
  assert.match(sql, /on conflict \(feishu_record_id\) do update/i);
  assert.match(sql, /rush_dish_content = excluded\.rush_dish_content/);
  assert.equal(params.length, 60);
  assert.equal(params[0], '2024-06-01');
  assert.equal(params[1], '洪潮');
  assert.equal(params[9], '18:30:00'); // HH:MM → HH:MM:00
  assert.equal(params[58], '红烧肉催菜'); // rush_dish_content
  assert.equal(params[59], 'rec_abc');
});

test('upsertTableVisitRecordFromMapped: 无 rushDishContent / 已带秒的预约时间', async () => {
  const { pool, calls } = makePoolCapture();
  await upsertTableVisitRecordFromMapped(pool, {
    date: '2024-06-02',
    store: '马己仙',
    reservationTime: '19:00:00',
    recordId: 'rec_xyz',
  });
  const { params } = calls[0];
  assert.equal(params[9], '19:00:00');
  assert.equal(params[58], null);
  assert.equal(params[59], 'rec_xyz');
});
