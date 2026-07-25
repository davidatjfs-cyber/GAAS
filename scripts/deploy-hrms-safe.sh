#!/usr/bin/env bash
# GAAS 安全部署入口：本地结构校验 + 前端 dist/prod 对比口径说明 + 指向专用脚本。
# 实际上传：
#   前端：./scripts/deploy-frontend.sh
#   后端：./scripts/deploy-server-files.sh server/foo.js ...
set -euo pipefail
HRMS_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ">>> deploy-hrms-safe: 本地结构校验（移动端导航 / 主入口）"
rg -n 'mobile-nav-label">首页<' "${HRMS_DIR}/working-fixed.html" >/dev/null
rg -n 'mobile-nav-label">增长<' "${HRMS_DIR}/working-fixed.html" >/dev/null
rg -n 'mobile-nav-label">知识库<' "${HRMS_DIR}/working-fixed.html" >/dev/null
rg -n 'mobile-nav-label">考试<' "${HRMS_DIR}/working-fixed.html" >/dev/null
rg -n 'mobile-nav-label">更多<' "${HRMS_DIR}/working-fixed.html" >/dev/null
test -f "${HRMS_DIR}/working-fixed.html"
test ! -f "${HRMS_DIR}/mobile-nav-production.html"

echo ">>> deploy-hrms-safe: build:shell + 与生产对比（dist 口径，不是 monolith md5）"
cd "${HRMS_DIR}"
npm run build:shell
set +e
node scripts/compare-prod-frontend.mjs
FE_RC=$?
set -e

echo ""
echo ">>> 生产依赖预检（防 node_modules 被 prune）"
set +e
VERIFY_ONLY=1 bash "${HRMS_DIR}/scripts/install-prod-deps.sh"
DEPS_RC=$?
set -e
if [[ "$DEPS_RC" -ne 0 ]]; then
  echo ">>> 依赖预检失败 ⚠️ 先修 /opt/hrms/node_modules，或运行: npm run deploy:prod-deps"
fi

echo ""
echo ">>> 下一步（按需）："
echo "  前端漂移时: ./scripts/deploy-frontend.sh"
echo "  后端文件:   ./scripts/deploy-server-files.sh server/<file.js> [...]"
echo "  仅预览后端: DRY_RUN=1 ./scripts/deploy-server-files.sh server/<file.js>"
echo "  生产依赖:   npm run deploy:prod-deps:verify  |  npm run deploy:prod-deps"
echo "  bak 归档目录永远用 /opt/hrms-archive/deploy-bak/（禁止写在 /opt/hrms 下）"
echo "  进程重启优先 pm2 reload；deploy-server-files.sh 已默认 reload"
echo "  禁止: ssh 上对 /opt/hrms 执行 npm install <单包> --no-save（会 prune）"

if [[ "$FE_RC" -eq 0 ]]; then
  echo ">>> 前端：本地 dist 与生产一致 ✅"
  exit 0
fi
echo ">>> 前端：本地 dist 与生产不一致 ⚠️ 请运行 ./scripts/deploy-frontend.sh"
exit 1
