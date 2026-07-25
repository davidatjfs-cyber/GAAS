#!/usr/bin/env bash
# Wave A：从服务器暂存文件套用新密钥到权威 .env，然后 pm2 reload。
# 暂存文件不得进 git；用完删除。绝不 cat/打印密钥值。
set -euo pipefail

HOST="${DEPLOY_HOST:-root@47.100.96.30}"
STAGE="${WAVE_A_STAGE:-/opt/hrms-archive/deploy-bak/wave-a-secrets.env}"
HRMS_ENV=/opt/hrms/server/.env
AGENTS_ENV=/opt/agents-service-v2/.env

SSH=(ssh -o ConnectTimeout=45 -o ServerAliveInterval=5 -o ConnectionAttempts=3 "$HOST")

echo "==> Wave A apply from $STAGE on $HOST"
"${SSH[@]}" "test -f '$STAGE'" || {
  echo "暂存文件不存在: $STAGE"
  echo "请先在服务器写入该文件（见 docs / 对话说明），再重跑本脚本。"
  exit 2
}

"${SSH[@]}" bash -s -- "$STAGE" "$HRMS_ENV" "$AGENTS_ENV" <<'REMOTE'
set -euo pipefail
STAGE="$1"
HRMS_ENV="$2"
AGENTS_ENV="$3"

python3 - "$STAGE" "$HRMS_ENV" "$AGENTS_ENV" <<'PY'
import re, sys, time
from pathlib import Path

stage_path, hrms_path, agents_path = map(Path, sys.argv[1:4])

def load_env(path: Path):
    d = {}
    order = []
    raw = path.read_text(errors="replace") if path.exists() else ""
    for line in raw.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip()
        v = v.strip().strip("\"'")
        if k not in d:
            order.append(k)
        d[k] = v
    return d, order, raw

def load_stage(path: Path):
    d = {}
    for line in path.read_text(errors="replace").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip()
        v = v.strip().strip("\"'")
        if not v or v.startswith("<") or "PASTE" in v.upper() or "REPLACE" in v.upper():
            continue
        d[k] = v
    return d

# HRMS + agents 都可能需要的 LLM；短信/企微/TTS 主要在 HRMS
HRMS_KEYS = {
    "DEEPSEEK_API_KEY", "QWEN_API_KEY", "ARK_API_KEY", "DOUBAO_API_KEY", "OPENAI_API_KEY",
    "ALIYUN_SMS_ACCESS_KEY_ID", "ALIYUN_SMS_ACCESS_KEY_SECRET",
    "WECOM_KF_SECRET", "WECOM_KF_TOKEN", "WECOM_KF_AES_KEY",
    "DASHSCOPE_TTS_API_KEY",
}
AGENTS_KEYS = {
    "DEEPSEEK_API_KEY", "QWEN_API_KEY", "ARK_API_KEY", "DOUBAO_API_KEY", "OPENAI_API_KEY",
}

staged = load_stage(stage_path)
if not staged:
    print("FAIL: stage file has no usable KEY=value lines", file=sys.stderr)
    sys.exit(2)

def apply(path: Path, allow: set):
    d, order, raw = load_env(path)
    changed = []
    for k, v in staged.items():
        if k not in allow:
            continue
        if d.get(k) == v:
            continue
        d[k] = v
        if k not in order:
            order.append(k)
        changed.append(k)
    if not changed:
        print(f"OK {path}: no changes")
        return changed
    # 原地改写：保留原注释/未知行，仅替换已知 KEY 行；新 KEY 追加末尾
    lines_out = []
    seen = set()
    for line in raw.splitlines():
        s = line.strip()
        if s and not s.startswith("#") and "=" in s:
            k = s.split("=", 1)[0].strip()
            if k in d and k in allow and k in staged:
                lines_out.append(f"{k}={d[k]}")
                seen.add(k)
                continue
        lines_out.append(line)
    for k in order:
        if k in allow and k in staged and k not in seen:
            lines_out.append(f"{k}={d[k]}")
            seen.add(k)
    bak = path.with_name(path.name + f".wavea-preapply.{int(time.time())}")
    # 备份也放到 archive，不留在 server 目录被 nginx 扫到的风险：写到同级再 mv？
    # 权威 .env 目录在 /opt/hrms/server — 禁止留下 .bak；写到 archive
    archive = Path("/opt/hrms-archive/deploy-bak") / f"{path.name}.wavea-preapply.{int(time.time())}"
    archive.write_text(raw)
    path.write_text("\n".join(lines_out) + ("\n" if lines_out else ""))
    print(f"OK {path}: updated {', '.join(changed)}; pre-apply copy {archive}")
    return changed

h_changed = apply(hrms_path, HRMS_KEYS)
a_changed = apply(agents_path, AGENTS_KEYS)
ignored = sorted(k for k in staged if k not in HRMS_KEYS and k not in AGENTS_KEYS)
if ignored:
    print("NOTE ignored keys (not in Wave A allowlist):", ", ".join(ignored))
if not h_changed and not a_changed:
    print("FAIL: nothing applied — check key names in stage file", file=sys.stderr)
    sys.exit(3)
print("APPLY_DONE")
PY

# 权限收紧
chmod 600 "$HRMS_ENV" "$AGENTS_ENV" || true
# 用完即删暂存（避免磁盘残留）
shred -u "$STAGE" 2>/dev/null || rm -f "$STAGE"
echo "stage removed"

pm2 reload hrms-service --update-env
pm2 reload agents-service-v2 --update-env || pm2 restart agents-service-v2 --update-env

sleep 2
H=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)
A=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/health || true)
echo "health hrms=$H agents=$A"
test "$H" = "200"
test "$A" = "200"
echo WAVE_A_RELOAD_OK
REMOTE

echo "==> presence re-check (no values)"
./scripts/verify-secret-presence.sh
echo "Wave A apply finished. 请到云控台吊销旧 Key，并做 AI/短信/企微/TTS 冒烟。"
