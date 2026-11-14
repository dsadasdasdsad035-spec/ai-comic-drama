#!/usr/bin/env bash
# 远端公网部署：读取 deploy/.deploy.conf，rsync 到服务器并 docker compose 重建。
#
#   ./scripts/deploy-remote.sh              # 同步 + 重建 app/proxy
#   ./scripts/deploy-remote.sh --no-build   # 只同步配置，不重建镜像
#   ./scripts/deploy-remote.sh --patch-wildai  # 仅给 WildAI 主站 nginx 打计费回调路由
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="$ROOT/deploy/.deploy.conf"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/storyboard}"
WILDAI_DIR="${DEPLOY_WILDAI_DIR:-/opt/wildai}"
MARKER='# storyboard-billing-notify (deploy-remote)'
BUILD=1
PATCH_WILDAI=0

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --patch-wildai) PATCH_WILDAI=1 ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *) echo "未知参数：$arg" >&2; exit 1 ;;
  esac
done

log() { printf '\033[36m[deploy-remote]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[deploy-remote]\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f "$CONF" ]] || die "缺少 $CONF"
# shellcheck disable=SC1090
set -a && source "$CONF" && set +a
[[ -n "${DEPLOY_SERVER:-}" ]] || die "DEPLOY_SERVER 未设置"
[[ -n "${SSHPASS:-}" ]] || die "SSHPASS 未设置（ssh 口令）"

export SSHPASS
# 复用一条 SSH 连接，避免频繁密码登录被服务器限流（Permission denied 误判）
SSH_CTL="/tmp/sb-deploy-%r@%h:%p"
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o "ControlPath=$SSH_CTL" -o ControlPersist=600 "$DEPLOY_SERVER")
RSYNC=(sshpass -e rsync -az --delete -e "ssh -o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o ControlPath=$SSH_CTL -o ControlPersist=600")

ssh_remote() { "${SSH[@]}" "$@"; }

patch_wildai_nginx() {
  log "检查 WildAI 主站 nginx 是否已有分镜计费回调路由"
  if ssh_remote "grep -q '${MARKER}' '$WILDAI_DIR/nginx.app-locations.conf' 2>/dev/null"; then
    log "已存在，跳过"
    return 0
  fi
  log "写入 snippet 到 $WILDAI_DIR/nginx.app-locations.conf 并重载 wildai-nginx"
  ssh_remote "cp '$WILDAI_DIR/nginx.app-locations.conf' '$WILDAI_DIR/nginx.app-locations.conf.bak.$(date +%Y%m%d%H%M%S)'"
  scp_cmd() {
    sshpass -e scp -o StrictHostKeyChecking=accept-new "$1" "${DEPLOY_SERVER}:$2"
  }
  scp_cmd "$ROOT/deploy/proxy/wildai-storyboard-billing.snippet" "/tmp/storyboard-billing.snippet"
  ssh_remote "printf '%s\n' '$MARKER' | cat - /tmp/storyboard-billing.snippet '$WILDAI_DIR/nginx.app-locations.conf' > /tmp/nginx.app-locations.new && mv /tmp/nginx.app-locations.new '$WILDAI_DIR/nginx.app-locations.conf'"
  ssh_remote "docker exec wildai-nginx nginx -t && docker restart wildai-nginx"
  log "WildAI nginx 已重启（使 bind mount 配置生效）"
}

if [[ "$PATCH_WILDAI" == 1 ]]; then
  patch_wildai_nginx
  exit 0
fi

log "同步源码 → $DEPLOY_SERVER:$REMOTE_DIR"
# 注意：排除项必须锚定根目录（/data），否则 src/settings/hubs/data 这类同名子目录也会被跳过
"${RSYNC[@]}" \
  --exclude /node_modules \
  --exclude /.git \
  --exclude /data \
  --exclude /projects \
  --exclude /.env \
  --exclude /deploy/proxy/.htpasswd \
  --exclude /openspec \
  --exclude /.cursor \
  "$ROOT/" "${DEPLOY_SERVER}:${REMOTE_DIR}/"

read_local_env() {
  local f="$ROOT/deploy/.env"
  [[ -f "$f" ]] || return 0
  while IFS= read -r line; do
    [[ "$line" =~ ^(XUNHUPAY_|BILLING_|MAIL_USERNAME=) ]] || continue
    [[ "$line" =~ ^# ]] && continue
    export "$line" 2>/dev/null || true
  done < <(grep -E '^(XUNHUPAY_|BILLING_|MAIL_USERNAME=)' "$f" || true)
}

read_local_env

log "远端合并计费环境变量（不覆盖已有 APIMART 等渠道 Key）"
REMOTE_ENV_BLOCK="$(cat <<EOF
XUNHUPAY_APPID=${XUNHUPAY_APPID:-201906181960}
XUNHUPAY_SECRET=${XUNHUPAY_SECRET:-}
XUNHUPAY_GATEWAY=${XUNHUPAY_GATEWAY:-https://api.xunhupay.com}
XUNHUPAY_NOTIFY_URL=https://rechargeai.cn/api/billing/xunhupay/notify
BILLING_DB_PATH=/data/projects/billing.sqlite
BILLING_ALLOW_SIMULATE=0
BILLING_TEST_PACK=1
BILLING_ADMIN_EMAIL=${BILLING_ADMIN_EMAIL:-${MAIL_USERNAME:-296629801@qq.com}}
PROXY_CONF=nginx.conf
PUBLIC_PORT=80
PUBLIC_TLS_PORT=443
EOF
)"
printf '%s\n' "$REMOTE_ENV_BLOCK" | "${SSH[@]}" bash -s "$REMOTE_DIR" <<'EOS'
set -euo pipefail
RD="$1"
ENV="$RD/.env"
touch "$ENV"
chmod 600 "$ENV"
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  k="${line%%=*}"
  v="${line#*=}"
  if grep -q "^${k}=" "$ENV" 2>/dev/null; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV"
  else
    echo "${k}=${v}" >> "$ENV"
  fi
done
EOS
ssh_remote "mkdir -p '$REMOTE_DIR/data/projects' '$REMOTE_DIR/data/media/generated' '$REMOTE_DIR/data/media/videos' '$REMOTE_DIR/data/media/voices' '$REMOTE_DIR/data/media/exports' '$REMOTE_DIR/data/media/publish-packages'"

if [[ "${DEPLOY_PATCH_WILDAI:-0}" == 1 ]]; then
  patch_wildai_nginx
fi

if [[ "$BUILD" == 1 ]]; then
  log "远端 docker compose 重建 app + proxy"
  ssh_remote "cd '$REMOTE_DIR' && DOCKER_BUILDKIT=1 docker compose -f docker-compose.yml -f docker-compose.auth.yml build app && docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d app proxy"
else
  ssh_remote "cd '$REMOTE_DIR' && docker compose -f docker-compose.yml -f docker-compose.auth.yml up -d proxy && docker compose restart proxy"
fi

log "远端自检（notify 经 WildAI 443 → 分镜 8080，应非 401）"
ssh_remote "curl -s -o /dev/null -w 'notify:%{http_code}\n' -X POST http://127.0.0.1:8080/api/billing/xunhupay/notify -H 'Content-Type: application/json' -d '{}' || true"
ssh_remote "curl -sk -o /dev/null -w 'notify443:%{http_code}\n' -X POST https://127.0.0.1/api/billing/xunhupay/notify -H 'Content-Type: application/json' -d '{}' || true"

log "完成。分镜：https://rechargeai.cn/ （Basic Auth）计费回调：https://rechargeai.cn/api/billing/xunhupay/notify"