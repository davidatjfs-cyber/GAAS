/**
 * PM2 单一配置来源。生产固定 PORT=3000（与 agents-service-v2 的 3101 分离）。
 *
 * 2026-07-28 补齐：此前生产进程是用一条手敲 `pm2 start server/index.js --name hrms-service`
 * 起的，参数从未进过版本控制——新服务器灾备重建或换人接手时，只能靠 `pm2 describe`
 * 反推配置。本文件按 `pm2 describe hrms-service` 实测值固化，往后启动/重建统一走这份配置。
 *
 * 部署：cd /opt/hrms && pm2 delete hrms-service 2>/dev/null; pm2 start ecosystem.config.cjs --update-env
 * 日常改代码后重载：pm2 reload hrms-service --update-env（不需要重新 delete/start）
 *
 * 真实密钥（DATABASE_URL/JWT_SECRET/各类 API_KEY 等）不在这里——全部在
 * /opt/hrms/server/.env，由 index.js 自己 `import 'dotenv/config'` 按 cwd 加载，不进 git。
 * 本文件只放不敏感的运维/启动参数。cwd 必须指向 server/ 目录，见下方 cwd 字段注释。
 */
module.exports = {
  apps: [
    {
      name: 'hrms-service',
      script: 'index.js',
      /** 2026-07-28 事故修正：cwd 必须是 server/ 目录——index.js 用 `import 'dotenv/config'`
       *  按 process.cwd() 找 .env，之前误设成仓库根目录导致读不到 /opt/hrms/server/.env，
       *  CONFIRM_PRODUCTION/JWT_SECRET 等全部为空，触发 safety.js 的生产安全阀直接退出，
       *  比内存重启崩得更快（几秒一次）。 */
      cwd: `${__dirname}/server`,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      /**
       * 2026-08-04 根因修复：内存反复被 pm2 掐掉的真正原因是「三个阈值互相打架」，
       * 不是内存不够。当时实测：
       *   V8 heap_size_limit = 1796MB（Node 按整机 3.4G 自动推出来的默认值）
       *   pm2 max_memory_restart = 1200MB（运行时实际值，跟本文件写的 2G 又不一样）
       *   应用内告警 PM2_MAX_MEMORY_RESTART_BYTES = 800MB（当天误报 57 次）
       * V8 的「攒多少垃圾才做彻底 GC」是按 1796MB 校准的，但它永远活不到那个点——
       * pm2 在 1200MB 就把进程杀了。于是进程注定被反复重启，跟它实际需要多少内存无关。
       * 佐证：错误日志全空，一次 OOM 崩溃都没有（真不够用会是 heap out of memory）。
       *
       * 修复方式是让 V8 先动手、pm2 只当兜底网：
       *   node_args --max-old-space-size=768 → V8 在 768MB 老生代就做彻底 GC，
       *     预期 RSS 落在 950~1050MB（堆 + external/code 约 150~250MB）；
       *   max_memory_restart 1500M → 正常负载下永不触发，只有真泄漏才兜底重启。
       * 三个值必须保持 768 < 1500，且应用内告警阈值与 pm2 一致，不要再各写各的。
       *
       * ⚠️ 改完必须 `pm2 save`：本机 pm2 走 systemd pm2-root.service + `pm2 resurrect`，
       * 重启后读的是 /root/.pm2/dump.pm2 快照而不是本文件，不 save 下次就返祖
       * （2026-07-29 事故已经栽过一次）。
       */
      node_args: '--max-old-space-size=768',
      max_memory_restart: '1500M',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        /** 与 server/index.js 的 getAppEnv()/isSchemaChangeAllowed() 一致：
         *  production 时默认跳过 listen-time schema ensure/DDL，改用 node migrate.js */
        APP_ENV: 'production',
        /** 应用内内存压线告警的分母，必须与上面 max_memory_restart 一致，
         *  否则会像 2026-08-04 那样按 800MB 分母天天误报（当天 57 次）。 */
        PM2_MAX_MEMORY_RESTART_BYTES: String(1500 * 1024 * 1024)
      }
    }
  ]
};
