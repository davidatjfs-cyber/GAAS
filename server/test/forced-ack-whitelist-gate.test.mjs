/**
 * 2026-08-06：强制确认弹窗必须是**白名单**形态（默认不拦截）。
 *
 * 背景——这条闸门守的是一个反复复发了 5 周的问题，不是一次普通改动：
 * 7/1 起碰"通知重复/弹窗刷屏"的提交有 118 个，其中 4 个在标题里写了"根因修复""永久修复"
 * （ba8233f / c34fc21 / 48ebdaa / f52e78b），但每一轮都在几天内复发。复盘结论是这些修复
 * 属于同一个类别：在观察到问题的地方补一条排除规则（黑名单）。只要默认值仍是"所有通知
 * 都能全屏拦人"，下一个新增的通知类型就自动继承拦截权，而加它的人不知道有黑名单要同步
 * 维护——复发是必然的，不是运气问题。
 *
 * 反转默认值之后，新类型天生无害；"想打断用户"变成一个必须主动做的决定。这条测试就是
 * 防止有人（包括未来的我）为了图快把它改回 `!== 'xxx'` 的黑名单写法。
 *
 * 同时断言 bundle 产物——CLAUDE.md 记过两次事故：working-fixed.html 的主 <script> 会被
 * bundle-frontend.mjs 整块覆盖回 frontend/src/pages/*.js，只改一边会在下次 bundle 时静默消失。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(repoRoot, 'frontend/src/pages/09-resignation.js');
const BUNDLE = join(repoRoot, 'working-fixed.html');

const WHITELIST_GUARD =
  "if (!FORCE_ACK_NOTIFICATION_TYPES.has(String(a.type || ''))) return false;";

test('强制确认队列必须是白名单形态：不在名单里的类型默认不弹', () => {
  const src = readFileSync(SRC, 'utf8');
  assert.ok(
    src.includes('const FORCE_ACK_NOTIFICATION_TYPES = new Set(['),
    '缺少 FORCE_ACK_NOTIFICATION_TYPES 白名单定义'
  );
  assert.ok(
    src.includes(WHITELIST_GUARD),
    '强制确认队列必须用白名单 has() 判定；改回 `type !== "xxx"` 的黑名单写法会让新增通知类型' +
      '自动获得全屏拦截权——这正是本问题反复复发 5 周的根因'
  );
  assert.ok(
    src.includes("type: String(n.type || '')"),
    'dbSysNotifs 必须把 type 带上，否则白名单永远判定不出来'
  );
});

test('运维告警 system_alert 不得出现在强制确认白名单里', () => {
  const src = readFileSync(SRC, 'utf8');
  const block = src.slice(
    src.indexOf('const FORCE_ACK_NOTIFICATION_TYPES = new Set(['),
    src.indexOf(']);', src.indexOf('const FORCE_ACK_NOTIFICATION_TYPES = new Set(['))
  );
  assert.ok(
    !block.includes("'system_alert'"),
    'system_alert 由 cron 每 30 分钟持续产生且历史上多次误报，不能全屏拦截用户'
  );
});

test('白名单逻辑必须已进入 bundle 产物（防 bundle 覆盖导致静默失效）', () => {
  const html = readFileSync(BUNDLE, 'utf8');
  assert.ok(
    html.includes(WHITELIST_GUARD),
    'working-fixed.html 里没有白名单判定——多半是改了拆分源但没跑 bundle-frontend.mjs'
  );
});
