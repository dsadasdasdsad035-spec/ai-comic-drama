# 桌面端（macOS）

Electron 外壳 + 随包运行时的 macOS 桌面版。业务逻辑全部在 `server/` 里，和 dev、
独立进程、容器三种形态共用同一份实现；这里只负责「把本地服务拉起来并显示出来」。

## 目录结构

```
desktop/
  main/
    main.mjs            主进程：单实例、userData 固定名、菜单、窗口、导航白名单、退出收尸
    service.mjs         服务进程拉起、stdout 握手、SIGTERM→SIGKILL、随包二进制注入
    data-roots.mjs      用户数据根（projects / media / state），显式 env 优先
  preload/preload.cjs   白名单桥（restartService）
  renderer/             splash.html、error.html、shell.css
  build/
    entitlements.mac.plist  Hardened Runtime 例外清单（逐项附理由）
  licenses/             MIT / GPL-3.0 / GPL-2.0 全文（公证与合规审查用的原始文本）
  scripts/
    fetch-runtime.mjs   下载并校验随包 Node / ffmpeg / Blender
    sign-nested.mjs     由内向外签名嵌套 Mach-O（含 --verify-only）
    after-sign.cjs       electron-builder afterSign → 调 sign-nested
    notarize.mjs        提交公证 + stapler（三种凭据来源）
    notarize-after.cjs  afterAllArtifactBuild → 对 .app/.dmg 逐个公证
    gen-notices.mjs     生成 THIRD-PARTY-NOTICES.md（版本与 fetch-runtime 同源）
  bin/                  ← 下载产物，不进仓库
  dist/                 ← 打包产物，不进仓库
  THIRD-PARTY-NOTICES.md 第三方组件说明（生成物，进仓库）
  electron-builder.yml  打包配置
```

服务启动壳在 `server/desktop-entry.mjs`（不在 `desktop/main/`）：打包后 `desktop/main`
会被打进 asar，而 asar 内的文件对 spawn 出来的纯 Node 子进程不可见；放在 `server/` 下
与 `index.mjs` 同级，开发与打包两种形态路径一致。

## 打包产物结构

```
StoryboardCanvas.app/Contents/Resources/
  app.asar                       只含 desktop/{main,preload,renderer}（约 28K）
  app/
    server/index.mjs             ← ROOT = Resources/app
    server-build/app.mjs
    dist/index.html
    public/presets/
    skills/  scripts/            ← 技能与 Blender host.py，按 appRoot 相对读取
    node_modules/{zod,fflate}    ← server-build 的两个真实外部依赖
    THIRD-PARTY-NOTICES.md  licenses/
  bin/{node,ffmpeg,ffprobe}
  blender/Blender.app            ← 完整第三方应用包，签名由 sign-nested 补
```


## 数据位置

| 内容 | 路径 |
|---|---|
| 项目库（SQLite + 项目目录） | `~/Library/Application Support/storyboard-canvas/projects/` |
| 媒体产物 | `~/Library/Application Support/storyboard-canvas/media/` |
| 运行期状态（作业、草稿、计费库） | `~/Library/Application Support/storyboard-canvas/state/` |

三者由主进程通过 `SB_PROJECTS_DIR` / `SB_MEDIA_ROOT` / `SB_STATE_ROOT` 注入给服务进程。
`Resources/` 是只读的，所以任何写入都不能落在应用包里。

userData 目录名显式钉为 `storyboard-canvas`（`desktop/main/main.mjs` 的 `USER_DATA_NAME`）。
默认取 productName，一旦改产品名，用户数据就会「消失」（其实是换了目录）；钉住后升级与
改名都不影响既有数据，也让开发版与打包版共用同一份数据。

三个根都支持外部显式指定：启动前设置同名环境变量即生效（`resolveDataRoots` 不覆盖已有值），
可以整体搬迁项目库或把媒体放到外置卷。

## 固定版本

| 依赖 | 版本 | 来源 | 校验 |
|---|---|---|---|
| Node | 22.23.5 | nodejs.org `darwin-arm64.tar.gz` | sha256（官方 `SHASUMS256.txt`） |
| ffmpeg | 9.0.2 | osxexperts.net `ffmpeg902arm.zip` | sha256（首次下载时记录） |
| ffprobe | 9.0.2 | osxexperts.net `ffprobe902arm.zip` | sha256（首次下载时记录） |
| Blender | 4.5.9 | download.blender.org `macos-arm64.dmg` | md5（上游只发布 md5） |

`node desktop/scripts/fetch-runtime.mjs` 幂等：已存在且版本一致就跳过，`--force` 强制重下，
`--only node|ffmpeg|ffprobe|blender` 定点更新。下载缓存在 `$TMPDIR/sb-desktop-runtime-cache`。

## 记录：能否用 Electron 内置 Node 替代随包 Node

探针（`ELECTRON_RUN_AS_NODE=1 electron -e "require('node:sqlite')"`）结果：

```
OK node=24.22.2
```

**结论**：可行。Electron 45.3.2 内置 Node 24.22.2，`node:sqlite` 可用，理论上可以省掉
`desktop/bin/node`（约 108MB）。

**但主进程仍按决策 1 优先使用随包 Node**，理由：

1. 服务端用到的 `node:sqlite` 仍是 experimental API，跨大版本会变。跟 Electron 走意味着
   升级 Electron 就可能连带改变服务端行为，而这两件事在发布节奏上本该解耦。
2. 随包 Node 让服务进程能用普通 `node` 调试，不必记 `ELECTRON_RUN_AS_NODE` 这类前置条件。
3. 回退路径已经实现（`desktop/main/service.mjs` 的 `resolveNodeBinary()`），真到要瘦身时
   删掉 `desktop/bin/node` 即可，无需改代码。

## 开发与打包

```bash
npm run desktop:dev     # 直接跑 Electron（服务用 desktop/bin/node；没有则回退 Electron 内置 Node）
npm run desktop:prep    # 前端 + 服务端构建 + 下载随包运行时
npm run desktop:build   # 打包成 .app（不生成安装包）
npm run desktop:dmg     # ad-hoc 签名 + 产 dmg + 跳过公证（本机/内部试装）
npm run desktop:dist    # 生成 dmg 并公证（需要凭据）
```

### 签名与公证

`electron-builder.yml` 里 `mac.hardenedRuntime: true`，例外清单在
`desktop/build/entitlements.mac.plist`。签名分两段：

1. `afterSign` → `sign-nested.mjs` 由内向外补签全部嵌套 Mach-O。Blender.app 内有 204 个，
   加上 Frameworks/helper/随包二进制共 223 个；缺一个就非零退出并指名文件。
2. `afterAllArtifactBuild` → `notarize-after.cjs` → `notarize.mjs` 对 `.app` 与 `.dmg`
   逐个 `notarytool submit --wait` + `stapler staple` + `stapler validate`。

**当前交付形态**：产 dmg（`StoryboardCanvas-0.1.0-arm64.dmg`，约 576MB），不做公证。
因为没有 Developer ID 证书，用 ad-hoc 签名 + `SKIP_NOTARIZE=1` 跳过第 2 段：

```bash
npm run desktop:dmg    # = desktop:prep + ad-hoc 签名 + 产 dmg + 跳过公证
```

跳过时钩子会打出一条醒目警告并列出涉及文件，避免把产物误当成可对外分发的东西。

> ad-hoc 签名只适合本机与内部可信环境：别人下载后首次打开仍会被 Gatekeeper 拦
> （`无法验证开发者`）。对外分发必须提供 Developer ID 证书与公证凭据，
> 用 `npm run desktop:dist` 走完整流程。

**关于 `afterAllArtifactBuild` 的一个坑**：不要用 `platformToTargets.has('darwin')` 做平台判断——
那个 Map 的键是 electron-builder 的 `Platform` 枚举而不是字符串，`has()` 恒为 false，
会把所有产物静默跳过（公证永远不会执行）。现在改为按产物扩展名筛选。

凭据任选一种（详见 `desktop/scripts/notarize.mjs` 头部注释）：

```bash
# A. 存进 keychain（本机手动发布）
xcrun notarytool store-credentials "mac-notary" --apple-id <id> --team-id <team> --password <app-specific-password>
NOTARY_PROFILE=mac-notary npm run desktop:dist

# B. App Store Connect API Key（CI）
APPLE_API_KEY=AuthKey.p8 APPLE_API_KEY_ID=ABC123 APPLE_API_ISSUER=<issuer> npm run desktop:dist

# C. Apple ID + app-specific password
APPLE_ID=<id> APPLE_APP_SPECIFIC_PASSWORD=<pw> APPLE_TEAM_ID=<team> npm run desktop:dist
```

无凭据时 `notarize.mjs` 直接非零退出，不会产出「看起来成功、实际无法分发」的包。
本机没有 Developer ID 证书时可用 `CSC_IDENTITY_AUTO_DISCOVERY=false` 走 ad-hoc 签名，
只用于验证打包结构与只读运行，产物不可分发。

`desktop/THIRD-PARTY-NOTICES.md` 由 `node desktop/scripts/gen-notices.mjs` 生成：版本号取自
`fetch-runtime.mjs` 的固定常量与 `node_modules` 实际版本，避免文档与产物不一致；许可全文
从 `desktop/licenses/` 读取，离线可复现。应用内通过「关于 → 第三方组件说明」打开。

**合规注意**：随包 ffmpeg 是 `--enable-gpl --enable-version3` 构建，按 GPL-3.0-or-later
分发；Blender 是 GPL-2.0-or-later。两者都以独立进程/独立应用形式随包，未与本项目链接。
若需要避开 GPL，可把 `fetch-runtime.mjs` 的 ffmpeg/ffprobe 换为 `--disable-gpl` 的 LGPL 构建
（替换点只有该文件的对应条目），`gen-notices.mjs` 里的许可证标识需同步。

验收：

```bash
node verify-desktop-host.mjs   # 启动、单实例、退出收尸、崩溃恢复、强杀自愈
node verify-state-root.mjs     # 状态根与 appRoot 隔离
node verify-blender-host.mjs   # 随包 Blender 渲染（并发、贴图、取消、语法错误行号）
```
