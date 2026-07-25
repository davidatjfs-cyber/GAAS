#!/usr/bin/env bash
# 安全安装/对齐生产 /opt/hrms 的 npm 依赖。
#
# 血泪教训（2026-07-25）：在无完整 package.json 的 /opt/hrms 上执行
#   npm install pino --no-save
# 会把已有 node_modules prune 掉（实测删 ~436 包），进程若仍在内存中暂可服务，
# 一旦 pm2 reload 即全面崩盘。
#
# 正确做法：只用本脚本（或等价：同步 deploy/prod-package.json 后再 npm install）。
#
# Usage:
#   ./scripts/install-prod-deps.sh              # 同步 package.json + npm install + 校验
#   VERIFY_ONLY=1 ./scripts/install-prod-deps.sh  # 只检查关键包与 @gaas 软链
#   DRY_RUN=1 ./scripts/install-prod-deps.sh      # 只上传 package.json 预览，不 install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-root@47.100.96.30}"
REMOTE="${REMOTE_DIR:-/opt/hrms}"
PKG_SRC="${ROOT}/deploy/prod-package.json"
VERIFY_ONLY="${VERIFY_ONLY:-0}"
DRY_RUN="${DRY_RUN:-0}"
SSH=(ssh -o ConnectTimeout=45 -o ServerAliveInterval=5 -o ConnectionAttempts=3 "$HOST")
SCP=(scp -o ConnectTimeout=60 -o ServerAliveInterval=5)

CRITICAL=(express pg jsonwebtoken dotenv cors compression multer bcryptjs axios ws pdfkit xlsx ali-oss cos-nodejs-sdk-v5 archiver pino)

[[ -f "$PKG_SRC" ]] || { echo "missing $PKG_SRC"; exit 2; }

ssh_retry() {
  local n=0
  while (( n < 5 )); do
    n=$((n + 1))
    if "${SSH[@]}" "$@"; then return 0; fi
    echo "ssh retry $n/5..."
    sleep $((n * 2))
  done
  return 1
}

verify_remote_deps() {
  # REMOTE 在本地展开；\$m 在远端 for 循环里展开（勿对含 \$m 的路径用单引号）
  ssh_retry "set -e
    miss=0
    for m in ${CRITICAL[*]}; do
      if [ ! -e ${REMOTE}/node_modules/\$m ] && [ ! -e ${REMOTE}/server/node_modules/\$m ]; then
        echo \"MISSING \$m\"
        miss=1
      fi
    done
    if [ ! -e ${REMOTE}/server/node_modules/@gaas/shared/package.json ]; then
      echo 'MISSING @gaas/shared symlink target'
      miss=1
    fi
    if [ ! -f ${REMOTE}/package.json ]; then
      echo 'MISSING ${REMOTE}/package.json（禁止裸 npm install）'
      miss=1
    fi
    count=\$(ls ${REMOTE}/node_modules 2>/dev/null | wc -l | tr -d ' ')
    echo \"node_modules_entries=\$count\"
    if [ \"\$count\" -lt 50 ]; then
      echo \"SUSPICIOUS: node_modules 条目过少 (\$count)，可能被 prune\"
      miss=1
    fi
    exit \$miss
  "
}

echo "=== install-prod-deps host=$HOST verify_only=$VERIFY_ONLY dry_run=$DRY_RUN ==="

if [[ "$VERIFY_ONLY" == "1" ]]; then
  verify_remote_deps
  echo "✅ prod deps verify OK"
  exit 0
fi

TS="$(date +%s)"
STAGE="/tmp/gaas-prod-package-$TS.json"
ssh_retry "mkdir -p '$REMOTE' '$REMOTE/packages' '$REMOTE/server/node_modules/@gaas' /opt/hrms-archive/deploy-bak"
"${SCP[@]}" "$PKG_SRC" "$HOST:$STAGE"

if [[ "$(uname)" == "Darwin" ]]; then
  local_md5="$(md5 -q "$PKG_SRC")"
else
  local_md5="$(md5sum "$PKG_SRC" | awk '{print $1}')"
fi
remote_md5="$(ssh_retry "md5sum '$STAGE' | awk '{print \$1}'")"
[[ "$local_md5" == "$remote_md5" ]] || { echo "MD5 mismatch package.json"; exit 1; }

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1：已上传 staged package.json md5=$local_md5，未 install"
  exit 0
fi

ssh_retry "set -e
  if [ -f '$REMOTE/package.json' ]; then
    cp -a '$REMOTE/package.json' /opt/hrms-archive/deploy-bak/package.json.bak.$TS
  fi
  mv '$STAGE' '$REMOTE/package.json'
  echo '=== npm install --omit=dev (prefix=$REMOTE) ==='
  cd '$REMOTE'
  # 禁止用 --no-save / 单包安装；必须以 package.json 为权威
  npm install --omit=dev
  mkdir -p '$REMOTE/server/node_modules/@gaas'
  if [ -d '$REMOTE/packages/gaas-shared' ]; then
    ln -sfn '$REMOTE/packages/gaas-shared' '$REMOTE/server/node_modules/@gaas/shared'
  else
    echo 'WARN: $REMOTE/packages/gaas-shared 不存在，请先同步 packages/gaas-shared'
    exit 1
  fi
"

verify_remote_deps
echo "✅ install-prod-deps OK"
echo "提示：改依赖后若需加载新模块，再 pm2 reload hrms-service（本脚本默认不重启进程）"
