# Design

## Context

见 `proposal.md` 的 Why。这里只列影响方案形状的现状与约束。

**运行时的装配方式**决定了“源码能不能直接被用”：

- `server/creative-host.mjs` 只认 `node_modules/@deepseek-ai/dsh/lib/bin.js`，无 env 覆盖。
- 宿主启动后，`apps/cli/src/profile-boot.ts` 把 `apps/cli/package.json` 当作 `INSTALL_ANCHOR`；`packages/boot/app-boot/src/profile.ts` 从该锚点出发，沿 `dependencies` / `peerDependencies` / `optionalDependencies` 做 BFS，用 Node 的解析规则逐个定位包目录。pnpm workspace 的 `node_modules` 是符号链接，因此 BFS 会把每个 `@deepseek-ai/dsh-*` 解析回 `packages/*` 源码目录。
- 结论：**源码树可以直接跑**，前提是被 BFS 命中的包都有构建产物（`package.json` 的 `main`/`exports` 指向 `lib`）。

**工具链现状**：

| 项 | 应用 | harness |
|---|---|---|
| 包管理器 | npm + `package-lock.json` | pnpm `11.28.5`（corepack） |
| Node | 运行时要求 ≥ 24.9 | `^22.19.0 \|\| >=24.0.0` |
| 构建 | vite + esbuild | `tsc`（host，8 GB 堆）+ tsdown/lightningcss（client） |
| 产物 | `dist/`、`server-build/` | `apps/cli/lib`、`packages/*/lib` |

**资源约束**：clone 后仓库 244 MB、约 2.1 万文件；本机当前可用磁盘 6.5 GB。仓库自带的 `build:lib:host` 显式要求 8 GB 堆。

**部署现状**：本变更只覆盖本机运行，不动 `Dockerfile` 与部署链路。`desktop/electron-builder.yml` 的 `extraResources` 只拷 `zod`/`fflate`/`nodemailer`，**不含 dsh**——桌面端创意视图本来就不可用。

## Goals / Non-Goals

**Goals:**

- 宿主运行时来自本仓库钉住的源码版本：开发与本机运行时指向同一份构建产物。
- 源码化失败时应用整体仍可启动，创意视图给出可读失败；npm 回退路径保留。
- 升级路径是可操作的：换 tag、rebase 本地补丁、重跑验证，而不是“重新解包一份源码”。

**Non-Goals:**

- 不合并 workspace：不把 harness 变成 npm workspace，也不让应用改吃 pnpm。
- 不把宿主运行时打进桌面端（独立工程：体积、签名、公证）。
- 不改动部署镜像（`Dockerfile`）与部署链路：本机调试不需要它，等真的要上服务器时单独立项。
- 不在此变更修改任何宿主行为（主题、布局、工具）；那属于下游变更。
- 不追求与上游零差异：允许保留 fork 补丁，但补丁要有边界与记录。

## Decisions

### D1：submodule 纳管，钉 tag 而非 master

`deepseek-harness` 作为 submodule，`upstream` 指官方 GitHub，`origin` 指自有 fork。submodule 的 commit 固定为 `dsh-v0.2.2-rc.5`（`9c2670d`），与应用 `package.json` 里的 `@deepseek-ai/dsh` 版本一一对应。

替代方案：直接入库（丢上游历史、仓库膨胀 244 MB，否决）；独立目录 + SHA 记录（CI 需额外 clone，IDE 不在同一工作区，否决）。

本地补丁放在 fork 的 `patch/<版本>` 分支，禁止直接在 detached HEAD 上改；升级 = 检出上游新 tag → rebase `patch/*` → 重跑验证。

### D2：入口解析三级优先，失败原因必须可区分

```
DSH_ENTRY（显式覆盖，绝对路径）
   ↓ 未设置
<root>/deepseek-harness/apps/cli/lib/bin.js（源码树，需已构建）
   ↓ 不存在
<root>/node_modules/@deepseek-ai/dsh/lib/bin.js（npm 回退）
```

失败文案分三种，不能合并成“未安装宿主”：

| 情况 | 文案要点 |
|---|---|
| submodule 未初始化（目录存在但空） | 提示 `git submodule update --init` |
| 源码在但 `lib/bin.js` 缺失 | 提示执行宿主构建（给出 npm script 名） |
| 两者都没有 | 提示 `npm ci` 或初始化源码并构建 |

替代方案：用符号链接把源码树塞进 `node_modules`。否决——`npm ci` 会清空 `node_modules`，链会断；且 `package-lock.json` 与实际来源不一致，排查困难。

### D3：两套工具链各自独立，用显式脚本串联

- 应用根：继续 `npm`，`npm ci` 语义不变。
- harness：`corepack pnpm@11.28.5 install --frozen-lockfile`，再 `pnpm run build:lib`（host + client）、`pnpm --filter @deepseek-ai/node-addon-system-workspace run build:native`（flock / landlock 原生模块）与 `pnpm run build:web`（vite 构建壳页面）。
  后两步容易漏：宿主的壳页面来自 `@deepseek-ai/dsh-web-frontend` 的 `dist/index.html`，只跑 `build:lib` 时宿主能启动，但 `/` 返回 404，表现为「反代测试通过、壳页面打不开」；原生模块不在源码树里，源码安装又不带预编译包，少了它页面一切正常，**开一轮会话就报 `Cannot find module .../packages/<平台>/bin/system.node`**。
- 新增应用脚本 `build:dsh` 封装上述四步，并在结束时校验 `apps/cli/lib/bin.js`、`apps/web/dist/index.html` 与本平台 `native/system/packages/<平台>/bin/system.node`；`npm run build` **不**隐式触发它（避免日常前端构建被 8 GB 的 tsc 拖死），但 `prestart` 级别的校验要能感知产物缺失。

替代方案：把 harness 加进根 `package.json` 的 workspaces。否决——`workspace:*` 是 pnpm 协议，npm workspaces 不认；混用会让 `npm ci` 直接失败。

### D4：部署镜像不在本次范围

应用目前只在本机运行（`npm run dev` / `npm start`），部署链路（`Dockerfile`、`docker compose`）本次不动。因此本变更不引入镜像内的 pnpm 构建阶段，`docs/creative-host.md` 也不写镜像方案。

留待后续立项的事实（已验证，避免重走弯路）：`pnpm deploy --prod` 的产物**不能**直接当宿主入口——默认与 `--legacy` 模式缺 `@deepseek-ai/dsh-web-frontend` 与 peer 依赖，启动报 `ERR_MODULE_NOT_FOUND: @deepseek-ai/cordis-plugin-group`；`--config.node-linker=hoisted` 则分别卡在 `ERR_PNPM_IGNORED_BUILDS` 与 `ERR_PNPM_UNUSED_PATCH`。真要做镜像时，最省事的是把本机构建好的整棵闭包拷进运行层。

### D5：`DSH_HOME` 与 profile 装配保持不变

宿主的会话、专家、profile 仍在 `<SB_STATE_ROOT>/dsh/`，`server/dsh-bundle.mjs` 写 profile 清单的逻辑不动。源码化只改变“宿主程序从哪来”，不改变“宿主状态放哪”。

profile 里 `file:` 依赖的安装由 harness 内部 plugin manager 调 pnpm 完成（`pnpm-missing` 是它的显式失败态）。当前应用靠直接拷贝插件目录避免运行期安装，因此运行期不强制装 pnpm；若后续启用运行期插件安装，需要另补这一层，不在本变更解决。

### D6：桌面临时排除，但必须显式说明

桌面端 `extraResources` 不新增 dsh 条目。构建脚本与文档要写明：桌面端创意视图不可用是现状，不是本次回归。后续若要把宿主打进 `.app`，应单独立项（体积与公证是主要成本）。

## Risks / Trade-offs

- [磁盘不足导致 `pnpm install` 或构建中断] → `scripts/build-dsh.mjs` 在低于 8 GiB 时先告警；pnpm store 复用已下载的包。
- [BFS 跳过“声明但未安装”的依赖而不报错] → 源码注释明确写了 `skip rather than fail`，缺包会静默少插件；实测声明了但解析不到的 bundle 还会让宿主打印 ready 后以 0 退出。应用侧改为收集 stderr 的 `skipping profile bundle` 行，与 profile 清单比对，并把缺失项塞进失败/退出文案。
- [上游升级冲突] → 补丁集中在 `patch/<版本>` 分支，改动尽量落在独立文件或可定位的区块；升级后重跑 `npm run test:studio` 全部用例。
- [构建机内存要求 8 GB 堆] → 写入文档；内存不足时 tsc 会被 OOM 杀掉，表现为 `JavaScript heap out of memory`。

## Migration Plan

1. 把当前未跟踪的 `deepseek-harness/` 转为 submodule：先移出目录，`git submodule add <fork-url> deepseek-harness`，再切到钉住的 tag；本地补丁另开分支。
2. 本地 `corepack enable`，按锁定版本安装并 `build:lib`，确认 `apps/cli/lib/bin.js` 存在。
3. 改 `resolveDshEntry` 为三级解析与三种错误文案；保留 npm 回退。
4. 手工验证：创意视图可打开、一轮会话可完成、主题桥仍生效；跑 `npm run test:studio`。
5. 回滚：设置 `DSH_ENTRY` 指回 `node_modules/@deepseek-ai/dsh/lib/bin.js` 即可回到现状；submodule 可保留不初始化，不影响 `npm ci`。

## Open Questions

- 无。部署镜像已移出本变更范围（见 D4）。
