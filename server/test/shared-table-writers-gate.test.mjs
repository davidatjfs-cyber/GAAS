/**
 * C10 / SHARED_TABLE_WRITERS 闸门：冻结跨仓越界写入，禁止新增。
 *
 * packages/gaas-shared 的 SHARED_TABLE_WRITERS 定义唯一写入方；
 * 本测试扫描 INSERT/UPDATE/DELETE，比对矩阵，存量进 allowlist（只减不增）。
 *
 * 搬家约定：同一 OP+表 从旧路径迁到新路径不算「新增」——把 allowlist 里旧键
 * 换成新键即可（见 REPATH_NOTES）。禁止净新增（新 OP+表 组合）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SHARED_TABLES, SHARED_TABLE_WRITERS } from '@gaas/shared';
import { walkServerJs } from './walk-server-js.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '..');

/**
 * 冻结前已存在的越界写入（file|OP|table）。只减不增。
 * 文件搬家时：删除旧路径键、加入新路径键，并在 REPATH_NOTES 记一笔。
 */
const GAAS_CROSS_WRITER_ALLOWLIST = new Set([
  // 2026-07-29 已知技术债（明确记录，非误加）：角色工作台的批量推广菜品/任务完成闭环
  // （promoteDishToStores 建任务、respondToTask/confirmTaskResponse 责任人提交证据+发起人
  // 确认）直接写 master_tasks，没有走 HTTP 代理到 agents-service-v2。正确做法应该是
  // agents-service-v2 开放一套给"人类发起的普通任务"用的创建/响应/确认接口（现有
  // agent-task-board 那套接口语义是给 AI agent 用的，不适用），工作台这边改走 HTTP——
  // 但那是一次新增跨服务接口的工作量，这次先放行不阻塞合并，后续必须补上，不能一直留着。
  'domains/workspace/service.js|INSERT INTO|master_tasks',
  'domains/workspace/service.js|UPDATE|master_tasks',
  // 2026-07-30 同类已知技术债：营销活动建议"执行"改成先分配责任人再生成任务
  // （assignMarketingActionTask，同样是人类发起、责任人提交证据+发起人确认的任务，
  // 不是AI agent任务），跟上面workspace/service.js的既有豁免是同一个未解决问题，
  // 一并记录，不是新的独立越界。
  'domains/growth-actions/service.js|INSERT INTO|master_tasks',
  // P2：删除死代码 handleTaskEscalation 后 agents.js 已无 agent_messages INSERT
  // Wave A11a：archiveOldBitableSubmissions 迁出；agents.js 已无 DELETE agent_messages
  'domains/feishu-bitable/archive-old-submissions.js|DELETE FROM|agent_messages',
  // Wave A1：KPI radar INSERT 从 agents.js runDataAuditor 迁出；A1-split 再迁到 persist 子模块
  'domains/agent-auditor/run-data-auditor-persist.js|INSERT INTO|agent_messages',
  // Wave A7：handleOpsChecklistCardAction 迁出
  'domains/agent-ops/handle-checklist-card-action.js|INSERT INTO|agent_messages',
  // Wave A3：onFeishuEvent 迁出
  // Wave A3-split：on-feishu-event.js 同批切分 → registration/employee/checklist/agent-route
  'domains/agent-feishu-bot/on-feishu-event-registration.js|INSERT INTO|feishu_users',
  'domains/agent-feishu-bot/on-feishu-event-employee.js|UPDATE|feishu_users',
  'domains/agent-feishu-bot/on-feishu-event-checklist.js|INSERT INTO|agent_messages',
  'domains/agent-feishu-bot/on-feishu-event-agent-route.js|INSERT INTO|agent_messages',
  'domains/agent-feishu-bot/on-feishu-event-agent-route.js|UPDATE|agent_messages',
  // Wave A9：runChiefEvaluator 迁出；agents.js 已无 agent_scores INSERT
  'domains/agent-evaluator/run-chief-evaluator.js|INSERT INTO|agent_scores',
  // Wave A4b：pollBitableSubmissions 迁出（agents.js 不再写 feishu_generic_records）
  // P5.4：poll-submissions.js → poll-submissions-helpers.js（同 OP+表换路径）
  'domains/feishu-bitable/poll-submissions-helpers.js|INSERT INTO|feishu_generic_records',
  'domains/feishu-bitable/poll-submissions-helpers.js|INSERT INTO|agent_messages',
  // P2：processBitableData 类型处理器迁出
  'domains/feishu-bitable/process-bitable-data-helpers.js|INSERT INTO|agent_messages',
  'domains/feishu-bitable/process-bitable-data-helpers.js|UPDATE|agent_messages',
  // P2：registerFeishuUser 迁出 lark-send-io（agents.js 不再写 feishu_users）
  'domains/agent-feishu-bot/lark-send-io.js|INSERT INTO|feishu_users',
  // Wave A8：sendScheduledChecklist 迁出；agents.js 已无 master_tasks INSERT（另见 training-flow）
  // P5.4：send-scheduled-checklist.js → send-scheduled-checklist-helpers.js（同 OP+表换路径）
  'domains/agent-ops/send-scheduled-checklist-helpers.js|INSERT INTO|master_tasks',
  // processBitableData 迁出后 agents.js 不再 UPDATE agent_messages（见 helpers）
  'domains/agent-feishu-bot/lark-send-io.js|UPDATE|feishu_users',
  // followUpOverdueTasks 催办 reminder；task-response 回复闭环已迁出 helpers
  'domains/agent-ops/follow-up-overdue-tasks.js|UPDATE|master_tasks',
  'domains/feishu-bitable/task-response-helpers.js|UPDATE|master_tasks',
  // P2：pushIssuesToFeishu 迁出（agents.js 仍有其它 agent_messages INSERT）
  'domains/agent-feishu-bot/push-issues.js|INSERT INTO|agent_messages',
  // handleAgentMessage 培训考核通过：master_tasks INSERT 部分迁入 agent-message
  'domains/agent-message/training-flow.js|INSERT INTO|master_tasks',
  'auto-ops-engine.js|UPDATE|master_tasks',
  'fix_bad_review_code.js|INSERT INTO|agent_messages',
  'fix_bitable_process.js|INSERT INTO|agent_messages',
  'force_sync.js|INSERT INTO|agent_messages',
  // Wave 4p：dedup cleanup 从 index.js 迁出（同 OP+表换路径）
  'domains/dedup/routes.js|DELETE FROM|agent_messages',
  // Wave H1：ensureDedupIndexes / upsertFeishuGenericRecord 从 index.js 迁出
  'services/feishu-bitable-schema-ensure.js|DELETE FROM|agent_messages',
  'domains/feishu-bitable/records.js|INSERT INTO|feishu_generic_records',
  // P0-A1：decide 从 index.js 迁出；feishu_users 写入现位于 handlers/onboarding.js
  // （同 OP+表换路径不算新增，见 REPATH_NOTES）
  'domains/approvals/handlers/onboarding.js|INSERT INTO|feishu_users',
  'domains/approvals/handlers/onboarding.js|UPDATE|feishu_users',
  // Wave H19：account-gate 从 index.js 迁出（同 OP+表换路径）
  'domains/employees/account-gate.js|UPDATE|feishu_users',
  // Wave M5：listen-time knowledge_base.group_name backfill 从 index.js 迁出
  // P5.4：startup-agent-schema.js → startup-agent-schema-helpers.js（同 OP+表换路径）
  'domains/shared/startup-agent-schema-helpers.js|UPDATE|knowledge_base',
  'domains/knowledge/service.js|DELETE FROM|knowledge_base',
  'domains/knowledge/service.js|INSERT INTO|knowledge_base',
  'domains/knowledge/service.js|UPDATE|knowledge_base',
  'domains/knowledge/knowledge-groups.js|UPDATE|knowledge_base',
  'domains/knowledge/knowledge-groups.js|DELETE FROM|knowledge_base',
  'domains/knowledge/explanations.js|UPDATE|knowledge_base',
  // P5.4：runCreateKnowledgeBackground → create-knowledge-background-helpers.js
  'domains/knowledge/create-knowledge-background-helpers.js|UPDATE|knowledge_base',
  'domains/master-agent/ops-dispatch.js|INSERT INTO|agent_messages',
  'domains/master-agent/ops-dispatch.js|UPDATE|master_tasks',
  // P4：createTask/transitionTask → domains/master-agent/task-lifecycle.js
  'domains/master-agent/task-lifecycle.js|INSERT INTO|master_tasks',
  'domains/master-agent/task-lifecycle.js|UPDATE|master_tasks',
  // P4：startMasterAgent escalation UPDATE → start-ticks.js
  'domains/master-agent/start-ticks.js|UPDATE|master_tasks',
  'ontology/action-plan-service.js|INSERT INTO|master_tasks',
  'ontology/ontology-task-adapter.js|INSERT INTO|master_tasks',
  'domains/performance-invalidation/service.js|UPDATE|agent_scores',
  'performance-jobs.js|INSERT INTO|agent_scores',
  'performance-jobs.js|UPDATE|agent_scores',
  'rag-tool.js|UPDATE|knowledge_base',
  'test-tenant-operation-inspection.mjs|INSERT INTO|master_tasks',
  // Wave 2：training.js → domains/training/*（同 OP+表换路径；会话/图谱两处仍写 knowledge_base）
  // P5.4：routes-rubric.js → routes-rubric-analyze.js（同 OP+表换路径）
  'domains/training/routes-rubric-analyze.js|UPDATE|knowledge_base',
  // Wave H44：sessions UPDATE knowledge_base 从 routes-sessions 抽到 service-sessions
  'domains/training/service-sessions.js|UPDATE|knowledge_base',
  'utils/feishu-open-id-cross-app.js|UPDATE|feishu_users',
]);

/** 搬家记录（文档用，不参与断言）。格式：旧路径 → 新路径 | OP|table */
const REPATH_NOTES = [
  'index.js → domains/approvals/handlers/onboarding.js | INSERT INTO|feishu_users',
  'index.js → domains/approvals/handlers/onboarding.js | UPDATE|feishu_users',
  'index.js → domains/employees/account-gate.js | UPDATE|feishu_users',
  'index.js → domains/shared/startup-agent-schema.js | UPDATE|knowledge_base',
  'domains/shared/startup-agent-schema.js → startup-agent-schema-helpers.js | UPDATE|knowledge_base',
  'training.js → domains/training/routes-rubric.js | UPDATE|knowledge_base',
  'domains/training/routes-rubric.js → domains/training/routes-rubric-analyze.js | UPDATE|knowledge_base',
  'training.js → domains/training/routes-sessions.js | UPDATE|knowledge_base',
  'domains/training/routes-sessions.js → domains/training/service-sessions.js | UPDATE|knowledge_base',
  'knowledge-routes.js → domains/knowledge/service.js | DELETE FROM|knowledge_base',
  'knowledge-routes.js → domains/knowledge/service.js | INSERT INTO|knowledge_base',
  'knowledge-routes.js → domains/knowledge/service.js | UPDATE|knowledge_base',
  'domains/knowledge/service.js → create-knowledge-background-helpers.js | UPDATE|knowledge_base',
  'domains/knowledge/service.js → domains/knowledge/knowledge-groups.js | UPDATE|knowledge_base',
  'domains/knowledge/service.js → domains/knowledge/knowledge-groups.js | DELETE FROM|knowledge_base',
  'domains/knowledge/service.js → domains/knowledge/explanations.js | UPDATE|knowledge_base',
  'index.js → domains/dedup/routes.js | DELETE FROM|agent_messages',
  'index.js → domains/feishu-bitable/records.js | INSERT INTO|feishu_generic_records',
  'index.js → services/feishu-bitable-schema-ensure.js | DELETE FROM|agent_messages',
  'performance-invalidation-api.js → domains/performance-invalidation/service.js | UPDATE|agent_scores',
  'agents.js → domains/agent-message/training-flow.js | INSERT INTO|master_tasks',
  'agents.js → domains/agent-auditor/run-data-auditor.js | INSERT INTO|agent_messages',
  'domains/agent-auditor/run-data-auditor.js → run-data-auditor-persist.js | INSERT INTO|agent_messages',
  'agents.js → domains/agent-feishu-bot/on-feishu-event.js | INSERT INTO|feishu_users',
  'agents.js → domains/agent-feishu-bot/on-feishu-event.js | UPDATE|feishu_users',
  'agents.js → domains/agent-feishu-bot/on-feishu-event.js | INSERT INTO|agent_messages',
  'agents.js → domains/agent-feishu-bot/on-feishu-event.js | UPDATE|agent_messages',
  'domains/agent-feishu-bot/on-feishu-event.js → on-feishu-event-registration.js | INSERT INTO|feishu_users',
  'domains/agent-feishu-bot/on-feishu-event.js → on-feishu-event-employee.js | UPDATE|feishu_users',
  'domains/agent-feishu-bot/on-feishu-event.js → on-feishu-event-checklist.js | INSERT INTO|agent_messages',
  'domains/agent-feishu-bot/on-feishu-event.js → on-feishu-event-agent-route.js | INSERT INTO|agent_messages',
  'domains/agent-feishu-bot/on-feishu-event.js → on-feishu-event-agent-route.js | UPDATE|agent_messages',
  'agents.js → domains/feishu-bitable/poll-submissions.js | INSERT INTO|feishu_generic_records',
  'agents.js → domains/feishu-bitable/poll-submissions.js | INSERT INTO|agent_messages',
  'domains/feishu-bitable/poll-submissions.js → poll-submissions-helpers.js | INSERT INTO|feishu_generic_records',
  'domains/feishu-bitable/poll-submissions.js → poll-submissions-helpers.js | INSERT INTO|agent_messages',
  'agents.js → domains/agent-ops/handle-checklist-card-action.js | INSERT INTO|agent_messages',
  'agents.js → domains/agent-ops/send-scheduled-checklist.js | INSERT INTO|master_tasks',
  'domains/agent-ops/send-scheduled-checklist.js → send-scheduled-checklist-helpers.js | INSERT INTO|master_tasks',
  'agents.js → domains/agent-evaluator/run-chief-evaluator.js | INSERT INTO|agent_scores',
  'agents.js → domains/feishu-bitable/archive-old-submissions.js | DELETE FROM|agent_messages',
  'agents.js → domains/feishu-bitable/task-response-helpers.js | UPDATE|master_tasks',
  'agents.js → domains/feishu-bitable/process-bitable-data-helpers.js | INSERT INTO|agent_messages',
  'agents.js → domains/feishu-bitable/process-bitable-data-helpers.js | UPDATE|agent_messages',
  'agents.js → domains/agent-ops/follow-up-overdue-tasks.js | UPDATE|master_tasks',
  'agents.js → domains/agent-feishu-bot/push-issues.js | INSERT INTO|agent_messages',
  'agents.js → domains/agent-feishu-bot/lark-send-io.js | INSERT INTO|feishu_users',
  'agents.js → domains/agent-feishu-bot/lark-send-io.js | UPDATE|feishu_users',
  // P2：删除死代码 handleTaskEscalation（agents.js 唯一残留 agent_messages INSERT）
  'agents.js → (deleted handleTaskEscalation) | INSERT INTO|agent_messages',
  'master-agent.js → domains/master-agent/task-lifecycle.js | INSERT INTO|master_tasks',
  'master-agent.js → domains/master-agent/task-lifecycle.js | UPDATE|master_tasks',
  'master-agent.js → domains/master-agent/ops-dispatch.js | INSERT INTO|agent_messages',
  'master-agent.js → domains/master-agent/ops-dispatch.js | UPDATE|master_tasks',
  'master-agent.js → domains/master-agent/start-ticks.js | UPDATE|master_tasks',
];

const OWNER = 'gaas';
const keyToTable = Object.fromEntries(Object.entries(SHARED_TABLES));

function walkJs(dir) {
  return walkServerJs(serverRoot, { root: dir, skipTestFiles: true });
}

function scanCrossWrites(rootAbs, owner) {
  const litRe = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)\b/gi;
  const tplRe = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+\$\{SHARED_TABLES\.([A-Z0-9_]+)\}/gi;
  const hits = new Set();
  for (const abs of walkJs(rootAbs)) {
    const rel = path.relative(rootAbs, abs).replace(/\\/g, '/');
    if (rel.startsWith('scripts/')) continue;
    const src = fs.readFileSync(abs, 'utf8');
    let m;
    const r1 = new RegExp(litRe);
    while ((m = r1.exec(src))) {
      const op = m[1].toUpperCase().replace(/\s+/g, ' ');
      const table = m[2].toLowerCase();
      const writer = SHARED_TABLE_WRITERS[table];
      if (!writer || writer === owner) continue;
      hits.add(`${rel}|${op}|${table}`);
    }
    const r2 = new RegExp(tplRe);
    while ((m = r2.exec(src))) {
      const op = m[1].toUpperCase().replace(/\s+/g, ' ');
      const table = keyToTable[m[2]];
      if (!table) continue;
      const writer = SHARED_TABLE_WRITERS[table];
      if (!writer || writer === owner) continue;
      hits.add(`${rel}|${op}|${table}`);
    }
  }
  return [...hits].sort();
}

/** 键的 OP|table 后缀，用于搬家时判断「同写入、换路径」 */
function opTableSuffix(key) {
  const parts = key.split('|');
  if (parts.length < 3) return key;
  return parts.slice(1).join('|');
}

test('SHARED_TABLE_WRITERS：GAAS 不得新增对 agents 权威表的写入', () => {
  const found = scanCrossWrites(serverRoot, OWNER);
  const unexpected = found.filter((h) => !GAAS_CROSS_WRITER_ALLOWLIST.has(h));
  const stale = [...GAAS_CROSS_WRITER_ALLOWLIST].filter((h) => !found.includes(h));

  // 若失败信息像「路径变了、OP+表没变」，提示按 REPATH_NOTES 改 allowlist，而不是当新写入
  const allowedSuffixes = new Set([...GAAS_CROSS_WRITER_ALLOWLIST].map(opTableSuffix));
  const likelyRepath = unexpected.filter((h) => allowedSuffixes.has(opTableSuffix(h)));
  const hint =
    likelyRepath.length > 0
      ? `\n（疑似文件搬家，请更新 allowlist 路径并记入 REPATH_NOTES：\n${likelyRepath.join('\n')}\n已有记录：\n${REPATH_NOTES.join('\n')}）`
      : '';

  assert.deepEqual(
    unexpected,
    [],
    `新增越界写入（请改走 HTTP 或扩共享包纪律）：\n${unexpected.join('\n')}${hint}`
  );
  // allowlist 只减不增：已清除的条目应从白名单删掉（提示，不强制 fail 以免误伤 WIP）
  if (stale.length) {
    console.warn('[shared-table-writers] allowlist 可收缩（已无命中）:\n' + stale.join('\n'));
  }
});
