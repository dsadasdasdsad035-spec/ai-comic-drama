# Proposal

## Why

剧本、角色、素材、镜头表、提示词五个环节都在调用大模型，但给模型的提示词被拆成三层写死在代码里：`src/prompts.ts` 的 BASE、`src/knowledge.ts` 的规则包、以及各工作台 `generate()` 里的 inline prompt（例如 `ScriptBoard.tsx` 的“拆 N 集 / 每集 N 秒 / 画风”）。改一句提示词必须改代码、重新构建；`RulePack` 只能追加或停用，改不了主体。

同时，3D 工作台已经有唯一的多轮聊天入口，但提示词、工具、消息渲染、视频验收全部焊在 `SceneAgentChat` 和 `ZCodeChatModel` 里，其他工作台无法复用；`ZCodeChatModel` 甚至写死了“你是 3D 场景 agent”，把技能提示挤进了 user prompt。

现在要把提示词变成可编辑的技能数据，把聊天变成每个工作台都能挂载的能力，同时完整保留 3D 特有的 Blender 渲染、关键帧、视觉验收、MP4 验收和镜头隔离。

## What Changes

- 新增 `skills/` 技能目录与技能注册表：每个技能一个 `SKILL.md`，包含 frontmatter（名称、描述、环节、工具、输入、输出契约、版本）+ 可编辑正文 + 带占位符的输入模板 + 锁定契约。服务端加载，设置页可覆盖，内置文件与用户覆盖分层。
- **BREAKING** 五个工作台的提示词改为技能模板：BASE、inline 任务说明、规则包全部迁入技能文件；工作台控件（集数、目标时长、画风、画幅、本集内容等）成为模板输入。生成按钮与聊天使用同一套技能模板和输入来源，大输入在聊天中由读工具按范围读取。
- 新增通用 `SkillChat` 聊天壳，嵌在剧本、角色、素材、镜头表、提示词、3D 六个工作台内。每个线程只有一个可写技能（宿主技能）；其他技能只能只读加载，其写工具不绑定。
- 写工具只产生**草稿**，合并交给宿主工作台：复用现有 `mergeCharacters`、`mergeDesigns`、`mergeGenerated`、`mergeProjectShots` 等规则，保住手改字段和当前集范围；MUST NOT 直接覆盖项目。
- 读工具按边界取数：当前工作台的产物读**内存活草稿**，上游产物读**已保存项目**；MUST NOT 用已保存项目覆盖未保存草稿的判断。
- 线程按自然编辑范围持久化：剧本/角色/素材按项目，镜头表/提示词按项目+集，3D 按项目+镜头。只存文本、工具名、结果摘要和产物引用，不存帧图、brief 全文或代码全文。
- 3D 归位为 `scene3d` 技能：可编辑角色层 + 锁定 ABI/输出契约；`SceneAgentChat` 复用通用聊天壳。Blender 会话、`run_render` 试运行门禁、关键帧、视觉验收、MP4 验收、视频采用/重试、代码页签、镜头隔离全部保持不变。
- **BREAKING**（内部契约）`ZCodeChatModel` 通用化：移除写死的 3D 身份，技能正文成为真正的 system message，`set_scene_code` 的参数修正式移入对应工具。3D 的输出契约和行为不得回退。
- 设置页「技能规则包」升级为技能编辑：显示来源（内置文件/用户覆盖）、版本、恢复默认；锁定契约段只读。
- 非目标：不做全局单线程聊天（方案 A）；不新增项目级“创作备忘录”；不改各工作台现有保存语义（素材即时落库、剧本显式保存、3D 试运行通过才成草稿）；不新增 Blender、视频或渲染能力。

## Capabilities

### New Capabilities

- `skill-registry`: 技能文件格式、输入模板渲染、内置/用户覆盖分层、锁定契约、环节与工具声明、两级加载（描述常驻、正文与工具按需）、版本与来源审计。
- `workbench-chat`: 工作台内嵌聊天、宿主技能与只读技能、草稿写工具与宿主合并、活草稿/已保存项目的读取边界、线程键与持久化、上下文可见性、模型环节路由、失败与取消。

### Modified Capabilities

- `scene-agent-chat-ui`: 3D 聊天从独立实现变为通用聊天壳的一个 profile；关闭工作台释放沙箱但保留会话记录，重新打开同一镜头可继续；结构化消息、工具卡、关键帧、验收清单等既有行为不得回退。
- `scene-agent-runtime`: 3D 系统提示改由技能注册表提供（可编辑层 + 运行时追加锁定契约）；模型适配层不再携带 3D 身份；审计记录本轮使用的技能 id 与版本。

## Impact

- 代码：`src/prompts.ts`、`src/knowledge.ts`、`src/ScriptBoard.tsx`、`src/App.tsx`（拆角色）、`src/AssetBoard.tsx`、`src/ShotTable.tsx`、`src/PromptTable.tsx`、`src/agent/SceneAgentChat.tsx`、`sceneAgentGraph.ts`、`zcodeChatModel.ts`、`agentPrompt.ts`、`sceneCodePrompt.ts`、`src/chat-ui/*`、`src/Settings.tsx`、`server/*`（技能端点与线程表）。
- 数据：新增 `skills/` 内置技能文件；`AppSettings.rules` 迁移为技能覆盖（保留旧数据回退）；新增按项目/工作台/集/镜头的聊天线程存储。
- 接口：新增技能读取端点；文本模型代理仍走 `/api/text`，浏览器不持有渠道 Key。
- 兼容：旧项目数据不变；旧设置可迁移且不丢用户改写；3D 行为与产物格式不变；线程严格按项目隔离，不跨项目复用。
- 规格：两份新增能力，两份既有 3D 能力增量；角色/素材的既有合并规则继续适用，不修改其要求。
