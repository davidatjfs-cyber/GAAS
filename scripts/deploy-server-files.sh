#!/usr/bin/env bash
# 安全部署 server 文件：拉生产对比 → 归档 bak → staged scp → md5 → 依赖预检 → pm2 reload → 健康检查
# Usage:
#   ./scripts/deploy-server-files.sh server/agents.js server/domains/health/process-health-monitor.js
#   DRY_RUN=1 ./scripts/deploy-server-files.sh server/index.js
#   SKIP_DEPS_CHECK=1 ...  # 仅应急跳过依赖预检（默认不开）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-root@47.100.96.30}"
REMOTE="${REMOTE_DIR:-/opt/hrms}"
ARCHIVE="${REMOTE_ARCHIVE:-/opt/hrms-archive/deploy-bak}"
DRY_RUN="${DRY_RUN:-0}"
SKIP_DEPS_CHECK="${SKIP_DEPS_CHECK:-0}"
SSH_OPTS=(-o ConnectTimeout=45 -o ServerAliveInterval=5 -o ConnectionAttempts=3)
SSH=(ssh "${SSH_OPTS[@]}" "$HOST")
SCP=(scp "${SSH_OPTS[@]}" -o ConnectTimeout=60)

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

TS="$(date +%s)"
STAGE_REMOTE="/tmp/gaas-deploy-staged-$TS"
BAK_REMOTE="$ARCHIVE/server-$TS"
FILES=()

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
done

echo "=== deploy-server-files host=$HOST dry_run=$DRY_RUN ==="
echo "bak → $BAK_REMOTE"

# 1) 远端准备 + 拉生产对比摘要
ssh_retry "mkdir -p '$BAK_REMOTE' '$STAGE_REMOTE' '$REMOTE/server'"

DIFF_DIR="$(mktemp -d /tmp/gaas-prod-diff.XXXXXX)"
trap 'rm -rf "$DIFF_DIR"' EXIT

for f in "${FILES[@]}"; do
  rel="${f#"$ROOT"/}"
  remote_path="$REMOTE/$rel"
  local_lines="$(wc -l < "$f" | tr -d ' ')"
  echo "--- $rel (local $local_lines lines) ---"
  if ssh_retry "test -f '$remote_path'"; then
    scp_retry "$HOST:$remote_path" "$DIFF_DIR/$(basename "$f").prod"
    prod_lines="$(wc -l < "$DIFF_DIR/$(basename "$f").prod" | tr -d ' ')"
    echo "  prod lines: $prod_lines"
    if ! diff -q "$f" "$DIFF_DIR/$(basename "$f").prod" >/dev/null; then
      echo "  DIFF vs prod (unified, first 40 lines):"
      diff -u "$DIFF_DIR/$(basename "$f").prod" "$f" | head -40 || true
    else
      echo "  identical to prod"
    fi
  else
    echo "  NEW on prod (file absent)"
  fi
done

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1：到此停止（未上传、未重启）"
  exit 0
fi

# 2) bak + staged upload
for f in "${FILES[@]}"; do
  rel="${f#"$ROOT"/}"
  remote_path="$REMOTE/$rel"
  remote_dir="$(dirname "$remote_path")"
  ssh_retry "mkdir -p '$remote_dir' && if [ -f '$remote_path' ]; then cp -a '$remote_path' '$BAK_REMOTE/'; fi"
  base="$(basename "$f")"
  scp_retry "$f" "$HOST:$STAGE_REMOTE/$base"
done

# 3) md5 对账后原子 mv
for f in "${FILES[@]}"; do
  rel="${f#"$ROOT"/}"
  base="$(basename "$f")"
  remote_path="$REMOTE/$rel"
  if [[ "$(uname)" == "Darwin" ]]; then
    local_md5="$(md5 -q "$f")"
  else
    local_md5="$(md5sum "$f" | awk '{print $1}')"
  fi
  remote_md5="$(ssh_retry "md5sum '$STAGE_REMOTE/$base' | awk '{print \$1}'")"
  if [[ "$local_md5" != "$remote_md5" ]]; then
    echo "MD5 mismatch staged $rel local=$local_md5 remote=$remote_md5"
    exit 1
  fi
  ssh_retry "mkdir -p '$(dirname "$remote_path")' && mv '$STAGE_REMOTE/$base' '$remote_path' && md5sum '$remote_path'"
  echo "  installed $rel md5=$local_md5"
done

# 4) syntax check key js
CHECK_LIST=()
for f in "${FILES[@]}"; do
  case "$f" in
    *.js|*.mjs) CHECK_LIST+=("$REMOTE/${f#"$ROOT"/}") ;;
  esac
done
if [[ ${#CHECK_LIST[@]} -gt 0 ]]; then
  ssh_retry "for p in ${CHECK_LIST[*]}; do node --check \"\$p\"; done"
fi

# 5) 依赖预检（防 reload 时才发现 node_modules 被 prune）
if [[ "$SKIP_DEPS_CHECK" != "1" ]]; then
  echo "=== prod deps preflight (VERIFY_ONLY) ==="
  VERIFY_ONLY=1 bash "$ROOT/scripts/install-prod-deps.sh"
fi

echo "=== pm2 reload hrms-service ==="
ssh_retry 'pm2 reload hrms-service || pm2 restart hrms-service'
sleep 5
ROOT_CODE="$(ssh_retry "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")"
HEALTH_CODE="$(ssh_retry "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health")"
echo "ROOT=$ROOT_CODE HEALTH=$HEALTH_CODE"
if [[ "$ROOT_CODE" != "200" || "$HEALTH_CODE" != "200" ]]; then
  echo "健康检查失败。bak=$BAK_REMOTE"
  ssh_retry 'pm2 logs hrms-service --err --lines 20 --nostream' || true
  exit 1
fi
echo "✅ deploy-server-files OK bak=$BAK_REMOTE"
