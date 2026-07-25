#!/usr/bin/env bash
# 只读：检查 main 分支保护 / rulesets 是否可用；Free 私有仓预期 403。
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-davidatjfs-cyber/GAAS}"

echo "==> repo=$REPO"

http_code() {
  local path="$1"
  local code
  code="$(gh api -i "$path" 2>/dev/null | awk 'NR==1 {print $2; exit}')" || true
  echo "${code:-000}"
}

prot_code="$(http_code "repos/$REPO/branches/main/protection")"
rules_code="$(http_code "repos/$REPO/rulesets")"

echo "branch_protection HTTP $prot_code"
echo "rulesets HTTP $rules_code"

if [[ "$prot_code" == "200" || "$rules_code" == "200" ]]; then
  echo "OK: hard protection/rulesets available"
  gh api "repos/$REPO/rulesets" --jq '.[].name' 2>/dev/null || true
  exit 0
fi

if [[ "$prot_code" == "403" || "$rules_code" == "403" || "$prot_code" == "404" ]]; then
  echo "SOFT: private Free 无法启用 hard rulesets（需 Pro/Team）。见 docs/branch-protection.md"
  echo "--- recent main CI runs ---"
  gh run list --repo "$REPO" --branch main --limit 5 \
    --json conclusion,status,name,displayTitle,createdAt \
    --jq '.[] | "\(.createdAt) \(.conclusion // .status) \(.name) | \(.displayTitle)"' || true
  exit 0
fi

echo "WARN: unexpected API status prot=$prot_code rules=$rules_code"
exit 1
