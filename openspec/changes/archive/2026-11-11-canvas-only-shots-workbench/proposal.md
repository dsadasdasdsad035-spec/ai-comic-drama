# Proposal

## Why

分镜目前同时存在两个编辑面：镜头表负责「一屏扫全集、按行改字段」，画布负责「单镜出图出片与转场」。两条路径各自维护草稿与保存语义，导入只落在镜头表草稿里，用户还要再点一次「生成到画布」才能在画布上看到结果；空首帧又会拦住推送，导入完常常画布还是空的。既然产镜主路径已经收敛到 Agent、单镜编辑已经由 Inspector 承担，保留整张可编辑表格只会制造第二份草稿和第二次搬运。

## What Changes

- **BREAKING（导航）**：移除顶栏「镜头表」视图与 `ShotTable` 主入口；`project.shots` 仍是分镜真源，但不再提供「一屏全集、按行编辑字段」的表格界面。
- **BREAKING（编辑面）**：分镜字段的人手编辑只保留画布单镜面（Inspector、Timeline、转场面板）与 Agent；镜号、时长、景别、运镜、描述、台词、表演、首帧/视频提示词不再有表格内批量编辑。
- **导入迁到画布**：画布提供「导入」入口，复用现有解析、预览、行级合并与「按此文件替换整集」语义；确认后 MUST 直接写入 `project.shots`（不再停留为工作台草稿）。
- **导入/写回即水合**：导入确认与 Agent `submit_shots` / `submit_joins` 写回后，系统 MUST 立即把当前集镜头水合到画布节点与顺序连线，并 `fitView`；「生成到画布」按钮退役。
- **空首帧允许上画布**：水合画布 MUST NOT 因 `keyframe_prompt` 为空而拒绝或跳过镜头；出图/出片仍要求可用的画面提示词，由 Inspector 与批量出图入口各自拦截。
- **集级能力迁入画布**：集目标时长编辑、整集摘要（镜数、总时长 vs 目标、缺首帧/缺锚点计数）、批量补齐锚点移到画布上下文带或画布工具条。
- **增删镜走正式镜头**：画布新增/插入/删除镜头 MUST 产出或移除带 `shotId` 的正式 `project.shots` 行（含镜号唯一校验、删除时清 `transition_out` 与相关连线），不再只建无业务 ID 的实验卡。
- **接缝留在画布**：相邻镜接缝只通过边与转场面板（`transition_out`）编辑；不恢复表内接缝行。
- **Agent 常驻画布**：画布承载 `shots` 聊天（`shotlist` 拆镜、`submit_shots`、`submit_joins`、`prompt` 只刷提示词），线程仍按项目 + 集。
- **文档与验收**：工作台导航、README、设置页环节说明与导入相关 verify 脚本从「镜头表」改指画布。

明确不做：

- 不删除 `project.shots` 数据模型或 `shots-v1` / `prompts-v1` / `joins-v1` 契约。
- 不改画布现有出图、出片、转场生成、连播与导出能力。
- 不为「无表格」保留隐藏的只读表格或抽屉式表格。
- 不在此变更内重做 Inspector 的信息架构；只补足无表格后缺失的集级操作与镜头生命周期动作。

## Capabilities

### New Capabilities

- `canvas-shots-workbench`: 画布作为分镜序列的唯一工作台：导入入口与落库即水合、空首帧可上画布、单镜编辑的唯一人手入口、集级摘要与目标时长、正式镜头的增删插、以及画布内 Agent 拆镜与接缝写入。

### Modified Capabilities

- `shots-workbench`: 需求从「镜头表展示并编辑提示词列 / 从镜头表推画布」收敛为「Agent 经 `shotlist` 产出一集镜头与两列提示词并写回项目」，删除表格展示、表格锚点状态与推画布按钮相关要求。
- `manual-row-editing`: 镜头的新增、插入、删除动作从镜头表迁到画布；保留镜号集内唯一、删除为显式确认、删除清理 `transition_out` 与画布节点的语义。
- `workbench-text-intake`: 镜头导入入口从镜头表改为画布；确认应用即写入项目并水合画布；预览与行级合并语义不变；明确空首帧不阻止水合。
- `workbench-shell`: 顶栏项目视图导航移除「镜头表」；分镜相关的集上下文、目标时长与提示词编辑位置改到画布；每个视图一个强调操作等约束随之调整。
- `project-context`: 「全站可见的项目选择」等条款中枚举的视图列表不再含镜头表，画布成为分镜的唯一项目级编辑面。

## Impact

- **前端**：`src/App.tsx`（视图导航、`view === 'table'` 分支、导入与 Agent 挂载、`pushShotsToCanvas` 与 `buildShotNodes` 的空首帧规则、正式镜头增删）、`src/ShotTable.tsx` 及其子组件（`ShotTableJoinRow`、`shotTableUx.ts`、`shotRows.ts` 的归属）、`src/intake/IntakeDialog.tsx` 的宿主状态来源、`src/theme.css` 表格样式清理。
- **Agent / 技能**：`src/agent/workbenchChat.ts` 的 `shots` profile 与内置动作、`src/agent/SkillChat.tsx` 挂载位置、`src/agent/WorkbenchChatAside.tsx` 的 `data-shots-chat` 宿主、`skills/shotlist`、`skills/prompt-intake`、`skills/transition-planner`。
- **数据**：`project.json` 结构不变；导入从「草稿」改为落库，需要幂等写入与失败回滚。
- **既有进行中变更**：`shot-table-transition-joins`（接缝 UI 锚点在表行）、`skill-driven-workbench-chats`、`workbench-chat-builtin-actions` 均假设镜头表存在，需在归档前对齐或改锚点。
- **文档与验收**：`README.md` 工作台章节、`verify-text-intake.mjs`、`verify-workbench-chats.mjs`、`verify-workbench-builtin-actions.mjs`、`verify-workbench-builtin-real.mjs`、`verify-stage-models-ui.mjs`、`verify-shot-inspector.mjs` 等；设置页「镜头表（拆镜）」标签。
