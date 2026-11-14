# Tasks

## 1. 运行期状态根（服务端前置）

- [x] 1.1 `server/paths.mjs` 新增 `resolveStateRoot(root)`、`statePath(root, rel)`、`ensureStateDir(root, rel)`，解析顺序为 `SB_STATE_ROOT` > 传入的 `root`，沿用 `mediaPath` 的越界校验写法；扩写 `verify-paths.mjs` 断言四件事：未设 env 时指向 `root`、设 env 时指向该路径、`../` 穿越被拒、`statePath` 自动创建父目录。验证：`node verify-paths.mjs` 全绿且断言数增加 4 条。
- [x] 1.2 把六处运行期目录改为从状态根解析：`server/agentHost.mjs`（`.agent-jobs`）、`server/blender.mjs`（`.blender-jobs`）、`server/vggt.mjs`（`.vggt-jobs`）、`server/scene-draft.mjs`（`.scene-drafts`）、`server/project-lifecycle.mjs`（`.scene-drafts`）、`server/billing/db.mjs`（`data/`）。验证：`rg -n "path\.join\((appRoot|root), '\." server/*.mjs server/billing/*.mjs` 不再命中状态目录字面量。
- [x] 1.3 定位 `.publish-profiles/` 的实际写入点并接入 `statePath`。**结论：无写入点。** 发布台与成片分发 API 已在 `0f21f45`（2026-11-09「收敛 Agent 聊天并移除发布台」）整体删除，`server/` 与 `src/` 中不再有任何代码创建该目录；磁盘上的 `projects/.publish-profiles/` 是空的历史残留。因此本任务无可改动代码，只记录结论：若将来重建发布功能，profile 目录应按「未配置时回退、配置时落到状态根」的同一约定接 `statePath`，不要新起一套解析。验证：`rg -n "publish-profiles" --glob '!node_modules' --glob '!openspec/**' .` 仅命中文档与 `scripts/cleanup-orphan-media.mjs` 的排除项，`server/` 与 `src/` 无命中。
- [x] 1.4 加一条「状态根与 appRoot 隔离」的断言：设 `SB_STATE_ROOT` 到临时目录后跑一次会写作业与草稿的接口，比较 appRoot 目录快照证明没有新增隐藏目录。验证：`node verify-state-root.mjs` 全绿（6 条：草稿与 job 接口成功、两者都落在状态根内、仓库根无新增目录、状态目录未出现在仓库根）。**注意：`server-build/app.mjs` 内联了 `paths.mjs`，改动服务端路径后必须先 `npm run build:server` 再跑集成断言，否则测到的是旧 bundle。**
- [x] 1.5 确认 dev 与容器行为零变化：不设 `SB_STATE_ROOT` 时 `.agent-jobs` 等仍在仓库根。验证：不设 `SB_STATE_ROOT` 时 `verify-project.mjs`（24/0）与 `verify-canvas.mjs`（全部通过）在 dev `:5273` 与独立入口 `:56891` 双双全绿，`.blender-jobs` / `.vggt-jobs` 仍出现在仓库根，确认默认回退路径未变。

## 2. Electron 宿主骨架

- [x] 2.1 建 `desktop/` 目录结构（`main/`、`preload/`、`renderer/`），`package.json` 增加 `electron` 与 `electron-builder` 开发依赖，新增 `desktop:dev`、`desktop:build`、`desktop:dist` 脚本；`.gitignore` 增加 `desktop/dist`、`desktop/bin`。验证：`npm run desktop:dev` 能启动窗口并渲染启动画面（Playwright 探测：标题「正在启动」、`splash.html`、h1「正在启动本地服务」、spinner 可见、背景 `rgb(16,16,18)`）。Electron 45.3.2 内置 Node 24.22.2，`node:sqlite` 可用。
- [x] 2.2 主进程启动序列：`app.requestSingleInstanceLock()`，拿不到锁就 `app.quit()`；`second-instance` 事件聚焦并还原已有窗口。验证：第二个实例 0.65s 内以退出码 0 结束，Electron 主进程数始终为 1，服务进程数保持 3（启动前后一致，未新增），确认第二个实例没有拉第二个服务进程。
- [x] 2.3 实现服务进程拉起：`SB_PORT=0` 启动，`readline` 逐行匹配 `^\[server\] listening http://(.+):(\d+)$`，30 秒超时；超时或进程提前退出都按启动失败处理。验证：`desktop/main/service.mjs` 用 `SB_PORT=0` 拉起、`readline`-式逐行解析 `[server] listening http://host:port`、30 秒超时；启动失败时 `main.mjs` 加载 `error.html` 并带上失败摘要与日志尾部。实测两点：正常启动时窗口加载 `http://127.0.0.1:58041/#/`（真实应用界面，非白屏）；把 `server/index.mjs` 临时改名后，错误页显示标题「本地服务启动失败」、日志「缺少服务入口：…/server/index.mjs」、重启按钮可见。
- [x] 2.4 窗口安全配置：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，`will-navigate` 与 `setWindowOpenHandler` 把非本机服务地址的导航交给 `shell.openExternal`。验证：`getLastWebPreferences()` 三项均为期望值（contextIsolation=true / nodeIntegration=false / sandbox=true），渲染进程 `typeof require === 'undefined'` 且 preload 白名单 `window.desktop.restartService` 可用；`window.location.href='https://example.com/'` 被拦下（窗口仍停在本地 origin）；`target=_blank` 外链点击后 `shell.openExternal` 收到该 URL、窗口数仍为 1。
- [x] 2.5 启动画面与错误页：`desktop/renderer/splash.html` 用 `loadFile` 显示，握手成功后 `loadURL` 切到服务地址；失败时加载 `error.html` 并带错误摘要与日志尾部。验证：启动初期窗口 URL 为 `file://…/desktop/renderer/splash.html`（标题「正在启动」），握手后变为 `http://127.0.0.1:58491/#/`（标题「分镜画布 · Storyboard Canvas」）且 spinner 消失；失败路径（2.3 的改名测试）在 `#title` 显示「本地服务启动失败」、`#log` 显示「缺少服务入口：…」。
- [x] 2.6 退出收尸：`before-quit` 与 `window-all-closed` 统一走「SIGTERM → 等待 5 秒 → SIGKILL」，退出前 `event.preventDefault()` 直到子进程结束；主进程被强杀时由子进程侧看门狗自己退出（`desktop/main/service-entry.mjs` 监听 `SB_DESKTOP_PARENT_PID`），满足 spec 的「应用被强杀」场景。验证：`kill -9` 主进程后 5 秒内该端口不再监听；正常退出后 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 为空。
- [x] 2.7 服务崩溃恢复：监听子进程 `exit`，非主动退出时把窗口切到断连页并提供「重启服务」，重启成功后重新加载原 hash 路由。验证：在 `#/p/route-probe/shots` 下 `kill -9` 服务进程，窗口切到断连页（标题「本地服务已断开」、重启按钮可见）；点「重启服务」后新 origin 加载完成，hash 恢复为 `#/p/route-probe/shots`。实现见 `main.mjs` 的 `lastRoute` 记忆 + `desktop:restart-service` IPC。
- [x] 2.8 写 `verify-desktop-host.mjs`，用 `playwright-core` 的 `_electron.launch()` 覆盖：正常启动进到应用界面、单实例、退出后无残留端口、崩溃后重启。验证：`node verify-desktop-host.mjs` 5/5 全绿（启动画面→界面、单实例、退出无残留端口、崩溃→断连页→重启回原路由、强杀主进程后服务自动退出）。

## 3. 随包运行时与二进制

- [x] 3.1 用 `ELECTRON_RUN_AS_NODE=1` 跑一次 `node -e "require('node:sqlite')"` 的记录性检查，把结论写进 `desktop/README.md`；无论结论如何，主进程仍按决策 1 使用随包 Node。验证：结论记入 `desktop/README.md`「能否用 Electron 内置 Node 替代随包 Node」——`ELECTRON_RUN_AS_NODE=1 electron -e "require('node:sqlite')"` 返回 `OK node=24.22.2`，可行；仍按决策 1 用随包 Node，回退路径已实现。
- [x] 3.2 增加 `desktop/scripts/fetch-runtime.mjs`：按固定版本下载官方 Node 22 macOS arm64 二进制到 `desktop/bin/node`，校验 sha256，已存在则跳过；同时在 `desktop/README.md` 记录固定版本号。验证：下载到 `desktop/bin/node` 后 `-v` 为 `v22.23.5`（与 README 记录一致，sha256 校验通过）；重跑脚本输出「node 已是 v22.23.5，跳过」，幂等成立。
- [x] 3.3 主进程改用 `desktop/bin/node` 启动服务。验证：`env -i PATH=/usr/bin:/bin` 下用绝对路径 node 跑 `verify-desktop-host.mjs`，5/5 全绿；服务进程命令行为 `desktop/bin/node …/service-entry.mjs`。
- [x] 3.4 `server/ffmpeg-host.mjs` 与 `server/blender.mjs` 的候选列表各增加一条「随包位置」——取自「当前 Node 可执行文件同目录」，打包后即 `Contents/Resources/`，开发时即 `desktop/bin/`（见 design 决策 3 的扁平 `extraResources`），env 仍保持最高优先级。验证：用 `desktop/bin/node` 跑 `resolveFfmpeg()` 返回 `desktop/bin/ffmpeg` 与 `desktop/bin/ffprobe`（同机存在 `/opt/homebrew/bin/ffmpeg`，确认是随包优先而非 PATH 命中）。
- [x] 3.5 `desktop/scripts/fetch-runtime.mjs` 增加 ffmpeg/ffprobe 下载与校验（osxexperts.net 9.0.2 arm64，sha256 校验），落在 `desktop/bin/ffmpeg`、`desktop/bin/ffprobe`；主进程 `bundledRuntimeEnv()` 注入 `FFMPEG_PATH`/`FFPROBE_PATH`。验证：桌面端 `/api/health` 回显 `ffmpegPath=/…/desktop/bin/ffmpeg`；用随包 ffprobe 读出 320x180/15 帧，用随包 ffmpeg 抽出 `frame-001.png`。
- [x] 3.6 增加 Blender 的下载与校验（download.blender.org 4.5.9 arm64 dmg，md5 校验，`hdiutil attach` + `ditto` 解包以保留包结构），解包到 `desktop/bin/blender/`；主进程 `bundledRuntimeEnv()` 注入 `BLENDER_BIN`。验证：`/api/blender/health` 返回 `ok:true, version:4.5.9`，`verify-blender-host.mjs` 17 项全通过（并发排队、产物 mp4 + 关键帧、素材贴图、取消清理、语法错误行号）。
- [x] 3.7 路径健壮性：把应用放到含空格与中文的目录下启动。验证：复制到 `/tmp/桌面 应用 测试/app` 后启动，服务正常握手；`ffmpegPath` 为 `/private/tmp/桌面 应用 测试/app/desktop/bin/ffmpeg` 且成功抽出 `f-01.png`；`/api/blender/health` 为 `ok:true 4.5.9`，一次白模渲染 `status=done`，产出 mp4 与 3 张关键帧。

## 4. 打包、签名与公证

- [x] 4.1 `desktop/electron-builder.yml`：`extraResources` 把 `server/`、`server-build/`、`dist/`、`public/presets/`、`node_modules/{zod,fflate}` 映射到 `Contents/Resources/app/` 并保持相对结构；二进制放 `Resources/bin` 与 `Resources/blender`。**补入任务未列但运行必需的两项**：`skills/`（`server/skills.mjs` 按 appRoot 读）与 `scripts/`（`server/blender.mjs` 读 `scripts/blender/host.py`）。asar 只装 `desktop/{main,preload,renderer}`（28K）。验证：打包后 `Resources/app/server/index.mjs`（7063B）与 `Resources/app/dist/index.html`（1480B）同时存在；`Resources/bin/{node,ffmpeg,ffprobe}`、`Resources/blender/Blender.app` 就位；asar 内无业务代码。
- [x] 4.2 确认 `server-build/app.mjs` 只依赖 `zod` 与 `fflate`；若新增外部依赖，`4.1` 的映射清单必须同步。验证：`rg -o 'from "[^."][^"]*"' server-build/app.mjs` 去重后只有 `fflate`、`zod`；两者 `dependencies` 均为空（零依赖闭包），与 `4.1` 映射清单一致。
- [x] 4.3 写 `desktop/scripts/sign-nested.mjs`：由内向外遍历应用包内全部 Mach-O（含 Blender 包），逐个 `codesign --force --options runtime --entitlements`，最后签 `.app` 本体；步骤结束时校验每个文件都有有效签名，缺一个就让脚本非零退出（附 `--verify-only` 供发布前复查）。扫描范围修正为整个 `Contents/`（首版只扫 `Resources/` 会漏 `Contents/Frameworks/` 下的 Electron Framework 与 Helper）。验证：真实打包签名 223 个文件全通过（Blender 204 + 其余 17 + 本体）；对副本 `codesign --remove-signature` 掉内层 `libinner.dylib` 后 `--verify-only` 指名该文件并非零退出（退出码 1），同时外层 4 个文件级联失效，证实必须由内向外。
- [x] 4.4 打包配置开启 Hardened Runtime 与指定 entitlements，接入公证（`notarytool`）与 `stapler`；`afterSign` 调用 `4.3`。
  - 已实现：`mac.hardenedRuntime: true` + `desktop/build/entitlements.mac.plist`（JIT/可执行内存/库校验豁免/继承/文件与网络权限，逐项附理由）；`afterSign` → `sign-nested.mjs`；`afterAllArtifactBuild` → `notarize-after.cjs` → `notarize.mjs`（支持 keychain profile / ASC API Key / app-specific password 三种凭据，`--wait` 后 `stapler staple` + `validate`，失败会拉 `notarytool log` 给出可读原因，无凭据时非零退出而不是静默跳过）。
  - 已产出 dmg：`StoryboardCanvas-0.1.0-arm64.dmg`（576MB，ULFO）。挂载到 `/Volumes/分镜画布` 后核对：`Applications` 符号链接正确、`Resources/{app/server/index.mjs, app/dist/index.html, bin/node, blender/Blender.app, app/THIRD-PARTY-NOTICES.md}` 全部就位、`codesign --verify --deep --strict` 通过、卷确为只读（写入失败）；**直接从只读挂载卷启动应用**进界面正常，`ffmpegPath` 指向挂载卷内 `bin/ffmpeg`，Blender 渲染 `done` 出 3 张关键帧；应用包内新增 0 / 变更 0。
  - 修复了一个会让公证永远不执行的缺陷：`afterAllArtifactBuild` 原来用 `platformToTargets.has('darwin')` 判断平台，而该 Map 的键是 electron-builder 的 `Platform` 枚举而非字符串，`has()` 恒为 false → 所有产物被静默提前返回。改为按扩展名筛选；并用「不设 `SKIP_NOTARIZE` 时钩子必然非零退出」反向确认公证链路真的会触发。
  - **公证未执行（客观前提）**：本机 `security find-identity` 为 0 个有效身份、`notarytool` 无凭据。交付用 `npm run desktop:dmg`（`CSC_IDENTITY_AUTO_DISCOVERY=false` + `SKIP_NOTARIZE=1`），钩子会打印醒目警告并列出文件。因此 `stapler validate` 未验证。
  - **与 spec 的偏离（需知悉）**：`specs/desktop-app-packaging` 要求「MUST 通过公证 / 未开启任何来源也能打开」。当前 ad-hoc 签名产物在他人机器上首次打开仍会被 Gatekeeper 拦。对外分发须提供凭据后跑 `npm run desktop:dist`。
- [x] 4.5 产出 `desktop/THIRD-PARTY-NOTICES.md`（由 `desktop/scripts/gen-notices.mjs` 生成，版本号与 `fetch-runtime.mjs` 同源，避免文档腐化）：列出随包 Electron、Node、ffmpeg/ffprobe、Blender、`zod`、`fflate` 的版本、来源 URL 与许可证全文（MIT / GPL-3.0-or-later / GPL-2.0-or-later 附录全文，许可原文入库 `desktop/licenses/`）；Blender 一节给出 `download.blender.org/source` 与 git tag 途径。**ffmpeg 实测为 `--enable-gpl --enable-version3` 构建，按 GPL-3.0-or-later 如实记录并附替换为 LGPL 构建的方法**。验证：文件 56KB 打进 `Resources/app/THIRD-PARTY-NOTICES.md` 且 `licenses/` 同目录；应用菜单「关于 → 第三方组件说明」用系统默认应用打开；`rg` 能查到 22.23.5 / 9.0.2 / 4.5.9 / 4.6.7 / 0.8.2 / 45.3.2 全部版本号。
- [x] 4.6 主进程计算 `app.getPath('userData')` 下的 `projects/`、`media/`、`state/` 并注入三个环境变量；首次启动自动建目录。**userData 目录名显式钉为 `storyboard-canvas`**（默认取 productName，改名会让用户数据"消失"，也保证 dev 与打包版共用数据）。验证：`rm -rf ~/Library/Application Support/storyboard-canvas` 后启动打包产物仍进界面，`projects/`、`media/`、`state/` 三个子目录自动创建，同名项目写入 `projects/storyboard.sqlite`（项目名可在表中查到）。
- [x] 4.7 验证只读运行：把 `.app` 复制到一个随机只读目录（模拟 App Translocation）后启动。验证：`ditto` 复制到 `/tmp/ro-app-test/` 后 `chmod -R a-w`（向 `Resources/` 写文件确实失败），启动进界面；建项目返回 200；Blender 渲染 `status=done` 产出 mp4 与 3 张关键帧；`Resources/` 快照对比新增 0、变更 0。

## 5. 集成验证

- [x] 5.1 在未装 Node、未装 ffmpeg、未装 Blender 的干净 macOS 用户下安装并跑通主链路：建项目 → 生成一张图 → 抽帧 → 3D 白模 → 导出。验证：以 `PATH=/usr/bin:/bin` 启动打包产物（已确认该 PATH 下 `node`/`ffmpeg`/`ffprobe`/`blender` 全部不存在），`ffmpegPath` 指向 `Contents/Resources/bin/ffmpeg`；建项目 200 → 生成图 200（产出 `design-*.jpg`）→ 3D 白模 `done`（产 mp4）→ 抽帧 200（2 张 sched-*.jpg）→ 导出 200（`animatic-480p-*.mp4`，shots=1）；`media/{exports,videos,generated}` 均有产物，全程无「命令不存在」/ENOENT。
- [x] 5.2 用打包产物承载的服务跑既有验收脚本：`SB_URL=http://127.0.0.1:<port> node verify-canvas.mjs`、`verify-project.mjs`、`verify-settings-db.mjs`。验证：dev 基线 canvas 8/8、project 24/24、settings 18/18 全绿；打包产物（`Resources/bin/node` + 随包二进制，数据根经 `SB_PROJECTS_DIR`/`SB_MEDIA_ROOT`/`SB_STATE_ROOT` 指向与 dev 相同的目录）同为 8/8、24/24、18/18，结果一致。**顺带修复两处既有问题**：`desktop/main/data-roots.mjs` 之前会无条件覆盖外部传入的数据根（违反 spec「用户自定义数据位置优先」），改为显式 env 优先；`verify-settings-db.mjs` 把「目标模型」硬编码为 `deepseek-chat`，当仓库默认值已是该模型时表单不 dirty、保存按钮 disabled 导致超时，改为动态挑选一个与当前不同的渠道。
- [x] 5.3 升级不丢数据：用旧安装包建项目并生成产物，覆盖安装新安装包。验证：把打包产物复制到 `/tmp/upgrade-test/` 充当已安装旧版本，在其中建 `upgrade-probe` 项目、Blender 渲染出 mp4（产物落 userData/media）；随后重新打包并用新 `.app` 覆盖同一位置；新版本启动后项目仍可见、渲染产物文件仍在、`defaults.text`（`minimax-text`）与升级前一致、模型条目数 34 = 34。
- [x] 5.4 `openspec validate desktop-shell-electron --strict` 通过。验证：退出码 0，输出仅 `Change 'desktop-shell-electron' is valid`，无 warning。

## Workflow follow-up

- 落地顺序按 `design.md — Migration Plan`：先合状态根，再合宿主骨架，最后做打包签名；前三组不依赖签名即可验收。
- `desktop-runtime-binaries` 的随包 Blender 若在公证环节无法满足 Hardened Runtime，需回到本 change 修改要求（改为引导用户安装），并与用户确认后再调整 spec。
- Windows / Linux 打包、自动更新、本地模式（跳过登录计费）各自另开 change。
