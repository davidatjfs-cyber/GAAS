#!/bin/bash
# 前端部署脚本：强制顺序 = 先传JS/CSS资产，再传shell HTML
# 防止 shell 先上线、JS 还未到位 → Safari immutable 缓存 404 的问题
set -e

SERVER="root@47.100.96.30"
REMOTE_DIR="/opt/hrms"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."

echo "=== 1. 构建 ==="
cd "$ROOT"
node scripts/build-shell.mjs

JS_FILE=$(ls dist/app.*.js | head -1)
CSS_FILE=$(ls dist/app.*.css | head -1)
SHELL_FILE="dist/working-fixed.html"

JS_HASH=$(basename "$JS_FILE")
echo "JS: $JS_HASH"

echo "=== 2. 检查服务器是否已有此 JS ==="
EXISTS=$(ssh "$SERVER" "test -f $REMOTE_DIR/$JS_HASH && echo yes || echo no")
if [ "$EXISTS" = "yes" ]; then
  echo "JS 已存在，跳过上传"
else
  echo "=== 3. 先传 JS/CSS 资产 ==="
  scp "$JS_FILE" "$SERVER:$REMOTE_DIR/"
  scp "$CSS_FILE" "$SERVER:$REMOTE_DIR/"
  echo "资产上传完成"
fi

echo "=== 4. 再传 shell HTML ==="
scp "$SHELL_FILE" "$SERVER:$REMOTE_DIR/working-fixed.html"

echo "=== 5. 验证 ==="
HTTP=$(ssh "$SERVER" "curl -s -o /dev/null -w '%{http_code}' https://127.0.0.1/$JS_HASH -H 'Host: nnyx.cc'")
if [ "$HTTP" = "200" ]; then
  echo "✅ 部署成功：$JS_HASH 返回 $HTTP"
else
  echo "❌ 部署异常：$JS_HASH 返回 $HTTP"
  exit 1
fi
