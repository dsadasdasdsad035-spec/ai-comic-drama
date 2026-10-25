#!/usr/bin/env bash
# 一键部署：.env → DTK（可选，默认开）→ 应用容器。
#
# 用法：
#   ./scripts/deploy-up.sh              # 全量：DTK + 应用
#   ./scripts/deploy-up.sh --no-dtk     # 只起应用（不用抖音/不用 DTK）
#   ./scripts/deploy-up.sh --rebuild    # 强制重建应用镜像
#
# 幂等：重复执行只更新镜像与配置，不动已有数据。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
RUNTIME_ENV="$ROOT/.dtk/runtime.env"
WITH_DTK=1
REBUILD=""

for arg in "$@"; do
  case "$arg" in
    --no-dtk) WITH_DTK=0 ;;
    --rebuild) REBUILD="--build" ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[36m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- .env

if [[ ! -f "$ENV_FILE" ]]; then
  log "没有 .env，从 deploy/.env.example 生成"
  cp "$ROOT/deploy/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "请先填 .env 里的渠道 Key（至少一个），否则生成类功能不可用"
fi

# ---------------------------------------------------------------- 数据目录

mkdir -p "$ROOT"/data/projects \
         "$ROOT"/data/media/{generated,videos,voices,exports}

# ---------------------------------------------------------------- DTK

if [[ "$WITH_DTK" == 1 ]]; then
  log "启动 DTK"
  "$ROOT/scripts/dtk-up.sh"
fi

# 把 DTK 的地址与 Key 注入根 .env（已存在则不覆盖，除非是空值）
if [[ -f "$RUNTIME_ENV" ]]; then
  while IFS='=' read -r k v; do
    [[ -z "$k" || "$k" == \#* ]] && continue
    if grep -qE "^${k}=" "$ENV_FILE"; then
      cur="$(grep -E "^${k}=" "$ENV_FILE" | tail -1 | cut -d= -f2-)"
      if [[ -z "$cur" ]]; then
        # 用 | 作分隔符，Key 里可能有 /
        sed -i.bak "s|^${k}=.*|${k}=${v}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
        log "已注入 ${k}"
      fi
    else
      printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
      log "已追加 ${k}"
    fi
  done < <(grep -vE '^\s*(#|$)' "$RUNTIME_ENV")
fi

# ---------------------------------------------------------------- 应用

log "构建并启动应用"

# 端口预检：本机正在跑 npm run dev 时，5273 会被占，
# docker 的报错是「ports are not available」+ 一长串 daemon 信息，不好读。
APP_ADDR_PRE="$(grep -E '^APP_BIND_ADDR=' "$ENV_FILE" | cut -d= -f2-)"
APP_PORT_PRE="$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2-)"
APP_ADDR_PRE="${APP_ADDR_PRE:-127.0.0.1}"
APP_PORT_PRE="${APP_PORT_PRE:-5273}"
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$APP_PORT_PRE" -sTCP:LISTEN >/dev/null 2>&1; then
  holder="$(lsof -nP -iTCP:"$APP_PORT_PRE" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" (pid "$2")"}')"
  die "端口 ${APP_PORT_PRE} 已被占用：${holder}
     这是本机开发服务器在跑（npm run dev）时的常见情况。
     二选一：
       a) 停掉开发服务器后重跑
       b) 在 .env 里把 APP_PORT 改成别的端口（例如 5274）"
fi

cd "$ROOT"
# shellcheck disable=SC2086
docker compose up -d $REBUILD app

log "等待健康检查"
ready=0
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' storyboard-app-1 2>/dev/null || echo unknown)"
  if [[ "$status" == "healthy" ]]; then ready=1; break; fi
  if [[ "$status" == "unhealthy" ]]; then
    docker logs --tail 40 storyboard-app-1 >&2
    die "应用容器 unhealthy"
  fi
  sleep 2
done

APP_ADDR="$(grep -E '^APP_BIND_ADDR=' "$ENV_FILE" | cut -d= -f2-)"
APP_PORT="$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2-)"
APP_ADDR="${APP_ADDR:-127.0.0.1}"
APP_PORT="${APP_PORT:-5273}"
if [[ "$APP_ADDR" == "0.0.0.0" ]]; then APP_ADDR="127.0.0.1"; fi

if [[ "$ready" == 1 ]]; then
  cat <<EOF

部署完成。

  应用        http://${APP_ADDR}:${APP_PORT}
  数据目录    ./data/projects（SQLite + 项目媒体 + 创意源视频）
  产物目录    ./data/media/{generated,videos,voices,exports}

  健康检查    curl -s http://${APP_ADDR}:${APP_PORT}/api/health
  日志        docker compose logs -f app
  停止        docker compose down
  连 DTK 一起停
              docker compose -p dtk -f .dtk/src/docker/compose.yml --profile browser down
EOF
else
  printf '\033[33m[deploy]\033[0m 健康检查未在 120 秒内通过，查看日志：docker compose logs app\n' >&2
  exit 1
fi
