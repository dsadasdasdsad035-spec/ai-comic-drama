# Tasks

## 1. 技能数据层（不碰聊天）

- [x] 1.1 建立 `skills/<id>/SKILL.md` 六个技能文件（script、character、asset、shotlist、prompt、scene3d），把 `src/prompts.ts`、`src/knowledge.ts` 与各工作台 inline prompt 的文本逐字迁入 `## 角色与约束` / `## 任务` 两节；用固定输入拼装并与旧常量逐字对比，golden 测试通过
- [x] 1.2 实现技能 frontmatter 与正文解析、字段校验（name/description/stage/runtime/tools/inputs/output/contracts/version）和可读错误；单测覆盖缺字段、未知占位符、未知契约、重复技能 id
- [x] 1.3 实现输出契约注册表与 `script-v1`、`characters-v1`、`designs-v1`、`shots-v1`、`prompts-v1`、`scene3d-code-v1` 校验器；单测覆盖合法/缺字段/类型错误，并验证 `scene3d-code-v1` 的锁定块包含完整 ABI
- [x] 1.4 实现输入模板渲染：一次性生成全量内联，聊天超过阈值时输出引用行；单测覆盖缺必需输入阻止发送、未知占位符、阈值两侧、同模板同输入在两种传输下核心提示词一致
- [x] 1.5 实现 `GET /api/skills` 与 `GET /api/skills/:id`，合并内置文件与覆盖；加入 id 正则、路径穿越、符号链接和 64KB 大小限制；API 测试覆盖正常读取、非法 id、超大文件、文件缺失
- [x] 1.6 新增 `skill_overrides` 表与保存/恢复默认接口，不写入 `AppSettings` JSON；测试覆盖保存、覆盖生效、恢复默认、内置版本变化时保留用户覆盖
- [x] 1.7 设置页「技能规则包」升级为技能列表与正文编辑器：显示来源、内置版本、锁定契约只读、恢复默认、差异提示；Playwright 覆盖查看、编辑、保存、恢复默认、旧数据迁移
- [x] 1.8 客户端一次性迁移旧 `AppSettings.rules`：有自定义文本时生成完整旧正文覆盖，未自定义则不生成；迁移幂等，测试断言旧文本逐字保留且不会重复迁移
- [x] 1.9 五个工作台的 `generate()` 改为读取技能、渲染输入并走契约校验，保留旧常量与 `skillPrompts` 开关；各阶段 golden prompt 逐字一致，且每个阶段用固定 mock 模型完成一次结构化输出校验
- [x] 1.10 为五个阶段各跑一次真实模型 smoke（剧本、角色、素材、镜头表、提示词），确认输出 JSON 结构、镜号/场次归属与合并结果与迁移前一致；记录模型与耗时
- [x] 1.11 编写技能作者文档：文件格式、两节结构、输入占位符、锁定契约、只读技能与写工具的区别；按文档新增一个临时只读技能并验证它能被列出和加载

## 2. 通用模型层、聊天壳与剧本聊天

- [x] 2.1 通用化 `ZCodeChatModel`：system role 使用技能正文 + 锁定契约，历史不再把 system 混入 user prompt；移除写死的 3D 身份与 `set_scene_code` 参数特判（修正式移入工具）；现有 agent graph 测试通过，并新增“技能正文出现在 system、不出现在 user 历史”的断言
- [x] 2.2 新增环节运行参数表（maxTokens/temperature）与输出契约校验入口；单测覆盖六个环节的默认值、覆盖值和非法输出
- [x] 2.3 从 `SceneAgentChat` 抽出 `ChatThreadShell`、`useAgentRun`、`ChatToolRegistry`，行为不变；现有聊天 UI 测试、工具卡测试、取消与页签切换测试全部通过
- [x] 2.4 实现 `json-tools` 运行器、工具注册表、技能激活（宿主 + 只读）与技能审计卡；mock agent 测试覆盖工具顺序、只读技能无写工具、模型建议加载需用户确认、事件去重
- [x] 2.5 新增 `chat_threads` 表与线程读写：按 project/surface/episode/shot 建键，保存文本/工具摘要/产物引用/技能状态，模型历史窗口裁剪；测试覆盖键隔离、项目隔离、恢复、运行中关闭标记取消、历史裁剪
- [x] 2.6 实现剧本 adapter：`inputs` 读取 source/logline/集数/时长/画风，`ownDraft` 读当前未保存分集，`applyDraft` 按 `no` 合并并保留未返回的集；单测覆盖新增/更新/保留/缺字段失败原子性
- [x] 2.7 在 `ScriptBoard` 挂载 `SkillChat`（feature flag），接上下文清单、技能来源/版本、发送前检查器；Playwright 覆盖发送、提交草稿、表格显示未保存、取消不落半份、重新打开恢复线程
- [x] 2.8 为剧本聊天补失败路径测试：技能文件缺失、模型调用失败、契约校验失败、用户取消；断言草稿保持前一版且聊天显示可恢复错误

## 3. 角色、素材、镜头表、提示词四个工作台与聊天 UI

- [x] 3.1 实现角色 adapter 与 `submit_characters`，复用 `mergeCharacters`；单测覆盖新增、补空字段、已有手改锚点保留、其他项目不受影响
- [x] 3.2 把拆角色逻辑从 `App.tsx` 收敛到 `CharacterBoard` 或通过 adapter 注入，并在角色工作台挂载 `SkillChat`；Playwright 覆盖原有拆角色按钮、聊天提交、保存，验证两条路径结果一致
- [x] 3.3 实现素材 adapter 与 `submit_designs`，复用 `mergeDesigns` 与现有即时落库语义；单测覆盖同名合并、关联镜号并集、手改锚点与图片保留、未参与旧卡不删除
- [x] 3.4 在 `AssetBoard` 挂载 `SkillChat`；Playwright 覆盖本集/全剧两个范围、聊天提交后卡片与关联镜号更新、切项目不串数据
- [x] 3.5 实现镜头表 adapter 与 `submit_shots`：按 `shot.id` 合并、只替换当前集、`mergeGenerated` 保留 `handEdited`；单测覆盖跨集同 `no` 不串、手改字段保留、场次回退与合并摘要
- [x] 3.6 在 `ShotTable` 挂载 `SkillChat`；Playwright 覆盖聊天提交、未保存提示、手改列保护、按集线程切换与恢复
- [x] 3.7 实现提示词 adapter 与 `submit_prompts`：先 `expandAnchors`，再按 `shot.id` 写回当前集，修正现有按 `no` 全局匹配的问题；单测覆盖占位符展开、残留占位符提示、两集同 `no` 不互相覆盖
- [x] 3.8 在 `PromptTable` 挂载 `SkillChat`；Playwright 覆盖生成按钮与聊天提交结果一致、缺锚点提示、未保存状态、按集线程
- [x] 3.9 只读技能跨工作台测试：在镜头表加载 `prompt`、在提示词加载 `character`，断言只出现读工具、写请求被拒绝、聊天卡片标明只读、用户可卸载
- [x] 3.10 五个工作台的读边界测试：当前产物有未保存手改时读工具返回草稿；上游产物读取已保存项目；移除可选附件后读工具返回不可用；移除必需输入阻止发送
- [x] 3.11 更新 README 的“技能规则包 / 聊天”章节：说明每个工作台的宿主技能、线程范围、草稿保存语义和只读技能限制；按文档逐条手动验证
- [x] 3.12 聊天 P0 修复：新增 `WORKBENCH_PROFILES`（标题、范围、空态、3 个示例、placeholder、保存模式），`SkillChat` 按 surface 渲染；头部显示助手名、范围和当前模型；空态/示例/placeholder 不再复用 3D 与剧本文案；示例只预填不发送；移除 assistant 消息里的技能横幅；五个工作台统一“助手”入口、运行/未保存状态和无项目禁用；Playwright 覆盖五个工作台的标题/范围/模型/空态/入口，并断言 3D 文案和剧本示例不再出现在其他工作台
- [x] 3.13 聊天 P1 层级与布局：头部 + 本轮上下文条（标出按范围读取的大输入）+ 轮次块（运行中字符数/完成/失败/已停止）+ 写回执（新增/更新/保留手改 + 显式/自动/立即保存）+ 全高“本轮发送内容”检查器（概览/系统提示/本轮任务/带入数据/读取权限，展示实际值、总规模和大输入引用）+ 可拖拽面板（默认 400，340–600，记忆宽度与开合；≥1440 首开、窄屏默认收起）+ ≤1180 抽屉 / ≤900 全屏 + 13/12/11 字号与代码 token；Playwright/视觉验收覆盖五工作台、日夜主题、窄屏不横向溢出、拖拽与键盘焦点
- [x] 3.14 聊天 UI 回归：只读技能加载/卸载、取消不落半份、失败可重试、线程恢复、3D 专用工具卡/验收清单/视频采用不回退；`workbench-chat` 新增的头部、空态、轮次、回执和布局场景逐条通过并记录证据

## 4. 3D 归位与整体验收

- [x] 4.1 注册 `scene3d` 技能：`## 角色与约束` 承接 `agentPrompt.ts`，锁定契约承接 `SCENE_CODE_ABI`、安全限制与工具协议，`## 任务` 承接验收要求；golden 测试断言角色层可编辑、ABI 与安全规则完整且不可被覆盖
- [x] 4.2 `SceneAgentChat` 改用 `ChatThreadShell` + `useAgentRun`，保留 `runSceneAgent`、Blender deps、`agentVideoAcceptance` 与专用工具卡；现有 `verify-agent-*` 测试全部通过，工具卡顺序、帧、验收清单、取消行为不变
- [x] 4.3 3D 线程按镜头持久化：关闭工作台释放沙箱并标记运行取消，重新打开恢复消息、工具摘要、技能状态和已保存视频/代码引用；Playwright 覆盖关闭/重开、运行中关闭、历史帧不可用占位
- [x] 4.4 一次性代码生成 `sceneCodeJob` 改用 `scene3d` 技能的契约与 ABI；验证同一输入的代码提示词与旧版逐字一致，真实模型生成仍能通过试运行
- [x] 4.5 删除旧 3D 身份前导、重复聊天壳、旧提示词常量与 feature flags；全仓检索确认无残留引用，构建、类型检查、现有测试全部通过
- [x] 4.6 整体验收：五个阶段的 golden prompt 与真实模型 smoke、六个工作台的聊天 Playwright、3D 的 `verify-agent-*`、线程持久化与项目隔离测试一起跑；逐项记录通过/失败，失败项回到对应任务修复
- [ ] 4.7 更新 README 与设置页说明：技能来源/版本/覆盖、锁定契约、3D 线程恢复、只读技能边界、聊天入口与面板宽度/窄屏行为、保存回执语义；按文档完成一次从剧本到 3D 的完整生产流程并记录耗时与产物
  - 2026-10-24：README/设置页说明已完成；五阶段真实文本 smoke 通过；真实 3D 在 MiniMax/DeepSeek/Kimi/豆包上分别停在视觉验收、总时长、运行错误；mock 3D 全链路通过。详见 `evidence/full-flow.md`，4.7 保持未完成。

## Workflow follow-up

- 在项目评审通过后运行 `/opsx:sync` 同步规格，再运行 `/opsx:archive` 归档本变更。
- 归档前确认 `skill-registry` 与 `workbench-chat` 的主规格 Purpose 已生成，且 `scene-agent-chat-ui` / `scene-agent-runtime` 的增量已合并。
