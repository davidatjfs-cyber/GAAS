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
 * /opt/hrms/server/.env，由 index.js 自己 dotenv.config() 加载，不进 git。
 * 本文件只放不敏感的运维/启动参数。
 */
module.exports = {
  apps: [
    {
      name: 'hrms-service',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      /** 实测生产值：2026-07-28 pm2 describe hrms-service 得到 800MB (838860800 字节) */
      max_memory_restart: '800M',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        /** 与 server/index.js 的 getAppEnv()/isSchemaChangeAllowed() 一致：
         *  production 时默认跳过 listen-time schema ensure/DDL，改用 node migrate.js */
        APP_ENV: 'production'
      }
    }
  ]
};
