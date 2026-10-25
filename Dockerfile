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
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      fonts-noto-cjk \
      ca-certificates \
      curl \
      tini \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp：用官方独立二进制（自带 Python 运行时），
# 比 apt 的 python3-venv 方案更轻，也不会和系统 python 抢依赖。
ARG YTDLP_VERSION=2026.10.21
RUN curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux_aarch64" \
      -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && /usr/local/bin/yt-dlp --version

WORKDIR /app

# 先装依赖，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci

# 只安装依赖。不在这里跑 `npm run build`：
# 应用运行时走 vite dev（API 在 configureServer 里），静态构建产物用不上；
# 而 tsc 是「全仓库」门禁，别人正在改的文件会把镜像构建一起堵死。
# 类型检查请在提交前跑 `npm run build`，那是代码质量的门，不是部署的门。
COPY . .

# 可写目录：项目库、创意源视频、公共产物
RUN mkdir -p /data/projects /data/creatives /app/public/generated /app/public/videos /app/public/voices /app/public/exports

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
