# Proposal

## Why

创意视图的会话、消息流、工具卡片与设置页都由 dsh（DeepSeek Harness）宿主渲染，但宿主目前是 `node_modules` 里的 npm 包（`@deepseek-ai/dsh@0.2.2-rc.5`），对应用是不透明黑盒。代价已经显现：`studio-theme-unification` 为了对齐主题，只能在父页面往宿主 `body` 贴约 25 个变量，再加一个 `MutationObserver` 抵抗宿主回写——这是在 iframe 边界上打补丁，而不是修根因。

要真正改造宿主（主题、布局、工具装配、专家与技能边界），必须先让宿主从“安装的包”变成“本仓库可构建、可修改的源码”，并保证开发与本机运行时都指向同一份构建产物。否则任何对宿主的修改都到不了运行时。

## What Changes

- 以 **git submodule** 纳管 `deepseek-harness`，钉在 `dsh-v0.2.2-rc.5`（`9c2670d`），与应用当前运行时版本一致。`upstream` 保留官方 GitHub，`origin` 指向自有 fork；应用仓库只记录 gitlink，不吸收其 2 万余文件与历史。
- 新增宿主源码构建链：harness 使用仓库声明的 `pnpm@11.28.5`（corepack 代管），构建 `apps/cli/lib` 与各 `packages/*/lib`。应用根目录仍是 npm，两套包管理器各自独立，构建编排由应用脚本显式串联。
- 宿主入口解析从硬编码路径改为**源码树优先、npm 回退**，并支持环境变量覆盖。源码树存在但构建产物缺失时，必须报“源码未构建”，而不是笼统的“未安装宿主”。
- 启动前的运行时校验扩展：除 Node 版本外，还校验宿主构建产物与 pnpm 可用性；不满足时以可读中文错误阻止启动，指明缺什么、怎么补。
- **BREAKING**（开发与 CI）：创意视图不再只依赖 `npm ci`。未初始化 submodule 或未构建宿主时，创意视图不可用，但必须给出可读失败而不是启动崩溃。
- **不纳入**桌面端：`electron-builder` 当前完全不打包 dsh，桌面端创意视图本就不可用；把整棵宿主运行时塞进 `.app` 是独立工程（体积、签名、公证），留待后续变更。

## Capabilities

### New Capabilities

- `dsh-source-runtime`: 宿主运行时的源码供给契约——源码如何纳管与钉版本、构建产物落在哪里、启动入口如何解析、构建缺失如何失败。

### Modified Capabilities

- `creative-dsh-host`: 「运行时基线满足宿主最低版本」由“Node 版本”扩展为“Node 版本 + 与本仓库固定版本一致的源码构建物”；新增“构建产物缺失时给出可读错误并指明补救路径”的要求。

## Impact

- 代码：`server/creative-host.mjs`（入口解析与错误态）、根 `package.json`（构建脚本）、新增 `.gitmodules`。
- 依赖：harness 使用 pnpm 11.28.5；应用继续用 npm 与现有 `package-lock.json`，两者不合并 workspace。
- 仓库：新增一个 submodule 指针；`deepseek-harness/` 不再以未跟踪目录形式出现。
- 资源：本地需额外数 GB 磁盘与一次数分钟的宿主构建。
- 下游变更：`studio-theme-unification` 的 Non-Goal「不引入 dsh 客户端插件构建链」随之失效，主题方案需改为在宿主源码声明层落地。
