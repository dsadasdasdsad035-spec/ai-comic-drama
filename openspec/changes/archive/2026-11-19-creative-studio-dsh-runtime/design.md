# Design

## Context

见 `proposal.md`「Why」。影响设计取舍的现状：

- 服务端是单进程 Node HTTP 服务（`server/app.ts` + `server/index.mjs`），已承担模型代理、账本、项目数据与媒体文件；创意会话目前另有一套 `server/creative.mjs`（SQLite + 本地媒体目录）。
- 创意工具实现分散在 `src/creative/tools.ts`、`src/creative/expertTools.ts` 与服务端 `/api/creative/*`、`/api/text` 等端点，前端 Pi 运行时（`src/agent/pi/*`）在浏览器内驱动模型循环。
- 专家是 `experts/<id>/manifest.json` + `soul.md` 的静态目录加 SQLite 自定义表；技能是仓库 `skills/**/SKILL.md` 文件包。
- dsh 是 Cordis 插件组合，`dsh web` 通过 `window.__DSH_BOOT__` 注入启动清单，会话以 JSONL 追加写盘；其 Web 前端不是可嵌入的 React 组件库。
- 部署为单实例单操作员，前置 nginx 已有 basic auth；当前运行时 Node 22，dsh 要求 `>=24.9.0`。

## Goals / Non-Goals

**Goals:**

- 以最小自有代码把创意会话迁到 dsh 运行时与外壳，同时完整保留 52 个工具、专家人格与技能包。
- 模型调用仍经现有代理与账本，计费口径不变。
- 同源 `/studio/` 访问，主题与全局导航观感一致。
- 迁移可按阶段回滚：旧创意链路在新链路验收前保持可用。

**Non-Goals:**

- 不 fork 或改造 dsh 的 `packages/client/ui-*` 组件，不做创意专属 UI。
- 不迁移旧创意会话与旧 SQLite 线程记录。
- 不改动工作台聊天的既有 Pi 运行时与事件契约。
- 不为 dsh 引入多用户隔离或多租户沙箱。

## Decisions

### 决策 1：dsh 以子进程运行，应用反代 `/studio/`

应用在启动时以仅监听 loopback 的端口拉起 `dsh web`，并把 `/studio/`（含子路径与长连接）反代到该端口；`--public-url` 设为外部可见的 `/studio/` 基址，`--trusted-host` 填部署域名。宿主进程由服务端托管生命周期：启动就绪探测、崩溃重启上限、退出时优雅关闭。

- 备选 A：把 dsh 宿主库直接 import 进 `server/app.ts`。否决：Cordis 生命周期与 profile/patch 装配侵入现有服务启动流程，升级时耦合面过大。
- 备选 B：另开端口并让浏览器直连。否决：需要第二套鉴权与额外暴露面，且同源策略下主题与导航无法统一。
- 备选 C：iframe 指向独立 dsh 部署。否决：仍是第二套鉴权与端口，且跨源限制影响主题注入与深链接。

引导令牌由服务端在服务端侧换取并注入壳页面，浏览器不接触明文令牌。

### 决策 2：前端只保留入口与主题桥，不 fork dsh 外壳

创意视图的应用侧代码收敛为：一个承载 `/studio/` 的容器、主题同步、以及宿主不可用时的错误态。主题通过在壳页面注入 CSS 变量映射（应用语义 token → dsh `--dsw-*` token）实现，两套主题切换时重写同一组变量；不使用 shadow DOM，避免样式无法继承。需要改动外壳内部结构时，优先用 dsh 的客户端插件与槽位，不改上游源码。

- 备选：把 dsh 外壳编译进应用并替换其 UI 包。否决：dsh 明确不提供可嵌入组件 API，fork 后每次上游升级都要手工合并。

### 决策 3：工具以独立 host plugin 注册，实现仍走本地 HTTP

新增 `creative-tools` 宿主插件：把现有工具定义编译为 dsh 工具注册项，参数 schema 由现有唯一来源生成 JSON Schema；执行时调用应用本地 loopback 接口（复用 `/api/creative/*`、`/api/text`、项目与媒体接口），携带内部令牌。工具返回值统一为「模型可见摘要 + 界面可见详情」双份结构，界面详情由外壳工具卡片渲染。

- 备选：把工具实现整体搬进 dsh 进程。否决：会复制数据库访问、文件布局与计费逻辑，形成第二份事实来源。
- 备选：保留浏览器侧 Pi 工具执行，dsh 只做展示。否决：会话运行时在宿主进程内，跨进程回调会让取消与审批语义失真。

### 决策 4：模型经应用代理的 OpenAI 兼容门面接入

应用在 loopback 上暴露 OpenAI 兼容的 `/v1/chat/completions`（含流式与原生 function calling），dsh 的模型配置指向该端点，模型键经映射表还原为应用内部渠道与模型。预扣、结算、余额校验仍在代理侧完成；余额不足与渠道错误以 OpenAI 兼容错误体返回，由宿主呈现。

- 备选：让 dsh 直连 APIMart。否决：绕过账本与预扣，无法计费，也无法统一渠道能力判定。
- 备选：为 dsh 写自定义 provider 插件。否决：多一层上游私有协议适配，OpenAI 兼容门面更稳定且可被其它客户端复用。

### 决策 5：专家编译为 preset + persona，技能白名单落为独立根目录

启动时把内置 `experts/<id>/` 与自定义专家编译为 dsh preset 与 persona（persona 使用 `complete: true`，soul 只做占位符替换），工具子集来自 `toolIds`，默认专家使用全量工具。技能侧为每个专家生成只含白名单技能包的根目录（复制或链接），`skillIds: ["*"]` 直接指向共享技能根；技能热加载由宿主文件监听承担。

- 备选：运行时在工具层做白名单拦截。否决：宿主在发现阶段就决定可读技能，运行时拦截会让模型看到不可读技能。
- 备选：把专家继续存 SQLite 并由应用侧注入 system。否决：与「管理入口迁到宿主设置页」的目标冲突。

### 决策 6：会话目录与媒体目录分离

`DSH_HOME` 指向应用数据目录下的 `dsh/`，会话 JSONL 与宿主配置都在其中；创意媒体继续留在 `creatives/<sessionId>/`，工具以绝对路径引用。旧 `creative_sessions` / `creative_threads` 停止写入，保留只读一个版本周期后删除。

### 决策 7：Node 24 基线随应用分发

服务端与桌面端内置运行时升级到 Node 24；dsh 以普通依赖安装（不 bundle，保留其包结构与动态导入），打包时校验 `node_modules` 完整性。启动自检校验 `process.versions.node`，不达标直接失败并提示所需版本。

### 决策 8：宿主依赖按 web profile 裁剪，桌面端不带全量

实测全量 `@deepseek-ai/*` 为 1.1 GB / 340 个包，其中 LibreOffice 套件（`libreoffice-kit-darwin-arm64` + `libreoffice-kit-wasm`）占 301 MB，由 `dsh-sdk-app → dsh-office-kit` 带入，`dsh web` 组合并不使用；移除这两个包后宿主仍能启动、壳页面可取（已用宿主冒烟测试验证）。

因此：服务端与镜像装全量（1.1 GB 在服务端可接受）；桌面端打包时按白名单裁剪，至少剔除 LibreOffice 套件与 `dsh-experimental-*`，并把宿主冒烟测试作为打包门。不采用「桌面端复用服务端依赖」，因为桌面端需要离线启动。

- 备选：桌面端只装 dsh 的最小依赖子集。可行但需要维护一份与上游 composition 同步的白名单，升级时要复查，故先按「全量 + 裁剪重包」处理。

## Risks / Trade-offs

- [dsh 仍为 rc 版本，插件与协议可能变更] → 锁定精确版本；为宿主启动、工具注册、模型网关各写一份契约测试；升级单独立项。
- [反代长连接（SSE/WebSocket）被缓冲或超时] → 反代关闭响应缓冲、显式设置长连接超时与心跳透传；为断流提供重连与可读提示。
- [工具桥双跳增加延迟与失败面] → 仅走 loopback，设置单工具超时与有限重试；工具失败按契约返回可读错误而不是中断整轮。
- [模型选择出现两个来源（宿主设置 vs `stageModels.creative`）] → 明确三级解析顺序，并在网关侧兜底；界面上只保留宿主一处入口。
- [技能根按专家复制导致磁盘冗余与热加载不同步] → 优先使用目录链接；监听共享技能根变化并刷新专家根，避免复制正文。
- [旧创意入口与旧会话数据在切换期造成混淆] → 用开关灰度，开关关闭时隐藏 `/studio/` 入口；旧表只读且界面明确提示不可打开旧会话。
- [Node 24 升级影响 Electron 与打包产物] → 先升级服务端与 CI，再升级桌面内置运行时；保留上一版本安装包用于回滚。

## Migration Plan

1. **M0 验证**：在隔离目录跑通 `dsh web` 反代、工具注册、preset/persona、主题注入与流式模型网关五项最小验证，锁定版本。
2. **M1 工具桥**：实现 `creative-tools` 插件与 OpenAI 兼容门面，用真实工具做契约测试；此时创意入口仍走旧链路。
3. **M2 专家与技能**：编译器把专家目录转 preset/persona，技能根生成与热加载验证；导出旧自定义专家为包。
4. **M3 切换**：开关打开后 `/studio/` 指向 dsh 外壳，旧创意视图保留但隐藏；观察一周。
5. **M4 清理**：删除旧创意前端、Pi 创意分支与 `server/creative.mjs` 写入路径，移除旧表。

回滚：M3 期间开关可立即切回旧链路；M4 之后回滚需回退版本并恢复旧表备份。

## Open Questions

- `@assistant-ui/react` 在创意视图移除后是否仍被其它聊天使用，决定该依赖是否可删。
- 旧创意会话是否需要「只读导出为 Markdown」作为补偿，可在 M4 前根据实际使用情况决定。
