/** L2 优秀话术：举例参考，非唯一答案 */

export const BUILTIN_PLAYBOOKS = [
  {
    track: 'sales', scene_key: 'ask_features', title: '客户问功能',
    trigger_patterns: ['什么功能', '有哪些功能'],
    principle_ids: ['sell_outcome'],
    exemplar_text: '我先不讲功能，我想问一下，如果未来三个月客流增长20%、员工执行更稳定、老客户复购提升，哪个对您最重要？',
    source_label: '参考·销冠话术·卖结果',
  },
  {
    track: 'sales', scene_key: 'too_expensive', title: '客户说太贵',
    trigger_patterns: ['太贵', '便宜点'],
    principle_ids: ['stay_on_pain'],
    exemplar_text: '我完全理解。如果只是买一个软件，我也会觉得贵。我们更关注的是，未来30天能不能让您看到经营上的改善。如果没有价值，再便宜也是浪费；如果能持续带来收益，它就不是一笔成本，而是一项投入。',
    source_label: '参考·销冠话术·觉得太贵',
  },
  {
    track: 'sales', scene_key: 'has_system', title: '已有系统',
    trigger_patterns: ['已经有系统', '在用'],
    principle_ids: ['no_argue', 'stay_on_pain'],
    exemplar_text: '很多客户第一次也是这么说。其实我想了解一下，您现在最大的困扰，是系统没有，还是系统里的数据没人真正利用？',
    source_label: '参考·销冠话术·已有系统',
  },
  {
    track: 'sales', scene_key: 'think_again', title: '再考虑一下',
    trigger_patterns: ['再考虑', '以后再说'],
    principle_ids: ['stay_on_pain', 'closing'],
    exemplar_text: '没问题。为了避免我后续给您带来不必要的打扰，我想确认一下，您现在最大的顾虑是什么？是预算、效果，还是还需要和其他人沟通？',
    source_label: '参考·销冠话术·再考虑一下',
  },
  {
    track: 'sales', scene_key: 'no_time', title: '没时间',
    trigger_patterns: ['没时间', '太忙'],
    principle_ids: ['sell_outcome'],
    exemplar_text: '正因为您忙，所以才更值得看看。我们希望减少您每天花在管理和分析上的时间，而不是增加工作量。',
    source_label: '参考·销冠话术·没时间',
  },
  {
    track: 'sales', scene_key: 'ai_useless', title: '不相信AI',
    trigger_patterns: ['AI没什么用', '不相信AI'],
    principle_ids: ['no_argue'],
    exemplar_text: '您这么说一定有原因，方便说说之前遇到过什么情况吗？',
    source_label: '参考·销冠话术·不相信AI',
  },
  {
    track: 'sales', scene_key: 'no_early_pitch', title: '开场挖需',
    trigger_patterns: [],
    principle_ids: ['no_early_pitch', 'ask_first'],
    exemplar_text: '在介绍之前，我想先了解一下您现在最想解决的是什么问题？',
    source_label: '参考·销冠原则·先提问',
  },
  {
    track: 'cs', scene_key: 'complaint', title: '客户投诉',
    trigger_patterns: ['投诉', '短信'],
    principle_ids: ['soothe_first'],
    exemplar_text: '非常抱歉给您带来困扰，我先帮您把问题处理好，处理完成后我再跟您说明原因，可以吗？',
    source_label: '参考·金牌客服·投诉',
  },
  {
    track: 'cs', scene_key: 'angry', title: '客户情绪不好',
    trigger_patterns: ['着急', '受够了'],
    principle_ids: ['empathy'],
    exemplar_text: '我理解您现在着急，如果我是您，遇到这个情况也会着急。您放心，我现在跟您一起处理。',
    source_label: '参考·金牌客服·情绪安抚',
  },
  {
    track: 'cs', scene_key: 'ux_bad', title: '功能不好用',
    trigger_patterns: ['不好用', '难用'],
    principle_ids: ['ask_expectation'],
    exemplar_text: '谢谢您提这个建议。方便告诉我，您当时希望它怎么操作吗？这样我可以准确记录，也看看有没有更适合您的使用方式。',
    source_label: '参考·金牌客服·功能不好用',
  },
  {
    track: 'cs', scene_key: 'refund', title: '想退款',
    trigger_patterns: ['退款', '退钱'],
    principle_ids: ['dig_refund_root'],
    exemplar_text: '我理解您提出退款一定有原因。能不能先告诉我，是什么让您觉得这套服务没有达到您的预期？如果确实是我们的问题，我们先一起想办法解决。',
    source_label: '参考·金牌客服·要求退款',
  },
];

export async function ensurePlaybookSeed(pool) {
  for (const p of BUILTIN_PLAYBOOKS) {
    await pool.query(
      `INSERT INTO sales_sim_playbooks
         (track, scene_key, title, trigger_patterns, principle_ids, exemplar_text, source_label, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'approved')
       ON CONFLICT (track, scene_key) DO UPDATE SET
         title=EXCLUDED.title, trigger_patterns=EXCLUDED.trigger_patterns,
         principle_ids=EXCLUDED.principle_ids, exemplar_text=EXCLUDED.exemplar_text,
         source_label=EXCLUDED.source_label, active=TRUE`,
      [p.track, p.scene_key, p.title, p.trigger_patterns, p.principle_ids, p.exemplar_text, p.source_label]
    );
  }
}

export async function listPlaybooks(pool, track) {
  await ensurePlaybookSeed(pool);
  const r = await pool.query(
    `SELECT track, scene_key, title, principle_ids, exemplar_text, source_label
       FROM sales_sim_playbooks
      WHERE active=TRUE AND status='approved' AND ($1::text IS NULL OR track=$1)
      ORDER BY track, scene_key`,
    [track || null]
  );
  return r.rows || [];
}

export async function findPlaybooksForScenes(pool, track, sceneKeys = []) {
  if (!sceneKeys.length) return [];
  await ensurePlaybookSeed(pool);
  const r = await pool.query(
    `SELECT scene_key, title, exemplar_text, source_label, principle_ids
       FROM sales_sim_playbooks
      WHERE track=$1 AND active=TRUE AND scene_key = ANY($2::text[])`,
    [track, sceneKeys]
  );
  return r.rows || [];
}

export async function findPlaybooksForPrinciples(pool, track, principleIds = []) {
  if (!principleIds.length) return [];
  await ensurePlaybookSeed(pool);
  const r = await pool.query(
    `SELECT scene_key, title, exemplar_text, source_label, principle_ids
       FROM sales_sim_playbooks
      WHERE track=$1 AND active=TRUE AND principle_ids && $2::text[]
      LIMIT 6`,
    [track, principleIds]
  );
  return r.rows || [];
}
