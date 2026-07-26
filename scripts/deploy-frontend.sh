#!/usr/bin/env bash
# 前端部署：build:shell → 先传 hashed 资产（md5）→ staged 换 shell → 健康/缓存头验证
# Usage:
#   ./scripts/deploy-frontend.sh
#   DRY_RUN=1 ./scripts/deploy-frontend.sh   # 只构建 + 与生产对比
set -euo pipefail

SERVER="${DEPLOY_HOST:-root@47.100.96.30}"
REMOTE_DIR="${REMOTE_DIR:-/opt/hrms}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DRY_RUN="${DRY_RUN:-0}"
SSH=(ssh -o ConnectTimeout=45 "$SERVER")
SCP=(scp -o ConnectTimeout=45)

cd "$ROOT"

echo "=== 1. build:shell ==="
node scripts/build-shell.mjs

JS_FILE="$(ls dist/app.*.js | head -1)"
CSS_FILE="$(ls dist/app.*.css | head -1)"
SHELL_FILE="dist/working-fixed.html"
JS_HASH="$(basename "$JS_FILE")"
CSS_HASH="$(basename "$CSS_FILE")"

local_md5() {
  if [[ "$(uname)" == "Darwin" ]]; then md5 -q "$1"; else md5sum "$1" | awk '{print $1}'; fi
}

echo "JS:  $JS_HASH"
echo "CSS: $CSS_HASH"

echo "=== 2. compare vs prod (dist 口径) ==="
set +e
node scripts/compare-prod-frontend.mjs
CMP_RC=$?
set -e
if [[ "$CMP_RC" -eq 0 ]]; then
  echo "生产已与本地 dist 一致，无需上传。"
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY_RUN=1：检测到漂移但未部署"
  exit 1
fi

remote_md5() {
  "${SSH[@]}" "md5sum '$REMOTE_DIR/$1' 2>/dev/null | awk '{print \$1}'" || true
}

install_asset() {
  local local_path="$1"
  local name
  name="$(basename "$local_path")"
  local want
  want="$(local_md5 "$local_path")"
  local have
  have="$(remote_md5 "$name")"
  if [[ "$have" == "$want" ]]; then
    echo "skip $name (md5 match)"
    return 0
  fi
  echo "upload $name"
  "${SCP[@]}" "$local_path" "$SERVER:$REMOTE_DIR/$name.staged"
  local got
  got="$("${SSH[@]}" "md5sum '$REMOTE_DIR/$name.staged' | awk '{print \$1}'")"
  [[ "$got" == "$want" ]] || { echo "md5 fail $name"; exit 1; }
  "${SSH[@]}" "mv '$REMOTE_DIR/$name.staged' '$REMOTE_DIR/$name'"
}

echo "=== 3. 先传 JS/CSS 资产 ==="
install_asset "$JS_FILE"
install_asset "$CSS_FILE"

echo "=== 4. staged 换 shell ==="
SHELL_MD5="$(local_md5 "$SHELL_FILE")"
"${SCP[@]}" "$SHELL_FILE" "$SERVER:$REMOTE_DIR/working-fixed.html.staged"
GOT="$("${SSH[@]}" "md5sum '$REMOTE_DIR/working-fixed.html.staged' | awk '{print \$1}'")"
[[ "$GOT" == "$SHELL_MD5" ]] || { echo "shell md5 fail"; exit 1; }
"${SSH[@]}" "mv '$REMOTE_DIR/working-fixed.html.staged' '$REMOTE_DIR/working-fixed.html'"

echo "=== 5. 验证 ==="
HTTP_ASSET="$("${SSH[@]}" "curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1/$JS_HASH -H 'Host: nnyx.cc' || curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/$JS_HASH")"
HTTP_ROOT="$("${SSH[@]}" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/")"
echo "asset=$HTTP_ASSET root=$HTTP_ROOT"
if [[ "$HTTP_ASSET" != "200" || "$HTTP_ROOT" != "200" ]]; then
  echo "❌ 部署验证失败"
  exit 1
fi
echo "✅ 前端部署成功：$JS_HASH / $CSS_HASH"

# === 6. 归档历史哈希资源（防止 web root 无限堆积）===
# 2026-07-27 清理前实测：web root 积压 157 个 app.*.js/css 共 318MB，从 6 月起从未清理。
# 策略：保留「当前 shell 引用的」+「最近 KEEP_RECENT 个」，其余 mv 到 web root 之外的归档目录。
# 只移动不删除；保留最近若干份是为了回滚，以及给仍持有旧 shell 的浏览器留缓冲。
KEEP_RECENT="${FRONTEND_ASSET_KEEP_RECENT:-3}"
echo "=== 6. 归档历史资源（保留当前引用 + 最近 ${KEEP_RECENT} 个）==="
"${SSH[@]}" "set -e
cd '$REMOTE_DIR'
ARCH=/opt/hrms-archive/frontend-assets-\$(date +%s)
INUSE=\$(grep -oE 'app\.[a-f0-9]+\.(js|css)' working-fixed.html 2>/dev/null | sort -u)
# 必须压成单行空格分隔：ls/grep 输出是换行分隔，直接用会让下面的 case 空格匹配失效，
# 从而把「正在使用的」文件也归档掉（干跑时实测踩到过，会导致站点白屏）。
KEEP=\$(printf '%s %s %s' \"\$INUSE\" \"\$(ls -t app.*.js 2>/dev/null | head -${KEEP_RECENT})\" \"\$(ls -t app.*.css 2>/dev/null | head -${KEEP_RECENT})\" | tr '\n' ' ' | tr -s ' ')
moved=0
for f in app.*.js app.*.css; do
  [ -e \"\$f\" ] || continue
  case \" \$KEEP \" in *\" \$f \"*) continue;; esac
  mkdir -p \$ARCH && mv \"\$f\" \$ARCH/ && moved=\$((moved+1))
done
if [ \$moved -gt 0 ]; then echo \"  已归档 \$moved 个历史资源 → \$ARCH\"; else echo '  无需归档'; fi
echo \"  web root 现存: \$(ls app.*.js app.*.css 2>/dev/null | wc -l) 个\"
"
