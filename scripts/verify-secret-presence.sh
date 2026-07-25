#!/usr/bin/env bash
# 只读：对比 HRMS / agents 生产 .env 中关键密钥是否存在、长度、是否相同。
# 绝不打印密钥值。
set -euo pipefail

HOST="${DEPLOY_HOST:-root@47.100.96.30}"
SSH=(ssh -o ConnectTimeout=45 -o ServerAliveInterval=5 -o ConnectionAttempts=3 "$HOST")

"${SSH[@]}" "python3 - <<'PY'
from pathlib import Path

def load_env(path):
    d = {}
    p = Path(path)
    if not p.exists():
        return d
    for line in p.read_text(errors='replace').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        k = k.strip()
        v = v.strip().strip('\"\\'')
        d[k] = v
    return d

h = load_env('/opt/hrms/server/.env')
a = load_env('/opt/agents-service-v2/.env')
keys = [
    'JWT_SECRET', 'PLATFORM_ADMIN_JWT_SECRET', 'PLATFORM_ADMIN_SECRET',
    'MINIPROGRAM_SYNC_SECRET', 'TENANT_INTEGRATION_ENCRYPTION_KEY',
    'AGENTS_ADMIN_PASSWORD', 'ADMIN_PASSWORD', 'DATABASE_URL',
    'FEISHU_APP_SECRET', 'LARK_APP_SECRET', 'DEEPSEEK_API_KEY', 'QWEN_API_KEY',
    'ARK_API_KEY', 'DOUBAO_API_KEY', 'ALIYUN_SMS_ACCESS_KEY_SECRET',
    'WECOM_KF_SECRET', 'WECOM_KF_AES_KEY', 'DASHSCOPE_TTS_API_KEY',
    'AGENTS_INTERNAL_SECRET', 'FEISHU_ENCRYPT_KEY', 'FEISHU_VERIFICATION_TOKEN',
]
print('KEY                                HRMS_LEN AGENTS_LEN SAME')
drift = []
missing_critical = []
critical_hrms = {
    'JWT_SECRET', 'PLATFORM_ADMIN_JWT_SECRET', 'MINIPROGRAM_SYNC_SECRET',
    'DATABASE_URL', 'PLATFORM_ADMIN_SECRET',
}
for k in keys:
    hv = h.get(k, '')
    av = a.get(k, '')
    hl = len(hv) if hv else 0
    al = len(av) if av else 0
    if not hv or not av:
        same = '-'
    else:
        same = 'YES' if hv == av else 'NO'
        if same == 'NO':
            drift.append(k)
    if k in critical_hrms and hl == 0:
        missing_critical.append(k)
    print(f'{k:34} {hl:8} {al:10} {same}')

se = Path('/etc/hrms.env')
print('systemd_hrms.env_exists', se.exists())
if se.exists():
    s = load_env(str(se))
    print('systemd_JWT_len', len(s.get('JWT_SECRET', '')))
    print('server_JWT_len', len(h.get('JWT_SECRET', '')))
    print('systemd_vs_server_JWT_same', s.get('JWT_SECRET', '') == h.get('JWT_SECRET', ''))
    if s.get('JWT_SECRET', '') != h.get('JWT_SECRET', ''):
        print('NOTE: /etc/hrms.env 与权威 /opt/hrms/server/.env 不一致（systemd 未在跑，勿当权威）')

if drift:
    print('DRIFT:', ', '.join(drift))
if missing_critical:
    print('MISSING_CRITICAL_HRMS:', ', '.join(missing_critical))
    raise SystemExit(1)
print('OK presence check')
PY"
