# Proposal

## Why

当前应用只有两种运行方式：`npm run dev`（Vite 开发服务器）和手工在终端里跑 `node server/index.mjs`，部署侧是 Docker。对非工程用户来说，这意味着要自己装 Node 22、自己开终端、自己记端口，跑错目录还会读不到数据。

数据落点也不适合分发：`public/` 在代码目录内，生成产物会写进安装位置；`SB_PROJECTS_DIR` 未设置时 `server/data.mjs` 会去猜 `../manga-pipeline/projects` 或仓库内 `projects/`——这在只读安装包或 macOS App Translocation 下直接失败。

上一轮 `server-standalone-entry` 已经完成了结构前提：接口实现从 `vite.config.ts` 剥离、提供可 fork 的 `server/index.mjs`、支持 `SB_PORT=0` 并在 stdout 打印端口握手行。本次把这个能力包装成可双击运行的 macOS 应用。

## What Changes

- **新增 Electron 主进程**：以 `SB_PORT=0` 拉起 `server/index.mjs`，解析 stdout 的 `[server] listening http://host:port` 拿实际端口，窗口加载该地址。服务就绪前显示启动画面，失败时给出可读错误与重试入口，而不是白屏。
- **单实例锁**：重复启动只聚焦已有窗口；第二个实例不启动服务进程，避免端口与 SQLite 双写。
- **数据根迁移到用户目录**：项目库、媒体与运行期状态（暂存、渲染作业、场景草稿、平台登录态、计费数据库）分目录放到 `~/Library/Application Support/<AppName>/`，首次启动自动创建；由主进程显式注入给服务进程，不再依赖 `process.cwd()` 或应用根目录。
- **随包分发运行时依赖**：Node 运行时（用于执行 `server/index.mjs` 与 `server-build/app.mjs`）、`ffmpeg`/`ffprobe`、Blender。主进程通过 `FFMPEG_PATH` / `BLENDER_BIN` 指向应用内二进制，`server/` 侧现有解析顺序不变。
- **macOS 打包与分发**：产出 `.app` 与 `.dmg`；主进程及每个嵌套可执行文件（含 Blender 包内数百个 Mach-O）逐个签名，开启 Hardened Runtime 并公证、staple。
- **退出与故障恢复**：关窗、`Cmd+Q`、系统关机统一走「SIGTERM 服务进程 → 等待退出 → 超时强杀」；服务进程意外退出时在窗口内提供「重启服务」，并把最后若干行 stderr 暴露给用户。
- **云端登录与计费保持不变**：`sb_session` cookie 与全部 `/api/billing/*` 行为不变，桌面端只换承载容器，不引入本地旁路。

明确不在本次范围：

- Windows / Linux 打包（另开 change）
- 自动更新（`electron-updater`）、差分升级、崩溃上报
- 桌面本地模式（跳过登录/计费、BYO API Key）
- 首启向导、多窗口、系统托盘常驻、`utilityProcess` 改造
- 已有数据的自动迁移（首次启动只做检测与提示）

## Capabilities

### New Capabilities

- `desktop-app-host`: Electron 主进程的启动序列、单实例、窗口与菜单、服务进程拉起与端口握手、退出与故障恢复
- `desktop-runtime-binaries`: 随包分发的 Node / ffmpeg / Blender 二进制的定位、校验与缺失降级
- `desktop-app-packaging`: macOS 安装包产物、应用数据根落点、签名与公证、升级不丢数据

### Modified Capabilities

- `server-runtime`: 新增「运行期状态根可配置」要求，使暂存、作业、草稿、登录态与计费库可随桌面端迁到用户数据目录，同时保持开发与容器的默认行为不变。

## Impact

**新增代码**

- `desktop/main/`：主进程（启动序列、单实例、窗口、服务进程管理、菜单）
- `desktop/preload/`：最小 preload（仅暴露版本与「重启服务」通道）
- `desktop/renderer/`：启动画面与错误页（纯静态 HTML/CSS，不进 Vite 构建）
- `desktop/electron-builder.yml`：打包、签名、公证、二进制归档配置

**改动的既有文件**

- `package.json`：新增 `electron` / `electron-builder` 开发依赖；新增 `desktop:dev`、`desktop:build`、`desktop:dist` 脚本
- `server/blender.mjs`、`server/ffmpeg-host.mjs`：候选路径各增加一条「应用内 resources 目录」，使未注入 env 时也能命中（env 优先级保持最高）
- `server/paths.mjs`、`server/agentHost.mjs`、`server/blender.mjs`、`server/vggt.mjs`、`server/scene-draft.mjs`、`server/project-lifecycle.mjs`、`server/billing/db.mjs`：把 `.agent-jobs`、`.blender-jobs`、`.vggt-jobs`、`.scene-drafts`、`data/` 等运行期目录改为从状态根解析，未配置时回退原路径
- `.gitignore`：忽略 `desktop/dist`、`desktop/bin`
- `README.md`：新增桌面版安装与开发两节

**不改动**

- `server/index.mjs`、`server/app.ts`、`vite.config.ts` 的接口实现
- `/api/*` 任何路由与负载
- Docker 与现有部署脚本

**体积与许可**

- `dist` 2.5MB + `public/presets` 113MB + ffmpeg/ffprobe 约 80MB + Blender 约 300MB，安装包预计 450–600MB，未压缩
- Blender 为 GPL 许可，随包分发必须在应用内提供源码获取途径（`desktop/THIRD-PARTY-NOTICES.md` 记录版本、来源 URL 与许可全文）

**风险**

- `server/db.mjs` 与 `server/creative.mjs` 直接 `import { DatabaseSync } from 'node:sqlite'`。若服务进程跑在 Electron 内置 Node 上，该模块可用性取决于 Electron 版本，必须在 spike 里先验证；跑不通则改为随包一个官方 Node 二进制并用其启动服务进程。
- Blender 包内含数百个 Mach-O，逐个签名与 Hardened Runtime 兼容性是公证的主要失败点，需要先用空壳工程验证一遍签名流水线。
