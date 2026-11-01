# Proposal

## Why

分镜、剧本、提示词等 Agent 的「画风」与「目标时长」来自多处本地 state 与硬编码兜底（例如空画风时静默替换为「近未来科幻写实」、剧本顶栏 75 秒与镜头表 60 秒互不一致且多数不落盘）。用户要求画风只在项目设置维护，每集成片目标时长各不相同并持久化在分集上，聊天任务卡与进度条 MUST 反映同一真相源。

## What Changes

- 新增 **项目制作参数** 编辑入口（画风 `style`、画幅 `aspect`），作为全片画风锁的唯一权威写入面；各工作台与 Agent 只读项目字段，**MUST NOT** 在聊天 adapter 中用硬编码画风兜底。
- 在 `episodes[]` 上持久化 **`targetSeconds`（每集目标时长）**；集与集可不同。剧本页与镜头表顶栏均可编辑当前集（或分集卡片上的）目标时长，写入同一字段。
- **BREAKING（行为）**：移除剧本顶栏「全剧一个每集目标时长」作为 shotlist/script 的唯一时长来源；`shotlist` 任务卡的 `target` 来自 **当前集** 的 `targetSeconds`。
- 调整 **script** 技能与 `script-v1` 示例：拆集输出每集带 `targetSeconds`；合并剧本草稿时若 incoming 未带该字段则 **保留** 已有分集上的 `targetSeconds`。
- 画风未设置时：Agent 发送前 **阻止** 并提示去项目设置补全（不再静默默认画风）。
- 老项目无 `episodes[].targetSeconds`：读取时用可文档化的占位默认（仅 UI/解析，不批量写盘），直到用户保存或编辑某一集。

## Capabilities

### New Capabilities

- `project-production-settings`: 当前项目的画风与画幅在项目设置（或等价的项目管理入口）中编辑、保存与全站只读消费。
- `episode-target-duration`: 每集 `targetSeconds` 的持久化、解析、剧本/镜头表编辑、与分镜/剧本 Agent 任务输入及镜头表进度对齐。

### Modified Capabilities

- `project-context`: 明确制作参数（画风、画幅）属于项目级上下文，切换项目时重载；剧本保存不再隐含为画风唯一写入路径。
- `script-workbench`: 顶栏不再提供「全剧每集目标时长」作为拆集唯一参数；分集结构展示并编辑每集 `targetSeconds`。
- `workbench-chat-context`: 工作台技能输入中的画风与目标时长 MUST 来自项目/分集持久字段，MUST NOT 注入未在项目/分集声明的隐藏默认值（画风空则阻止发送）。

## Impact

- 数据：`ProjectEpisode.targetSeconds`；`ProjectData.style` / `aspect` 写入路径集中化。
- 前端：项目设置或项目管理 UI、`ScriptBoard.tsx`、`ShotTable.tsx`、`PromptTable.tsx`、`src/intake/intakeSkill.ts`；移除分散的 `近未来科幻写实` fallback。
- 共享逻辑：新增 `productionContext`（或等价）解析函数；`mergeScriptDraft` 保留分集 `targetSeconds`。
- 技能：`skills/script/SKILL.md`、`skills/shotlist/SKILL.md` 文案与示例；`script-v1` 契约示例可选字段。
- 测试：更新 verify-workbench-* / skill-prompts 中对硬编码画风与 60/75 的假设。
