# 分镜画布（storyboard-canvas）应用镜像
#
# 设计取舍：
# - API 与页面由 server/index.mjs 这一个普通 Node 进程托管（实现在 server/app.ts）。
#   镜像不再跑 `vite dev`：dev server 的模块热更新与按需编译不适合生产。
# - 媒体根由 SB_MEDIA_ROOT 决定，默认 /data/media；URL 前缀（/generated、/videos…）不变。
# - ffmpeg 必须带 libass（字幕烧录）与 ffprobe（probe/抽帧）；Debian 的
#   ffmpeg 包两者都有，比 ffmpeg-static 更完整。
# - node:sqlite 需要 Node 22.5+；这里用 22.23（与开发机一致）。
# - 数据（SQLite / 项目媒体 / 创意源视频）挂在卷上，镜像本身不写业务数据。

FROM node:22-bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=development \
    LANG=C.UTF-8

# ffmpeg/ffprobe：抽帧、probe、合成、字幕
# fonts-noto-cjk：libass 烧字幕需要真实 CJK 字体，否则出方框
# 其余是 Blender 官方 tarball 需要的 X/GL/音频运行库
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-noto-cjk \
      ca-certificates \
      curl \
      tini \
      xz-utils \
      libx11-6 \
      libxi6 \
      libxxf86vm1 \
      libxfixes3 \
      libxrender1 \
      libxext6 \
      libxkbcommon0 \
      libsm6 \
      libice6 \
      libegl1 \
      libgl1 \
      libglu1-mesa \
      libgomp1 \
      libxrandr2 \
      libxinerama1 \
      libxcursor1 \
      libxcomposite1 \
      libxdamage1 \
      libasound2 \
      libfontconfig1 \
      libfreetype6 \
      libdbus-1-3 \
      libsndfile1 \
 && rm -rf /var/lib/apt/lists/*

# Blender：3D 调度渲染。Debian bookworm 的 blender 是 3.4，低于应用要求的 4.2，
# 所以用官方 tarball。容器无 GPU，EEVEE 的 GPU 后端在后台模式下不可用，
# 默认引擎由 compose 注入 BLENDER_ENGINE=cycles（CPU 渲染，不依赖显卡）。
ARG BLENDER_SERIES=4.5
ARG BLENDER_VERSION=4.5.4
RUN curl -fsSL "https://download.blender.org/release/Blender${BLENDER_SERIES}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" \
      -o /tmp/blender.tar.xz \
 && mkdir -p /opt/blender \
 && tar -xJf /tmp/blender.tar.xz -C /opt/blender --strip-components=1 \
 && rm -f /tmp/blender.tar.xz \
 && ln -sf /opt/blender/blender /usr/local/bin/blender \
 && blender --version | head -1

# yt-dlp：用官方独立二进制（自带 Python 运行时），
# 比 apt 的 python3-venv 方案更轻，也不会和系统 python 抢依赖。
# 资产名随构建架构变化：amd64 用 yt-dlp_linux，arm64 用 yt-dlp_linux_aarch64。
ARG YTDLP_VERSION=2026.10.21
ARG TARGETARCH
RUN case "${TARGETARCH:-amd64}" in \
      amd64) YTDLP_ASSET=yt-dlp_linux ;; \
      arm64) YTDLP_ASSET=yt-dlp_linux_aarch64 ;; \
      *) echo "yt-dlp: 不支持的架构 ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${YTDLP_ASSET}" \
      -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && /usr/local/bin/yt-dlp --version

# ---------------------------------------------------------------- 构建阶段
# 只做产物：前端静态文件 + 服务端接口 bundle。
# 不跑 tsc：类型检查是提交前的门（npm run build 里含 tsc），
# 镜像构建只负责产物，避免把别人正在改的文件堵在部署之外。
FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx vite build && npm run build:server

# ---------------------------------------------------------------- 运行阶段
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 只装生产依赖。esbuild 只在 build:server 用，playwright-core 只在宿主机跑验收脚本用，
# 两者都不该进运行镜像（原来的 Chromium 安装属于验收需求，不是运行需求）。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 运行期还需要仓库里的资产（skills/experts/scripts/public/presets 等）
COPY . .
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-build ./server-build

# 可写目录：项目库 + 媒体根（生成产物/视频/配音/导出/发布包都在媒体根下）
RUN mkdir -p /data/projects /data/media/generated /data/media/videos \
    /data/media/voices /data/media/exports /data/media/publish-packages

ENV SB_PROJECTS_DIR=/data/projects \
    SB_MEDIA_ROOT=/data/media \
    SB_HOST=0.0.0.0 \
    SB_PORT=5273 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    YTDLP_BIN=/usr/local/bin/yt-dlp

EXPOSE 5273

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${SB_PORT}/api/health" > /dev/null || exit 1

# tini 收僵尸进程：ffmpeg / blender / yt-dlp 都是子进程
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.mjs"]
