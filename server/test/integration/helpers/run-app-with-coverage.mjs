/**
 * 集成测试覆盖率采集入口：与 index.js 同进程，
 * 在 SIGTERM/SIGINT 时 process.exit(0) 以触发 NODE_V8_COVERAGE 落盘。
 * （直接 kill 默认退出路径经常写不出 coverage 文件——已本地复现。）
 */
function forceExit() {
  process.exit(0);
}

process.on('SIGTERM', forceExit);
process.on('SIGINT', forceExit);

await import('../../../index.js');
