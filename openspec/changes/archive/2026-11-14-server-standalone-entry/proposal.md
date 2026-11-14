# Proposal

## Why

当前全部 `/api/*` 路由（47 条精确路径 + 14 组前缀族）都写在 `vite.config.ts` 的 `configureServer` 中间件里，项目没有任何可独立启动的服务端入口。这导致两件事：生产 Docker 镜像只能跑 `vite dev`（Dockerfile 自述的技术债），桌面端（本地 sidecar 形态）也没有可 fork 的进程。两者依赖同一份重构，先做服务端解耦，投入只付一次。

## What Changes

- 新增 `server/http.mjs`：把 `configureServer` 里的中间件处理逻辑**原样搬迁**为 `createAppHandler(ctx)`，路由分支不改写；`ctx` 承载 `root` / 项目目录 / 媒体根。
- 新增 `server/index.mjs`：`node:http` 独立入口，托管 `dist/` 静态产物（含 SPA 回退）、挂载同一 handler、提供 `/api/health`、监听 SIGTERM/SIGINT 优雅退出。
- `vite.config.ts` 瘦身为「dev 下调用同一 handler」，不再复制一份路由；开发与生产行为由同一份代码保证。
- 媒体写盘根参数化：新增 `SB_MEDIA_ROOT`（对齐既有 `SB_PROJECTS_DIR` 惯例），`/generated`、`/videos`、`/voices`、`/exports`、`/publish-packages` 的磁盘根从 `public/` 改为可配置；**URL 前缀保持不变**，前端与既有验收断言无需改动。
- 构建产物与运行时媒体解耦：`vite build` 不再把 `public/` 下的运行时媒体拷进 `dist/`（当前 `dist` 因媒体拷贝达 228MB，其中代码仅 2.5MB）。
- 端口可配置：`SB_PORT`（`0` 表示系统分配），启动完成后在 stdout 输出实际端口，供 Electron 主进程做握手。
- **BREAKING**（部署侧）：Docker 镜像从 `vite dev` 改为 `node server/index.mjs`，镜像不再需要 dev 依赖。

明确不在本次范围：Electron 壳与安装包、代码签名/公证、ffmpeg 与 Blender 的随包分发、桌面本地模式（登录/计费旁路）、首启向导。

## Capabilities

### New Capabilities

- `server-runtime`: 独立进程托管前端与 API 的运行时契约——端口绑定与端口上报、静态产物托管与 SPA 回退、媒体根解析、健康检查、优雅退出与并发实例约束。

### Modified Capabilities

（无。本次不改变任何面向用户的功能行为；路径根与启动方式的差异由新能力承载。）

## Impact

- **代码**：`vite.config.ts`（瘦身，7033 行中路由段迁出）、`server/index.mjs`（新）、`server/http.mjs`（新）、`server/data.mjs`、`server/media.mjs`、`server/db.mjs`、`server/blender.mjs`、`server/vggt.mjs`（全仓 28 处 `path.join(..., 'public', ...)` 指向点需逐一收敛到媒体根）。
- **部署**：`Dockerfile`（改为静态产物 + Node 入口，去掉 dev 依赖）、`docker-compose.yml`（新增 `SB_MEDIA_ROOT` 卷）、`scripts/deploy-up.sh`。
- **依赖**：无新增运行时依赖，入口使用 `node:http`；Node 版本下限仍为 22.13（`node:sqlite`）。
- **兼容风险**：仓库内 100+ 个 `verify-*.mjs` 默认认为 API 在 `127.0.0.1:5273` 的 Vite 下。本次依赖「dev 复用同一 handler」保持既有脚本不改断言即可通过；个别脚本若依赖 Vite 专有行为（HMR、public 索引）需要在任务里单独确认。
- **下游**：`desktop-shell-electron` 依赖本 change 提供的 `server/index.mjs` 与 `SB_MEDIA_ROOT` / `SB_DATA_ROOT`，本 change 不含 Electron 代码。
