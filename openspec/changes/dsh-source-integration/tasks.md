# Tasks

## 1. 源码纳管与版本钉定

- [x] 1.1 将 `deepseek-harness` 以 git submodule 形式纳管，钉在 `dsh-v0.2.2-rc.5`（`9c2670d`），`origin` 指向自有 fork、`upstream` 保留官方仓库；验证：`git submodule status` 输出的 commit 与 `git ls-remote --tags` 中该 tag 一致，且 `git status` 不再出现未跟踪的源码目录
- [x] 1.2 在新克隆的工作副本上验证初始化路径：`git submodule update --init --recursive` 能拉出源码树；验证：在干净目录执行后 `deepseek-harness/apps/cli/package.json` 存在且版本号为 `0.2.2-rc.5`
- [x] 1.3 记录本地补丁的承载方式（`patch/<版本>` 分支）与升级流程到 `docs/creative-host.md`；验证：文档中的升级步骤可被他人按序执行，且不产生 detached HEAD 上的提交

## 2. 宿主构建链

- [x] 2.1 用 corepack 启用并固定 `pnpm@11.28.5`，在 `deepseek-harness` 内以 `--frozen-lockfile` 安装；验证：`corepack pnpm --version` 输出 11.28.5，安装后 `pnpm-lock.yaml` 无改动（`git -C deepseek-harness status --short` 为空）
- [x] 2.2 在应用根 `package.json` 新增 `build:dsh` 脚本封装“安装 + `build:lib`”两步，且 `npm run build` 不隐式触发它；验证：执行 `npm run build:dsh` 后 `deepseek-harness/apps/cli/lib/bin.js` 存在，执行 `npm run build` 时不出现宿主编译日志
- [x] 2.3 校验构建产物的包完整性：逐个确认被 CLI 依赖的 `@deepseek-ai/dsh-*` 包目录下都有 `lib/index.js` 或 `lib/client.js`；验证：`node scripts/check-dsh-artifacts.mjs` 遍历 CLI 清单，91 个依赖全部可解析
- [x] 2.4 在文档中写明宿主构建的内存与磁盘要求（host 编译 8 GB 堆）及失败表现；验证：`docs/creative-host.md` 的「构建资源要求」表格覆盖磁盘 8 GiB、8 GB 堆、耗时与四类失败现象
- [x] 2.5 把原生模块编进构建链：`build:dsh` 增加 `build:native`（flock / landlock）并校验本平台 `native/system/packages/<平台>/bin/system.node`；验证：缺该产物时创意视图一轮会话报 `Cannot find module .../bin/system.node`，补跑 `build:native` 后同一轮会话不再报模块加载失败

## 3. 入口解析与失败语义

- [x] 3.1 将 `server/creative-host.mjs` 的 `resolveDshEntry` 改为三级解析：显式覆盖（`DSH_ENTRY`）→ 源码构建产物 → 已安装包；验证：`tests/dsh-entry-resolution.mjs` 分别覆盖三级优先级，断言返回路径与来源
- [x] 3.2 实现三种失败文案的分支（源码未初始化 / 源码存在未构建 / 两者都没有），每种携带对应补救命令；验证：同上单测断言三种文案互不相同且分别包含 `submodule update --init`、`build:dsh`、`npm ci`
- [x] 3.3 保证入口不可用时宿主的启动流程不抛出未捕获异常；验证：`tests/dsh-entry-resolution.mjs` 在三种缺失状态下调用 `createCreativeHost().start()`，断言返回 false、state=failed 且错误文案可读，不抛异常
- [x] 3.4 扩展运行时自检：除 Node 版本外校验宿主构建产物版本与钉定版本一致；验证：单测覆盖“版本一致 / 不一致 / 产物缺失”三态，不一致时返回可读错误

## 4. 宿主插件集合校验

- [x] 4.1 启动后核对宿主实际启动的插件层：从宿主 stderr 的 `skipping profile bundle` 自述行收集被跳过的层，与 profile 清单声明的层比对，缺项即报告（`profileContext.startedBundles` 在宿主进程内，应用侧读不到，改用等价的实际运行时信号）；验证：单测注入伪造的跳过记录与预期清单，断言报告出缺失的插件标识
- [x] 4.2 把缺失报告接到创意视图的错误态上，携带可读原因；验证：手工移除一个 profile 层后启动宿主，创意视图显示缺失插件名，其它视图不受影响

## 5. 集成验证

- [x] 5.1 本地全量验证：`npm run test:studio` 全绿，重点确认工具桥、专家、技能、主题相关用例未回归；验证：命令退出码为 0
- [x] 5.2 手工走查创意视图：打开会话、完成一轮含工具调用的对话、切换明暗主题；验证：三项均可复现成功，且宿主题在 `body` 上生效（不出现两种黑）
  - 打开会话：创意视图加载即建立会话通道（WS 连上、工作区与模型可选、输入框可用），新建会话后消息送达并注入上下文。
  - 一轮含工具调用：模型 `sb/ark-plan-text-lite` 真实回合里调用了 `read_episodes`，返回结果被模型读取并给出一句人类可读回复（32 秒、42K tok、81 tok/s）。
  - 主题：切到日间后宿主 `body` 上的 `--dsw-alias-bg-base` 由 `#070b11` 变 `#f4f1ea`，与应用底色一致。
  - 附带发现（未处理，属既有实现）：工具桥的 `project` 只从工具入参或插件 config 取，应用顶栏选中的项目不会传进宿主，所以这次 `read_episodes` 拿到的是「当前顶栏没有选中任何项目」的业务错误而非集数。
- [x] 5.3 验证回滚路径：设置 `DSH_ENTRY` 指回已安装包后重启；验证：创意视图恢复为当前行为，应用其它功能不受影响
- [x] 5.4 验证桌面端不受影响：桌面打包产物不含宿主运行时，创意视图给出可读不可用说明；验证：`npm run desktop:build` 成功，打开桌面端不崩溃
  - 产物核验：`Resources/app` 下没有 `deepseek-harness/`，`app/node_modules` 只有 `zod`/`fflate`/`nodemailer`。
  - 运行核验：`StoryboardCanvas.app` 起得来、本地服务监听并首页 200；`/studio/_host/status` 返回 `entrySource: "none"` 与可读原因（缺源码产物与安装包，附 `git submodule update --init --recursive` + `npm run build:dsh` / `npm ci` 两条补救命令）。
  - 顺带修掉一处既有打包缺陷：`server/db.mjs` 运行时 `import '../src/promptAuditCore.mjs'`，而 `desktop/electron-builder.yml` 只打包 `dist/`，导致桌面端本地服务一启动就 `ERR_MODULE_NOT_FOUND`；已补 `src/promptAuditCore.mjs → app/src/`，重新打包后服务正常监听。
- [x] 5.5 修复宿主 0.2.2-rc.5 的 Origin 围栏与反代前缀的冲突：`/studio/` 反代转发时把 `Origin` 一并换成上游 authority（`null` 等不透明来源不改写），否则浏览器带来的 `Origin` 与改写后的 `Host` 不一致，WebSocket 升级被宿主 403 拒绝、创意视图停在「重新连接中」；验证：`tests/studio-proxy.mjs` 断言 HTTP 与 WS 两种转发下上游收到的 Origin 均为上游 authority，且 `null` 原样透传

## Workflow follow-up

- 归档前更新 `studio-theme-unification`：其 Non-Goal「不引入 dsh 客户端插件构建链」已失效，需重规划为在宿主源码声明层落地主题。
- 归档后验证 `openspec/specs/dsh-source-runtime/spec.md` 已由 delta 生成，`creative-dsh-host` 的运行时基线要求已更新。
