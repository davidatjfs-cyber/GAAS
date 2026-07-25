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

// node --test 会把不同测试文件当独立进程/模块实例并行跑，模块级计数器在文件间不共享，
// 用随机端口+启动失败重试，比"每个文件从固定端口起跳"更不容易撞。
function randomTestPort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

export async function bootApp(envOverrides = {}, attempt = 0) {
  const port = randomTestPort();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    APP_ENV: 'test',
    PORT: String(port),
    HOST: '127.0.0.1',
    // 被测应用必须用非superuser角色连接——本地起的测试库默认连接用户是superuser，
    // Postgres里superuser天生bypass RLS(不管表有没有FORCE ROW LEVEL SECURITY)，
    // 如果应用也用superuser连接，多租户隔离测试会"看起来通过"但其实什么都没测到。
    DATABASE_URL: process.env.TEST_APP_DATABASE_URL || 'postgres://gaas_app_test:gaas_app_test_pw@localhost:5432/gaas_test',
    JWT_SECRET: 'test-jwt-secret-not-for-production-use-only-in-tests',
    // 测试环境不允许自动建表/改schema（和生产一致的安全策略），schema由migrate.js预先跑好
    ALLOW_SCHEMA_CHANGES: 'false',
    // safety.js 默认在非production/staging环境把DB连接设为只读(防止本地/CI意外写坏共享库)，
    // 这里的测试库是专用的一次性库，需要显式打开写权限，否则登录迁移/改密码这类写操作
    // 会被静默设为只读事务，产生看似随机的失败(取决于连接池里哪条连接先被读写)。
    ENABLE_DB_WRITE: 'true',
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
  try {
    await waitForHealthy(baseUrl, child, logs);
  } catch (e) {
    child.kill('SIGKILL');
    if (attempt < 3 && /EADDRINUSE/.test(logs.join(''))) {
      return bootApp(envOverrides, attempt + 1);
    }
    throw e;
  }

  async function stop() {
    // 合并覆盖率采集时依赖进程正常退出落盘 V8 coverage；给更长优雅退出窗口，避免 SIGKILL 丢数据
    const gracefulMs = process.env.NODE_V8_COVERAGE || process.env.GAAS_COVERAGE_GRACEFUL
      ? 15000
      : 3000;
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, gracefulMs);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }

  return { baseUrl, stop, logs };
}

async function waitForHealthy(baseUrl, child, logs, timeoutMs = 45000) {
  // 用非superuser角色连接时，几个模块的schema-ensure调用会因权限不足报错(被捕获、非致命，
  // 生产环境用的应用角色大概率也没有这些表的owner权限，这是真实场景，不是测试环境的假象)，
  // 导致启动比superuser下慢很多(实测约20s)，超时要留够余量。
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
