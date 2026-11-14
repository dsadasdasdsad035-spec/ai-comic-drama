# Design

## Context

动机见 `proposal.md — Why`；行为契约见 `specs/desktop-app-host`、`specs/desktop-runtime-binaries`、`specs/desktop-app-packaging` 与 `specs/server-runtime` 的新增要求。这里只记录影响实现路径的既有事实。

**已经可用的前提**（来自 `server-standalone-entry`）

- `server/index.mjs` 已支持 `SB_PORT=0`、`SB_HOST` 与 stdout 单行握手 `[server] listening http://<host>:<port>`。
- `server/app.ts` 经 esbuild 打成 `server-build/app.mjs`，构建命令带 `--packages=external`。
- `server/index.mjs` 的 `ROOT` 取 `import.meta.dirname/..`，因此只要 `server/`、`server-build/`、`dist/` 三者保持相对位置，服务进程在任何目录都能正确解析。

**构建产物的真实体积**

| 组成 | 体积 |
|---|---|
| `dist/` | 2.5MB |
| `public/presets/` | 113MB |
| 生产依赖 `node_modules/` | 319MB（但实际只有 2 个外部包被真正引用） |

**`server-build/app.mjs` 的真实外部依赖**只有 `zod`、`fflate` 两个 npm 包与 `node:sqlite` 等内置模块。这决定了打包时可以只带这两个包，而不是整个 `node_modules`。

**写在应用根目录下的运行期目录**（这是本次最大的隐藏成本）

| 目录 | 写入方 |
|---|---|
| `.agent-jobs/` | `server/agentHost.mjs` |
| `.blender-jobs/` | `server/blender.mjs` |
| `.vggt-jobs/` | `server/vggt.mjs` |
| `.scene-drafts/` | `server/scene-draft.mjs`、`server/project-lifecycle.mjs` |
| `data/billing.sqlite` | `server/billing/db.mjs` |

（`.publish-profiles/` 曾属此类，但发布台已在 `0f21f45` 整体删除，现在没有写入方，只剩文档与一个空残留目录。）

这五处都基于 `appRoot` 拼接。应用包从 `Resources/` 运行后，这些写入会落到应用包内部——在只读挂载或 App Translocation 后直接失败。

**`node:sqlite` 的事实**

本机 `node v22.23.2` 无需 `--experimental-sqlite` 即可 `require('node:sqlite')`。Electron 45.3.2 内置 Node `v24.22.2`，理论上满足要求，但 Electron 是否在编译期启用该模块未经本仓验证。

## Goals / Non-Goals

**Goals**

- 服务进程与 Electron 主进程的解耦是**硬边界**：主进程只做「拉起 → 读 stdout → 拿端口 → 加载 URL → 退出时收尸」。
- 打包后「应用包只读、数据在用户目录」成立：任何运行期写入都不落在 `Resources/`。
- 服务端代码在 dev / 独立进程 / 桌面三种形态下**共用同一份实现**，不出现桌面专用分支。

**Non-Goals**

- 不把前端改成 Electron renderer 里的 SPA 直连（仍走 HTTP，避免前端出现第二种数据通道）。
- 不引入 `ipcMain` 业务通道；preload 只暴露「重启服务」与版本号。
- 不做 Electron 内置 Node 与随包 Node 的双轨运行时。
- 不做自动更新与崩溃上报通道（见 proposal 的范围外）。

## Decisions

### 决策 1：随包官方 Node 二进制，而不是复用 `ELECTRON_RUN_AS_NODE`

**选择**：在 `Resources/runtime/node` 放一份官方 Node 22 LTS 官方 macOS 二进制，主进程 `spawn` 它执行 `server/index.mjs`。

**理由**

- `node:sqlite` 是服务端硬依赖（`server/db.mjs`、`server/creative.mjs`、`server/billing/db.mjs`）。Electron 是否编译启用该内置模块取决于构建配置，一旦某次 Electron 升级关掉它，整个应用起不来，但故障点距离改动很远。
- 复用 Electron 的 Node 会让「服务端行为」与「Electron 版本」耦合；升级 Electron 就变成一次服务端回归测试。
- 随包 Node 与今天 `npm start` 跑的形态完全一致，已验证。
- 代价可控：官方 macOS arm64 Node 二进制约 110MB，其中大部分是 ICU 与 OpenSSL。

**备选**：`ELECTRON_RUN_AS_NODE=1` + `process.execPath`。省 110MB，但把 sqlite 可用性押在 Electron 的编译开关上。若后续需要瘦身，这是唯一的优化方向，且必须先让 `verify-server-entry.mjs` 跑在 Electron 的 Node 上通过。

### 决策 2：用 `spawn` + stdout 单行握手，而不是 `utilityProcess.fork`

**选择**：`child_process.spawn(nodeBin, ['server/index.mjs'], { env })`，`readline` 逐行读 stdout，匹配 `^\[server\] listening http://(.+):(\d+)$`。

**理由**

- `utilityProcess` 与主进程共享 Electron 生命周期，无法表达「服务进程独立存在、可被单独重启」这一前提；而「服务崩溃后重启服务」是 `desktop-app-host` 的明确要求。
- `utilityProcess` 的 stdio 语义与普通 Node 不同，握手解析要多写适配层。
- 独立进程让用户可以在应用外调试服务端（同一个 `SB_*` 环境变量即可）。

**代价**：需要自己管孤儿进程。用「进程组 + 退出时 SIGTERM → 5s 超时 SIGKILL」兜住，服务侧已有 `SIGTERM` 优雅退出。

### 决策 3：`SB_STATE_ROOT` 作为第七个环境变量，兜在 `paths.mjs`

**选择**：新增 `server/paths.mjs` 导出 `resolveStateRoot(root)`（`SB_STATE_ROOT` > `root`），并把六处 `path.join(appRoot, '.xxx')` 改为 `statePath(appRoot, '.xxx')`。

**理由**

- 六处写入方分布在六个模块，各自读 env 会写出六份不一致的解析逻辑，且容易漏掉路径穿越校验。
- 集中到 `paths.mjs` 与既有 `mediaPath` / `ensureMediaDir` 同构，复用其越界校验。
- 未设 `SB_STATE_ROOT` 时返回 `root`，dev 与 Docker 行为**零变化**，`verify-paths.mjs` 可以直接扩两条断言覆盖。

**备选**：把 `.xxx` 目录全部塞进 `SB_PROJECTS_DIR`。放弃——`SB_PROJECTS_DIR` 的语义是「项目库」，把渲染作业与计费库混进去会让 `listProjects` 的目录枚举逻辑需要额外排除项，风险更大。

### 决策 4：`extraResources` 平铺，不打进 asar

**选择**：`electron-builder` 的 `extraResources` 把 `server/`、`server-build/`、`dist/`、`public/presets/`、`node_modules/{zod,fflate}` 映射到 `Contents/Resources/app/` 下，保持与仓库相同的相对结构。

**理由**

- `server/index.mjs` 用 `import.meta.dirname/..` 算 `ROOT`。只要 `Resources/app/server/index.mjs` 存在，`ROOT` 自然等于 `Resources/app/`，`dist/` 与 `server-build/` 也就都能命中——不需要在服务端加「打包模式」分支。
- asar 内的文件无法被 `spawn` 出来的 Node 以真实路径读取（`fs` 走 asar 补丁只在 Electron 进程内生效）。服务进程是纯 Node，必须看到真实文件。
- `public/presets` 113MB 与后面的 Blender 一起塞进 asar 会让首次启动的解压/映射代价变高。

**代价**：`Resources/app/` 完全裸露，用户可以直接改。接受——这是本地工具，不是防篡改场景。

### 决策 5：Blender 与 ffmpeg 走 `extraResources` 独立目录，由主进程注入绝对路径

**选择**：`Resources/bin/ffmpeg`、`Resources/bin/ffprobe`、`Resources/blender/Blender.app/...`；主进程按 `process.resourcesPath` 拼绝对路径，注入 `FFMPEG_PATH`、`BLENDER_BIN`。

**理由**

- 服务端 `server/ffmpeg-host.mjs` / `server/blender.mjs` 已经把「env 优先 → 静态候选 → PATH」写好了，注入 env 是零改动路径。
- 同时给这两个模块各加一条「`process.resourcesPath` 派生候选」，覆盖「env 没注入但跑在打包环境」的边缘情况（例如用户从终端直接跑服务进程）。

**Blender 的实际麻烦**：`Blender.app` 内含数百个 Mach-O。签名必须**由内向外**（先 `.dylib` / `.so` / 内层可执行，再 `Blender.app` 本体），且每个二进制都要带同一组 entitlements。`electron-builder` 的 `afterSign` 钩子只签自己的产物，签不了这个，需要独立的签名脚本。

### 决策 6：三处数据根默认值放在主进程，而不是服务端

**选择**：主进程计算 `app.getPath('userData')` 下的 `projects/`、`media/`、`state/`，通过 `SB_PROJECTS_DIR`、`SB_MEDIA_ROOT`、`SB_STATE_ROOT` 注入。

**理由**

- 服务端不该知道「macOS 的 Application Support 在哪」这类平台知识；这也是 `server-runtime` 保持平台无关的原因。
- 主进程是唯一有 `app.getPath()` 的地方，且它已经负责 env 注入，职责集中。

### 决策 7：启动画面与错误页用本地静态文件，不额外起服务

**选择**：`desktop/renderer/splash.html` 通过 `loadFile` 加载；握手成功或失败后 `loadURL` 切到服务地址，失败时用 `loadFile` 加载 `error.html` 并带 query 传错误摘要。

**理由**

- 握手期间服务还没起来，任何 `http://` 地址都会白屏。
- 本地文件加载没有网络依赖，也不会因为服务挂掉而崩。

### 决策 8：不新增 `desktop-runtime-binaries` 的代码分支，只加候选路径

**选择**：`server/blender.mjs` 与 `server/ffmpeg-host.mjs` 各增加一条候选，其余解析逻辑不动。

**理由**：避免把「桌面」概念渗进服务端解析器；env 注入永远是第一优先级，候选只是兜底。

## Risks / Trade-offs

- **[Blender 公证是主要失败点]** → 先把签名流水线在只有 Blender 的空壳工程上跑通，再接入真实构建；签名脚本按「内层 → 外层」遍历并断言每个 Mach-O 都有签名，缺一个就让构建失败。
- **[安装包 450–600MB，下载与首次启动慢]** → `dmg` 用 LZMA 压缩；启动画面给出进度反馈而不是空白；在 README 明确体积预期。
- **[Blender 包内 Mach-O 可能不满足 Hardened Runtime]** → 必要时对 Blender 单独降级为「不启用 library validation」的签名参数；若仍不通过，退回「首次启动引导用户安装 Blender」并修改 `desktop-runtime-binaries` 的要求（这会改动 spec，必须先与用户确认）。
- **[随包 Node 与开发机 Node 版本漂移]** → 在 `desktop/` 里固定 Node 版本号，`verify-server-entry.mjs` 增加一次「用随包 Node 跑一遍」的断言。
- **[状态根迁移遗漏写入点]** → `verify-paths.mjs` 增加「设置 `SB_STATE_ROOT` 后六个目录都不落在 appRoot」的断言，用目录快照比较而不是逐个文件断言，能抓到遗漏。
- **[用户已有数据在旧位置]** → 首次启动只做检测与提示，不自动迁移（proposal 范围外）；提示文案给出旧路径与新路径。
- **[`extraResources` 平铺导致升级残留旧文件]** → 卸载重装是干净路径；升级时先删除 `Resources/app` 再整体替换，避免旧版 `dist` 与新 `server-build` 混搭。

## Migration Plan

1. 先合入 `SB_STATE_ROOT`（服务端，独立可验证），dev 与 Docker 行为不变，`verify-paths.mjs` 与既有回归全绿。
2. 再合入 `desktop/` 骨架：能拉起服务、握手、显示界面、退出收尸；此时用开发机的 Node 与系统 ffmpeg/Blender。
3. 接入随包 Node，`verify-server-entry.mjs` 用随包 Node 跑一遍。
4. 接入 ffmpeg / Blender，先在未安装这两个工具的环境验证。
5. 最后做打包、签名、公证，产出可分发 `dmg`。

**回滚**：1 与 2 互不依赖，任一步出问题都可单独回退；服务端在未设 `SB_STATE_ROOT` 时行为不变，回滚只需移除 `desktop/` 与相关 scripts。

## Open Questions

- 随包 Node 的版本与 `SB_*` 默认值是否需要在应用内暴露为设置项（而不是只能用 env）。当前按「不暴露」实现，若用户后续要求可再开 change。
