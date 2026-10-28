# 分镜画布（storyboard-canvas）应用镜像
#
# 设计取舍：
# - API 与页面都在 Vite dev middleware 里（vite.config.ts 的 configureServer），
#   所以镜像跑的是 `vite dev` 而不是 `vite preview`。这是当前架构事实，不是偷懒；
#   等 server/index.mjs 拆出来后再换成静态产物 + 独立 Node 服务。
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

WORKDIR /app

# 先装依赖，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

# Chromium：发布台用它校验会话与上传草稿（无头）。
# 必须用 Playwright 自己的安装器，不能装 apt 的 chromium —— 版本与
# playwright-core 的 CDP 协议不匹配会直接启动失败。
# 浏览器放在镜像内固定路径，运行期不依赖 $HOME 缓存。
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright-core install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

# 只安装依赖。不在这里跑 `npm run build`：
# 应用运行时走 vite dev（API 在 configureServer 里），静态构建产物用不上；
# 而 tsc 是「全仓库」门禁，别人正在改的文件会把镜像构建一起堵死。
# 类型检查请在提交前跑 `npm run build`，那是代码质量的门，不是部署的门。
COPY . .

# 可写目录：项目库、创意源视频、公共产物
RUN mkdir -p /data/projects /data/creatives /app/public/generated /app/public/videos \
    /app/public/voices /app/public/exports /app/public/publish-packages

ENV SB_PROJECTS_DIR=/data/projects \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    YTDLP_BIN=/usr/local/bin/yt-dlp \
    HOST=0.0.0.0 \
    PORT=5273

EXPOSE 5273

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" > /dev/null || exit 1

# tini 收僵尸进程：ffmpeg / blender / yt-dlp 都是子进程
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5273", "--strictPort"]
