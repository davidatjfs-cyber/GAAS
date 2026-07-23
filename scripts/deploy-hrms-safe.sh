#!/usr/bin/env bash
# 标准安全部署入口（GAAS → 阿里云 ECS）
# 注意：原 monorepo 根 scripts/deploy-hrms-*.sh 已随拆仓退役；
# 本脚本仅做本地结构校验。实际部署请按 CLAUDE.md：build-shell → scp hash 资源 → 换 shell → pm2。
set -euo pipefail
HRMS_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ">>> deploy-hrms-safe: 本地结构校验（移动端导航 / 主入口）"
# 真源入口是 working-fixed.html（mobile-nav-production.html 已于 B6 退役）
rg -n 'mobile-nav-label">首页<' "${HRMS_DIR}/working-fixed.html" >/dev/null
rg -n 'mobile-nav-label">增长<' "${HRMS_DIR}/working-fixed.html" >/dev/null
rg -n 'mobile-nav-label">知识库<' "${HRMS_DIR}/working-fixed.html" >/dev/null
rg -n 'mobile-nav-label">考试<' "${HRMS_DIR}/working-fixed.html" >/dev/null
rg -n 'mobile-nav-label">更多<' "${HRMS_DIR}/working-fixed.html" >/dev/null
test -f "${HRMS_DIR}/working-fixed.html"
test ! -f "${HRMS_DIR}/mobile-nav-production.html"

echo ">>> deploy-hrms-safe: 校验通过。请按 CLAUDE.md 手动 scp + pm2 部署（本脚本不再 rsync monorepo 根脚本）。"
