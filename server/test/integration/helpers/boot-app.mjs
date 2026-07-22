/**
 * 集成测试用的应用启动器。
 *
 * index.js 顶层直接调用 app.listen()（没有导出 app 对象），把它当模块 import
 * 会立刻启动一个真实监听的进程、跑全部初始化（定时任务/飞书同步等）。
 * 与其做侵入式改造把 app 拆出来（拆分前先不碰主文件结构），这里选择更保守的方式：
 * 把 index.js 当成真实子进程启动，指向一个隔离的测试数据库，通过真实 HTTP 请求验证行为。
 * 代价是比纯内存测试慢，好处是测的是"实际会跑起来的东西"，不是"我以为会跑起来的东西"。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, '../../..');

let nextPort = 4100; // 避免和本机开发用的3000/3101撞

export async function bootApp(envOverrides = {}) {
  const port = nextPort++;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://' + (process.env.USER || 'postgres') + '@localhost:5432/gaas_test',
    JWT_SECRET: 'test-jwt-secret-not-for-production-use-only-in-tests',
    // 测试环境不允许自动建表/改schema（和生产一致的安全策略），schema由migrate.js预先跑好
    ALLOW_SCHEMA_CHANGES: 'false',
    ...envOverrides
  };

  const child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealthy(baseUrl, child, logs);

  async function stop() {
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  return { baseUrl, stop, logs };
}

async function waitForHealthy(baseUrl, child, logs, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('测试进程提前退出 code=' + child.exitCode + '\n' + logs.join(''));
    }
    try {
      const res = await fetch(baseUrl + '/api/health');
      if (res.status === 200 || res.status === 500) {
        // 500 也算"进程活着、路由能响应"，具体健康与否由测试自己断言
        return;
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('等待应用启动超时: ' + (lastErr?.message || 'unknown') + '\n' + logs.join(''));
}
