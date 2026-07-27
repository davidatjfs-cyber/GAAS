#!/usr/bin/env bash
# 安全部署 server 文件：打包 → 单次 scp → 远端解包/md5/bak → 依赖预检 → pm2 reload → 健康检查 → 失败回滚
# Usage:
#   ./scripts/deploy-server-files.sh server/agents.js server/domains/health/process-health-monitor.js
#   DRY_RUN=1 ./scripts/deploy-server-files.sh server/index.js
#   SKIP_DEPS_CHECK=1 ...  # 仅应急跳过依赖预检（默认不开）
#   SKIP_PROD_DIFF=1 ...   # 跳过逐文件拉生产 diff（大批量时默认仍做摘要行数对比）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-root@47.100.96.30}"
REMOTE="${REMOTE_DIR:-/opt/hrms}"
ARCHIVE="${REMOTE_ARCHIVE:-/opt/hrms-archive/deploy-bak}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_DEPS_CHECK="${SKIP_DEPS_CHECK:-0}"
SKIP_PROD_DIFF="${SKIP_PROD_DIFF:-0}"
SSH_OPTS=(-o ConnectTimeout=45 -o ServerAliveInterval=10 -o ServerAliveCountMax=6 -o ConnectionAttempts=3)
SSH=(ssh "${SSH_OPTS[@]}" "$HOST")
SCP=(scp "${SSH_OPTS[@]}" -o ConnectTimeout=120)

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <server-relative-or-absolute-file>..."
  exit 2
fi

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

scp_retry() {
  local src="$1" dest="$2"
  local n=0
  while (( n < 5 )); do
    n=$((n + 1))
    if "${SCP[@]}" "$src" "$dest"; then return 0; fi
    echo "scp retry $n/5: $src"
    sleep $((n * 2))
  done
  return 1
}

file_md5() {
  local f="$1"
  if [[ "$(uname)" == "Darwin" ]]; then
    md5 -q "$f"
  else
    md5sum "$f" | awk '{print $1}'
  fi
}

TS="$(date +%s)"
STAGE_REMOTE="/tmp/gaas-deploy-staged-$TS"
BAK_REMOTE="$ARCHIVE/server-$TS"
LOCAL_BUNDLE="$(mktemp -d /tmp/gaas-deploy-bundle.XXXXXX)"
trap 'rm -rf "$LOCAL_BUNDLE"' EXIT
MANIFEST="$LOCAL_BUNDLE/MANIFEST.md5"
TAR_LOCAL="$LOCAL_BUNDLE/payload.tar"
REMOTE_SCRIPT="$LOCAL_BUNDLE/remote-install.sh"
FILES=()
RELS=()

for arg in "$@"; do
  f="$arg"
  [[ "$f" != /* ]] && f="$ROOT/$f"
  f="$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"
  [[ -f "$f" ]] || { echo "missing: $f"; exit 2; }
  case "$f" in
    "$ROOT"/server/*) ;;
    *) echo "only server/* allowed: $f"; exit 2 ;;
  esac
  FILES+=("$f")
  RELS+=("${f#"$ROOT"/}")
done

echo "=== deploy-server-files host=$HOST dry_run=$DRY_RUN files=${#FILES[@]} ==="
echo "bak → $BAK_REMOTE"

# 1) 远端准备
ssh_retry "mkdir -p '$BAK_REMOTE' '$STAGE_REMOTE' '$REMOTE/server'"

# 2) 可选：轻量行数对比（不再逐文件 scp 拉全量 diff，避免慢链路超时）
if [[ "$SKIP_PROD_DIFF" != "1" ]]; then
  for i in "${!FILES[@]}"; do
    f="${FILES[$i]}"
    rel="${RELS[$i]}"
    local_lines="$(wc -l < "$f" | tr -d ' ')"
    echo "--- $rel (local $local_lines lines) ---"
    if ssh_retry "test -f '$REMOTE/$rel'"; then
      prod_lines="$(ssh_retry "wc -l < '$REMOTE/$rel' | tr -d ' '")"
      echo "  prod lines: $prod_lines"
      if [[ "$local_lines" != "$prod_lines" ]]; then
        echo "  DIFF line-count local=$local_lines prod=$prod_lines"
      else
        echo "  same line-count (content may still differ)"
      fi
    else
      echo "  NEW on prod (file absent)"
    fi
  done
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1：到此停止（未上传、未重启）"
  exit 0
fi

# 3) 本地打包 + manifest
: > "$MANIFEST"
(
  cd "$ROOT"
  tar -cf "$TAR_LOCAL" "${RELS[@]}"
)
for i in "${!FILES[@]}"; do
  f="${FILES[$i]}"
  rel="${RELS[$i]}"
  printf '%s  %s\n' "$(file_md5 "$f")" "$rel" >> "$MANIFEST"
done
BUNDLE_BYTES="$(wc -c < "$TAR_LOCAL" | tr -d ' ')"
echo "bundle bytes=$BUNDLE_BYTES files=${#FILES[@]}"

# 4) 远端安装脚本（解包、md5、bak、原子替换、语法检查）
cat > "$REMOTE_SCRIPT" <<'EOS'
set -euo pipefail
HOST_ROOT="${HOST_ROOT:?}"
ARCHIVE="${ARCHIVE:?}"
STAGE="${STAGE:?}"
cd "$STAGE"
tar -xf payload.tar
while read -r hash rel; do
  [ -z "${rel:-}" ] && continue
  src="$STAGE/$rel"
  dest="$HOST_ROOT/$rel"
  [ -f "$src" ] || { echo "missing staged $rel"; exit 1; }
  mkdir -p "$(dirname "$dest")" "$(dirname "$ARCHIVE/$rel")"
  if [ -f "$dest" ]; then
    cp -a "$dest" "$ARCHIVE/$rel"
  fi
  remote_md5="$(md5sum "$src" | awk '{print $1}')"
  if [ "$remote_md5" != "$hash" ]; then
    echo "MD5 mismatch $rel expected=$hash got=$remote_md5"
    exit 1
  fi
  mv "$src" "$dest"
  echo "OK $rel"
done < MANIFEST.md5
# syntax check installed js
while read -r _hash rel; do
  [ -z "${rel:-}" ] && continue
  case "$rel" in
    *.js|*.mjs) node --check "$HOST_ROOT/$rel" ;;
  esac
done < MANIFEST.md5
echo REMOTE_INSTALL_OK
EOS

# 5) 单次上传 bundle（tar + manifest + remote script）
scp_retry "$TAR_LOCAL" "$HOST:$STAGE_REMOTE/payload.tar"
scp_retry "$MANIFEST" "$HOST:$STAGE_REMOTE/MANIFEST.md5"
scp_retry "$REMOTE_SCRIPT" "$HOST:$STAGE_REMOTE/remote-install.sh"
ssh_retry "HOST_ROOT='$REMOTE' ARCHIVE='$BAK_REMOTE' STAGE='$STAGE_REMOTE' bash '$STAGE_REMOTE/remote-install.sh'"

# 6) 依赖预检
if [[ "$SKIP_DEPS_CHECK" != "1" ]]; then
  echo "=== prod deps preflight (VERIFY_ONLY) ==="
  VERIFY_ONLY=1 bash "$ROOT/scripts/install-prod-deps.sh"
fi

# 7) reload + health
echo "=== pm2 reload hrms-service ==="
ssh_retry 'pm2 reload hrms-service || pm2 restart hrms-service'
sleep 5
ROOT_CODE="$(ssh_retry "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")"
HEALTH_CODE="$(ssh_retry "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health")"
echo "ROOT=$ROOT_CODE HEALTH=$HEALTH_CODE"
if [[ "$ROOT_CODE" != "200" || "$HEALTH_CODE" != "200" ]]; then
  echo "健康检查失败 → 自动回滚 bak=$BAK_REMOTE"
  ssh_retry 'pm2 logs hrms-service --err --lines 20 --nostream' || true
  # 回滚：从保留相对路径的 bak 树还原
  for rel in "${RELS[@]}"; do
    if ssh_retry "test -f '$BAK_REMOTE/$rel'"; then
      echo "  rollback $rel"
      ssh_retry "mkdir -p '$(dirname "$REMOTE/$rel")' && cp -a '$BAK_REMOTE/$rel' '$REMOTE/$rel'"
    else
      echo "  no bak for $rel (was NEW) — leave in place"
    fi
  done
  ssh_retry 'pm2 reload hrms-service || pm2 restart hrms-service'
  sleep 5
  ROOT_CODE2="$(ssh_retry "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")"
  HEALTH_CODE2="$(ssh_retry "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health")"
  echo "after rollback ROOT=$ROOT_CODE2 HEALTH=$HEALTH_CODE2"
  exit 1
fi
echo "✅ deploy-server-files OK bak=$BAK_REMOTE bundle_bytes=$BUNDLE_BYTES"
