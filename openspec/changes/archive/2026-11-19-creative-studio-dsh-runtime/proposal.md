# Proposal

## Why

创意工作室当前的对话能力由自建的 Pi 运行时驱动：`src/agent/pi/*` 负责模型循环与工具调度，`server/creative.mjs` 用自己的 SQLite 表保存会话，前端还要维护三列布局、能力托盘、专家设置页与工具卡片渲染。这条链路把「代理运行时」的长期成本留在了项目里，而它并不是本项目的差异化价值。

DeepSeek Harness（下称 dsh）已经提供了成熟的会话运行时、压缩、审批、技能发现、preset 与 Web 对话外壳。把创意会话的前后端换成 dsh，可以让创意工作室只保留自己的领域能力：专家人格、技能包与 52 个平台/创意工具，运行时交给上游维护。

## What Changes

- 创意视图改为嵌入 dsh 的 Web 对话外壳：应用内以 `/studio/` 反代挂载，保留全局导航位置与两套主题的观感一致；不再维护创意专属三列布局、能力托盘、消息卡片与工具 UI。
- 会话运行时由 dsh 引擎承担：会话创建/恢复、流式事件、取消、审批与追问、工具结果裁剪与上下文自动压缩全部使用 dsh 行为。
- **BREAKING** 现有 Pi 运行时不参与创意会话：`runStageAgent`、`src/agent/pi/*` 与创意会话解耦，其它聊天继续使用现有统一运行时。
- **BREAKING** 会话存储迁移到 dsh 的 JSONL 会话目录；`creative_sessions` / `creative_threads` 不再作为创意会话的事实来源，旧会话不迁移、不保证可打开。
- 52 个平台与创意工具改为 dsh 宿主插件注册：参数 schema 仍为唯一来源，保留「模型可见摘要 / 界面可见详情」的分离，保留契约校验与费用确认。
- 专家改为 dsh preset + persona：专家 soul 落为 persona，`skillIds` / `toolIds` 落为 preset 的工具子集与技能根目录白名单；专家的增删改查改由 dsh 设置页承担。
- 技能继续使用仓库现有 `SKILL.md` 包，改为通过文件系统根目录被 dsh 发现并热加载，不再由前端拼装技能上下文。
- 模型选择与计费改由 dsh 模型配置指向项目代理暴露的 OpenAI 兼容端点，保留现有预扣/结算与渠道路由；创意视图不再提供独立文本模型下拉。
- 运行时基线升级到 Node 24（dsh 要求 `>=24.9.0`），服务端打包目标与桌面端内置运行时同步升级。

## Capabilities

### New Capabilities

- `creative-dsh-host`: 创意视图的 dsh 宿主契约——反代挂载、启动引导与鉴权交接、进程生命周期、会话与媒体目录、模型网关映射、主题与导航一致性。
- `dsh-tool-bridge`: dsh 宿主插件工具桥——工具注册与 schema 单一来源、模型可见/界面可见结果分离、审批与追问映射、专家 preset 与技能根的运行时约束、费用确认。

### Modified Capabilities

- `chat-agent-runtime`: 统一运行时条款需要为创意工作室开一个显式例外——创意会话由 dsh 运行时驱动，不再要求「任何聊天都必须走同一个 Pi 循环」。
- `creative-chat`: 文本模型选择从创意头部下拉与 `stageModels.creative` 改为 dsh 模型配置；专家/无专家双模式改为 preset 选择。
- `creative-experts`: 专家定义、持久化、工具与技能白名单、导入导出改为 dsh preset/persona 与文件系统技能根，管理入口迁到 dsh 设置页。
- `creative-thread-context`: 取消「历史永不裁剪、永不压缩」的绝对约束，改为接受 dsh 的自动压缩与工具结果裁剪，并要求压缩对用户可见、可追溯。
- `creative-layout`: 三列布局、产物栏、媒体摄取控件、会话列表与会话头部条款随外壳替换而收敛为「嵌入 dsh 外壳 + 两套主题 + 导航稳定」。
- `theme-switching`: 两套主题的覆盖范围需要包含 dsh 外壳内部，日间/夜间在 `/studio/` 内同样达到对比度与层级要求。

## Impact

- 代码：新增 dsh 宿主与工具桥插件（宿主进程、preset 与 persona 生成、技能根配置）；移除创意视图的 `CreativeStudio` 三列壳、能力托盘、专家设置页与创意工具卡片；`server/app.ts` 增加 `/studio/` 反代与启动管理。
- 存储：新增 dsh 会话目录与 `$DSH_HOME`；创意媒体仍留在 `creatives/<sessionId>/`，由工具桥以文件路径访问。
- 依赖：新增 `@deepseek-ai/dsh-*` 运行时与客户端包；`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai` 与 `@assistant-ui/react` 在创意视图内不再使用（其它聊天是否保留另行确认）。
- 运行时：Node 基线升到 24；`build:server` 的 esbuild target、Electron 内置 Node 与打包产物同步调整。
- 计费：dsh 的模型调用必须经现有代理与账本，避免绕过预扣/结算；需要 OpenAI 兼容门面与模型键映射。
- 部署：单实例、单操作员，`/studio/` 由 nginx 反代并继承现有 basic auth 与 token 引导；需要处理 WebSocket/SSE 长连接与超时。
- 兼容性：旧创意会话不可读（已确认不做迁移）；旧专家自定义数据需要一次性导出为 preset 才能继续使用。
