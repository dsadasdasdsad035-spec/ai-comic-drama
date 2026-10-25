#!/usr/bin/env bash
# 启动 DTK（Douyin_TikTok_Download_API）并打印应用要用的地址与 API Key。
#
# 做四件事：
#   1. 按固定 ref 拉取 DTK 源码（已存在则复用）
#   2. 生成 DTK 的 .env（随机密钥，不落仓库）
#   3. 起容器（含 browser-rpc：抖音必须，否则身份池为空）
#   4. 首次初始化管理员 + 铸造 API Key，结果写进 .dtk/runtime.env
#
# 幂等：重复执行不会重建已有密钥，也不会重复初始化管理员。
#
# 用法：./scripts/dtk-up.sh [--force-key]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
DTK_DIR="$ROOT/.dtk"
RUNTIME_ENV="$DTK_DIR/runtime.env"
FORCE_KEY=0
[[ "${1:-}" == "--force-key" ]] && FORCE_KEY=1

log()  { printf '\033[36m[dtk]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[dtk]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[dtk]\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 前置检查

command -v docker >/dev/null || die "没有 docker"
docker compose version >/dev/null 2>&1 || die "没有 docker compose v2"
command -v openssl >/dev/null || die "没有 openssl（用于生成密钥）"

# 从 .env 读配置；没写就用默认值。
# 只认 KEY=VALUE 行，跳过注释与空行；值里允许有空格，但不允许带行尾注释。
read_env() {
  local key="$1" def="${2:-}"
  local val=""
  if [[ -f "$ENV_FILE" ]]; then
    val="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*$//' || true)"
  fi
  printf '%s' "${val:-$def}"
}

DTK_REF="$(read_env DTK_REF 0661234)"
DTK_PORT="$(read_env DTK_PORT 8000)"
ADMIN_USER="$(read_env DTK_ADMIN_USER admin)"
ADMIN_PASS="$(read_env DTK_ADMIN_PASSWORD '')"
[[ -z "$ADMIN_PASS" ]] && die "请先在 .env 里设置 DTK_ADMIN_PASSWORD（至少 8 位）"

API="http://127.0.0.1:${DTK_PORT}"

# ---------------------------------------------------------------- 1. 源码

mkdir -p "$DTK_DIR"
if [[ ! -d "$DTK_DIR/src/.git" ]]; then
  log "拉取 DTK 源码（ref=${DTK_REF}）"
  rm -rf "$DTK_DIR/src"
  git clone --filter=blob:none https://github.com/Evil0ctal/Douyin_TikTok_Download_API.git "$DTK_DIR/src"
  git -C "$DTK_DIR/src" checkout --quiet "$DTK_REF"
else
  log "复用已有源码：$DTK_DIR/src"
fi

# ---------------------------------------------------------------- 2. .env

DTK_ENV="$DTK_DIR/src/.env"
GENERATED_ENV=0
if [[ ! -f "$DTK_ENV" ]]; then
  GENERATED_ENV=1
  log "生成 DTK .env（随机密钥）"
  PG_PASS="$(openssl rand -hex 24)"
  RD_PASS="$(openssl rand -hex 24)"
  cat > "$DTK_ENV" <<EOF
DTK_SECRET_KEY=$(openssl rand -base64 48 | tr -d '\n')
POSTGRES_PASSWORD=${PG_PASS}
REDIS_PASSWORD=${RD_PASS}
DTK_DATABASE_URL=postgresql+asyncpg://dtk:${PG_PASS}@postgres:5432/dtk
DTK_REDIS_URL=redis://:${RD_PASS}@redis:6379/0
DTK_BROWSER_RPC_URL=http://browser-rpc:9000
EOF
  chmod 600 "$DTK_ENV"
else
  log "复用已有 DTK .env（密钥不重新生成）"
fi

# ---------------------------------------------------------------- 3. 容器

# 护栏：Postgres 只在数据卷首次初始化时设置密码。若卷已存在但 .env 是新生成的，
# 密码必然对不上，报错会是一大段 asyncpg 堆栈。提前拦下并给出两条出路。
if [[ "$GENERATED_ENV" == 1 ]] && docker volume ls --format '{{.Name}}' | grep -qx 'dtk_postgres-data'; then
  die "检测到旧的 DTK 数据卷（dtk_postgres-data）与新的 .env 密码不匹配。
     二选一：
       a) 保留数据：把旧栈的 .env（含 POSTGRES_PASSWORD）恢复到 $DTK_ENV 后重跑
       b) 丢掉数据：docker compose -p dtk -f \"$DTK_DIR/src/docker/compose.yml\" --profile browser down -v
         然后重跑本脚本（注意：会删除 DTK 里的解析记录与归档）"
fi

log "启动 DTK（含 browser-rpc）"
(
  cd "$DTK_DIR/src"
  DTK_BIND_PORT="$DTK_PORT" COMPOSE_ENV_FILES=.env \
    docker compose -p dtk -f docker/compose.yml --profile browser up -d --build
) > "$DTK_DIR/up.log" 2>&1 || {
  tail -20 "$DTK_DIR/up.log" >&2
  die "DTK 启动失败，完整日志：$DTK_DIR/up.log"
}

log "等待 /api/setup/status 就绪"
ready=0
for _ in $(seq 1 60); do
  if curl -fsS -m 3 "$API/api/setup/status" > /dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]] || die "DTK 在 120 秒内没有就绪，检查：docker logs dtk-api-1"

# ---------------------------------------------------------------- 4. 初始化

INITIALIZED="$(curl -fsS "$API/api/setup/status" | grep -o '"initialized":[a-z]*' | cut -d: -f2)"

if [[ "$INITIALIZED" != "true" ]]; then
  log "创建首个管理员：$ADMIN_USER"
  TOKEN="$(docker logs dtk-api-1 2>&1 | grep -o 'token=[A-Za-z0-9_-]*' | head -1 | cut -d= -f2 || true)"
  [[ -n "$TOKEN" ]] || die "找不到 setup token。若实例已初始化过，请删掉 .dtk 与 dtk-* 容器后重来"

  curl -fsS -X POST "$API/api/setup/init" \
    -H 'Content-Type: application/json' \
    -d "$(printf '{"token":"%s","username":"%s","password":"%s"}' "$TOKEN" "$ADMIN_USER" "$ADMIN_PASS")" \
    > /dev/null || die "初始化管理员失败"
else
  log "实例已初始化，跳过管理员创建"
fi

# ---------------------------------------------------------------- 5. API Key

mint_key() {
  # 登录拿会话 cookie（DTK 用 HttpOnly dtk_session）
  local hdr session
  hdr="$(curl -fsS -D - -o /dev/null -X POST "$API/api/v1/auth/login" \
          -H 'Content-Type: application/json' \
          -d "$(printf '{"username":"%s","password":"%s"}' "$ADMIN_USER" "$ADMIN_PASS")")" || return 1
  session="$(printf '%s' "$hdr" | tr -d '\r' | grep -i '^set-cookie: dtk_session=' | head -1 | sed 's/.*dtk_session=\([^;]*\).*/\1/')"
  [[ -n "$session" ]] || return 1

  local resp key
  resp="$(curl -fsS -X POST "$API/api/v1/admin/api-keys" \
           -H 'Content-Type: application/json' -H "Cookie: dtk_session=$session" \
           -d '{"name":"storyboard-canvas","scopes":["douyin:read","tiktok:read","bilibili:read"]}')" || return 1
  key="$(printf '%s' "$resp" | grep -o '"key":"dtk_[^"]*"' | head -1 | cut -d'"' -f4)"
  [[ -n "$key" ]] || return 1
  printf '%s' "$key"
}

EXISTING_KEY=""
[[ -f "$RUNTIME_ENV" ]] && EXISTING_KEY="$(grep -E '^DTK_API_KEY=' "$RUNTIME_ENV" | cut -d= -f2- || true)"

if [[ -n "$EXISTING_KEY" && "$FORCE_KEY" == 0 ]]; then
  log "复用已铸造的 API Key（要换一个用 --force-key）"
  DTK_KEY="$EXISTING_KEY"
else
  log "铸造 API Key（scopes: douyin/tiktok/bilibili read）"
  DTK_KEY="$(mint_key)" || die "铸造 API Key 失败：检查管理员密码是否与首次初始化时一致"
fi

umask 077
cat > "$RUNTIME_ENV" <<EOF
# 由 scripts/dtk-up.sh 生成；不要提交
DTK_BASE_URL=http://host.docker.internal:${DTK_PORT}
DTK_API_KEY=${DTK_KEY}
EOF

# ---------------------------------------------------------------- 完成

cat <<EOF

DTK 已就绪。

  服务地址（宿主机）      http://127.0.0.1:${DTK_PORT}
  控制台                  http://127.0.0.1:${DTK_PORT}/
  应用容器内使用           http://host.docker.internal:${DTK_PORT}
  API Key                 ${DTK_KEY}

已写入 ${RUNTIME_ENV}。

下一步：
  ./scripts/deploy-up.sh          # 把上面的值注入应用并启动
  或手工把两行 DTK_* 抄进根目录 .env

常用命令：
  docker compose -p dtk -f .dtk/src/docker/compose.yml logs -f api
  docker compose -p dtk -f .dtk/src/docker/compose.yml --profile browser down
EOF
