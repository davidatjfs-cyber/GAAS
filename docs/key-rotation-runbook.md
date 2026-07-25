# 密钥轮换 Runbook（1.4）

> **状态：盘点完成 · 未执行轮换**  
> 真源：`/opt/hrms/server/.env`（PM2 `hrms-service`）+ `/opt/agents-service-v2/.env`  
> **不要改** `/etc/hrms.env`（systemd 未在跑，且 `JWT_SECRET` 已与权威 `.env` 漂移）。  
> 本文件不包含任何密钥值。执行前须人工确认窗口与范围。

背景见 `CLAUDE.md`「2026-07-24 web root `.env` 泄露」：出现过的凭据一律视为已泄露。

## 0. 盘点快照（2026-07-25，只读）

| KEY | HRMS 长度 | AGENTS 长度 | 两边相同 |
|-----|-----------|-------------|---------|
| `JWT_SECRET` | 64 | 64 | **否（漂移）** |
| `PLATFORM_ADMIN_JWT_SECRET` | 96 | 96 | 是 |
| `PLATFORM_ADMIN_SECRET` | 64 | — | 仅 HRMS |
| `MINIPROGRAM_SYNC_SECRET` | 64 | 64 | 是 |
| `TENANT_INTEGRATION_ENCRYPTION_KEY` | 44 | 44 | 是 |
| `AGENTS_ADMIN_PASSWORD` / `ADMIN_PASSWORD` | 11 / — | — / 11 | 成对维护 |
| `DATABASE_URL` | 47 | 47 | 是 |
| `FEISHU_APP_SECRET` / `LARK_APP_SECRET` | 32 | 32 | 是 |
| `DEEPSEEK_API_KEY` | 35 | 35 | **否** |
| `QWEN_API_KEY` / `ARK_API_KEY` | 35 / 36 | 35 / 36 | 是 |
| `ALIYUN_SMS_*` / `WECOM_KF_*` | 有 | — | 仅 HRMS |
| `AGENTS_INTERNAL_SECRET` | — | — | **两边都未配**（回退 MINIPROGRAM/JWT） |
| `FEISHU_ENCRYPT_KEY` / `VERIFICATION_TOKEN` | 空 | 空 | 可能走租户 DB 配置 |

复检（不打印值）：

```bash
./scripts/verify-secret-presence.sh
```

## 1. 代码能力边界（影响窗口选择）

| 密钥 | 双密钥并行校验？ | 换钥副作用 |
|------|------------------|------------|
| `JWT_SECRET` | **无** | 全站登录失效，需重登 |
| `PLATFORM_ADMIN_JWT_SECRET` | **无** | 平台 admin 全失效 |
| `MINIPROGRAM_SYNC_SECRET` | **无** | 小程序/内部 HMAC 短暂失败，须三端同切 |
| LLM / 短信 AK | 云控台可多 key | 可先加新再废旧 |
| `TENANT_INTEGRATION_ENCRYPTION_KEY` | 无 | **必须先重加密** `tenant_integrations` 等密文 |

零踢会话轮换 JWT → 需先改代码支持 `JWT_SECRET_OLD`（本 runbook 未做）。

## 2. 建议波次（需你逐波授权）

### Wave A — 可热换、低踢会话（优先）

1. LLM：`DEEPSEEK_API_KEY` / `QWEN_API_KEY` / `ARK_API_KEY`（及 agents 侧 `DOUBAO_API_KEY`）  
   - 控台新建 → 写入两边 `.env` → `pm2 reload … --update-env` → 冒烟 → 吊销旧 key  
   - 顺手对齐已漂移的 `DEEPSEEK_API_KEY`
2. 短信：`ALIYUN_SMS_ACCESS_KEY_ID` / `SECRET`（阿里云先加新 AK）
3. 企微：`WECOM_KF_SECRET` / `TOKEN` / `AES_KEY`（及 CALLBACK 回退项）— 与企微后台同窗
4. TTS：`DASHSCOPE_TTS_API_KEY`

### Wave B — 双边同步、短中断

5. `FEISHU_APP_SECRET` / `LARK_APP_SECRET` + 相关 `BITABLE_*_APP_SECRET`  
6. `MINIPROGRAM_SYNC_SECRET`（**+ 小程序/TCB**）  
7. `AGENTS_ADMIN_PASSWORD`（HRMS）+ `ADMIN_PASSWORD`（agents）成对  
8. `PLATFORM_ADMIN_SECRET`（HRMS bootstrap）  
9. `PLATFORM_ADMIN_JWT_SECRET`（双边同值；平台管理员重登）

### Wave C — 踢全站会话 / 高风险

10. `JWT_SECRET`  
    - 先决定：与 agents **对齐**还是**保持隔离**（当前已漂移）  
    - 公告重登 → 更新权威 `.env` → reload → 全员重登  
11. `DATABASE_URL` / DB 密码（`ALTER ROLE` + 双边连接串）  
12. `TENANT_INTEGRATION_ENCRYPTION_KEY`（单独变更窗 + re-encrypt 脚本）

### Wave D — 硬化（建议新增，非轮换旧值）

13. 新增 `AGENTS_INTERNAL_SECRET`（两边），减少把 `MINIPROGRAM`/`JWT` 当内部万能钥  
14. 标注或删除陈旧 `/etc/hrms.env`，避免误用  
15. （可选）代码支持 `JWT_SECRET_OLD` 后再做零踢会话轮换

## 3. 单波执行清单（模板）

每波授权后按此执行（密钥值由人工生成，不进 git）：

1. 低峰窗口；涉及登录的提前公告  
2. 备份：  
   `cp /opt/hrms/server/.env /opt/hrms-archive/deploy-bak/hrms.env.bak.$(date +%s)`  
   `cp /opt/agents-service-v2/.env /opt/hrms-archive/deploy-bak/agents.env.bak.$(date +%s)`  
   （**禁止**备份留在 `/opt/hrms` web root）  
3. 云控台/开放平台操作（吊销或双 key）  
4. 编辑权威 `.env`（vim/专用流程），**勿**只改 `/etc/hrms.env`  
5. `pm2 reload hrms-service --update-env`  
   `pm2 reload agents-service-v2 --update-env`（若该波涉及）  
6. 验证：  
   - `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/` → 200  
   - `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3101/health` → 200  
   - `./scripts/verify-secret-presence.sh`  
   - 波次对应冒烟（登录 / 平台登录 / 短信 / LLM / 企微回调 / 小程序签名）  
7. 吊销旧云密钥；记录执行人与时间  

## 4. 明确不自动做的事

- 不在对话里生成/粘贴新密钥到聊天记录  
- 不在未授权时改生产 `.env`  
- 不把 `.env` 或备份 scp 到笔记本长期存放  

## 5. 授权话术（复制即用）

- `执行 Wave A` — LLM/短信/企微/TTS  
- `执行 Wave B` — 飞书/小程序/平台口令与 JWT  
- `执行 Wave C` — 全站 JWT / DB / 集成加密钥（会踢登录）  
- `执行 Wave A+B` — 合并窗口  

授权时请注明：是否与 agents **对齐 JWT_SECRET**（当前为否）。
