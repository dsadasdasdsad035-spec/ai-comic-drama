#!/usr/bin/env bash
# 远端 .env 合并：从 stdin 逐行读 KEY=VALUE，upsert 到目标 .env，
# 未提供的键保持原值（避免把 APIMART 等渠道 Key 覆盖成空）。
#
#   printf '%s\n' "$BLOCK" | bash merge-env.sh /opt/storyboard/.env
set -euo pipefail

ENV="${1:?用法: merge-env.sh <env 文件路径>}"
mkdir -p "$(dirname "$ENV")"
touch "$ENV"
chmod 600 "$ENV"

# GNU sed 与 BSD(macOS) sed 的 -i 参数不同，这里统一一下，方便本地自测
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(sed -i)
else
  SED_INPLACE=(sed -i '')
fi

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  k="${line%%=*}"
  v="${line#*=}"
  [[ -z "$k" ]] && continue
  if grep -q "^${k}=" "$ENV" 2>/dev/null; then
    # 替换串里的 \ & | 需要转义，否则 sed 会当成特殊字符或分隔符
    esc="${v//\\/\\\\}"
    esc="${esc//&/\\&}"
    esc="${esc//|/\\|}"
    "${SED_INPLACE[@]}" "s|^${k}=.*|${k}=${esc}|" "$ENV"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV"
  fi
done
