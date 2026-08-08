import test from 'node:test';
import assert from 'node:assert/strict';
import { scanViolations, evalSession, evaluateUpgrade } from '../coach-scoring.js';
import { createCoachSession, nextCoachTurn, finishCoachSession } from '../coach-session.js';
import { scriptFor } from '../coach-scripts.js';
import { SKILL_SCENES } from '../coach-scenes.js';

test('14 技能 × 3 级别均有 2 套场景且字段完整', () => {
  const expected = [
    'selling', 'dish_intro', 'dine_complaint', 'table_visit', 'delivery_complaint',
    'delivery_anomaly', 'greeting', 'dish_knowledge', 'allergy_knowledge',
    'food_safety_knowledge', 'food_safety_incident', 'kitchen_collab',
    'output_quality', 'cooking_knowledge',
  ];
  assert.equal(Object.keys(SKILL_SCENES).length, 14);
  for (const k of expected) {
    for (const level of ['normal', 'advanced', 'gold']) {
      const s = scriptFor(k, level);
      assert.ok(s, `缺少剧本 ${k}/${level}`);
      assert.equal(s.scenes.length, 2, `${k}/${level} 场景数`);
      for (const scene of s.scenes) {
        assert.ok(scene.key && scene.persona, `${k}/${level}/${scene.key}`);
        assert.ok(Array.isArray(scene.opening) && scene.opening.length >= 2, `${k}/${level} opening`);
        assert.ok(Array.isArray(scene.deep_dive) && scene.deep_dive.length >= 6, `${k}/${level} deep_dive`);
        assert.ok(Array.isArray(scene.challenge) && scene.challenge.length >= 3, `${k}/${level} challenge`);
      }
      assert.ok(s.closing_satisfied?.length && s.closing_unsatisfied?.length, `${k}/${level} closing`);
    }
  }
});

function memoryPool(sessionStore) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push(sql.slice(0, 40));
      if (sql.includes('INSERT INTO customer_twin_coach_sessions')) {
        return { rows: [{ id: 1 }] };
      }
      if (sql.includes('SELECT * FROM customer_twin_coach_sessions')) {
        return { rows: sessionStore.current ? [sessionStore.current] : [] };
      }
      if (sql.includes('SET phase =')) {
        const phase = params[1];
        const transcript = params[2];
        sessionStore.current.phase = phase;
        sessionStore.current.transcript = JSON.parse(transcript);
        return { rows: [] };
      }
      if (sql.includes('SET status=')) {
        sessionStore.current.status = 'finished';
        return { rows: [] };
      }
      if (sql.includes('SELECT * FROM job_coach_skill_progress')) {
        return { rows: sessionStore.progress ? [sessionStore.progress] : [] };
      }
      if (sql.includes('INSERT INTO job_coach_skill_progress')) {
        sessionStore.progress = {
          level: params[2], trained_count: params[3], success_count: params[4],
        };
        return { rows: [] };
      }
      if (sql.includes('SELECT title, content, tags')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test('规则层：推诿/编造/承诺模糊被一票否决', () => {
  const bad = scanViolations([
    { role: 'customer', text: '充500送100是真的吗？' },
    { role: 'trainee', text: '这个不关我事，你问别人吧。' },
  ]);
  assert.ok(bad.length >= 1);
  const clean = scanViolations([
    { role: 'customer', text: '充500送100是真的吗？' },
    { role: 'trainee', text: '是真的，我帮您介绍：充500送100，另外会员还能积分，请问您平时大概多久来一次？' },
  ]);
  assert.equal(clean.length, 0);
});

test('评分：无违规且启发式达标 → 成功', () => {
  const transcript = [
    { role: 'customer', text: '充500送100是真的吗？' },
    { role: 'trainee', text: '是真的，我帮您介绍规则：充500送100元，到账即可用，会员还能享受积分和生日福利。您平时一个人来还是和朋友一起？' },
    { role: 'customer', text: '划算吗？' },
    { role: 'trainee', text: '按您的用餐频率，一个月两三次的话，充500大概两个月用完，相当于每次多送10元左右，挺划算的。您看要不要现在办一个？' },
  ];
  const r = evalSession({ transcript, skillKey: 'selling' });
  assert.equal(r.violations.length, 0);
  assert.equal(r.success, true);
  assert.ok(r.total >= 80);
});

test('升级规则：10次且7次成功 → 升级，未满10次不升级', () => {
  assert.equal(evaluateUpgrade({ level: 'normal', trained_count: 9, success_count: 7 }).upgrade, false);
  const up = evaluateUpgrade({ level: 'normal', trained_count: 10, success_count: 7 });
  assert.equal(up.upgrade, true);
  assert.equal(up.next_level, 'advanced');
});

test('会话创建：返回开场并进入深挖阶段', async () => {
  const store = { current: null, progress: null };
  const pool = memoryPool(store);
  const r = await createCoachSession(pool, { username: 'NNYXCYY52', skillKey: 'selling' });
  assert.equal(r.ok, true);
  assert.equal(r.session.phase, 'deep_dive');
  assert.equal(r.session.transcript[0].role, 'customer');
  assert.ok(r.session.persona.scene_key, '应记录场景 key');
  assert.ok(r.session.persona.level === 'normal', '默认普通难度');
  assert.ok(r.session.transcript[0].text.length > 0);
});

test('会话推进：深挖6轮→挑战3轮→收尾（约10分钟对话量）', async () => {
  const store = {
    current: {
      id: 1, skill_key: 'selling', phase: 'deep_dive', status: 'active',
      persona: { brand: '洪潮', level: 'normal', scene_key: 'sell_n1', order: { deep: [0, 1, 2, 3, 4, 5], challenge: [0, 1, 2] } },
      transcript: [{ role: 'customer', text: '你们会员充500送100是真的吗？', phase: 'opening' }],
    },
    progress: null,
  };
  const pool = memoryPool(store);
  let t;
  for (let i = 0; i < 10; i += 1) {
    t = await nextCoachTurn(pool, { sessionId: 1, username: 'u', message: '好的，我帮您介绍。' });
    assert.equal(t.ok, true);
  }
  assert.ok(t.done, '收尾后 done=true');
  assert.equal(store.current.transcript.filter((x) => x.role === 'trainee').length, 10);
  const customerTurns = store.current.transcript.filter((x) => x.role === 'customer').length;
  assert.ok(customerTurns >= 10, '顾客追问轮数应 ≥10');
});

test('完成会话：成功→进度+1；违规→不成功', async () => {
  const store = {
    current: {
      id: 1, skill_key: 'selling', phase: 'closing', status: 'active',
      persona: { brand: '洪潮' },
      transcript: [
        { role: 'customer', text: '充500送100是真的吗？' },
        { role: 'trainee', text: '是真的，我帮您介绍规则：充500送100元，会员积分和生日福利都有。您看要不要办一个？' },
        { role: 'customer', text: '划算吗？' },
        { role: 'trainee', text: '按您一个月两三次的频率，两个月用完，相当于每次多送10元，挺划算的。' },
        { role: 'customer', text: '行，那办一个吧。' },
      ],
    },
    progress: null,
  };
  const pool = memoryPool(store);
  const r = await finishCoachSession(pool, { sessionId: 1, username: 'u', useLlm: false });
  assert.equal(r.ok, true);
  assert.equal(r.report.success, true);
  assert.ok(Array.isArray(r.report.suggestions));
  assert.ok(r.report.dims['专业度'] != null, '评分维度应为中文展示');
  assert.equal(store.progress.trained_count, 1);
  assert.equal(store.progress.success_count, 1);

  store.current.status = 'active';
  store.current.transcript[1].text = '这个不关我事。';
  const r2 = await finishCoachSession(pool, { sessionId: 1, username: 'u', useLlm: false });
  assert.equal(r2.report.success, false);
});

test('完成会话：第10次且第7次成功 → 升级并重新计次', async () => {
  const store = {
    current: {
      id: 2, skill_key: 'selling', phase: 'closing', status: 'active',
      persona: { brand: '洪潮' },
      transcript: [
        { role: 'customer', text: '充500送100是真的吗？' },
        { role: 'trainee', text: '是真的，我帮您介绍：充500送100元，会员积分和生日福利都有。您看要不要办？' },
        { role: 'customer', text: '划算吗？' },
        { role: 'trainee', text: '按您的频率挺划算的，两个月用完相当于每次多送10元。' },
        { role: 'customer', text: '行，办一个吧。' },
      ],
    },
    progress: { level: 'normal', trained_count: 9, success_count: 6 },
  };
  const pool = memoryPool(store);
  const r = await finishCoachSession(pool, { sessionId: 2, username: 'u', useLlm: false });
  assert.equal(r.report.success, true);
  assert.equal(store.progress.level, 'advanced');
  assert.equal(store.progress.trained_count, 0);
  assert.equal(store.progress.success_count, 0);
  assert.equal(r.progress.upgraded, true);
});
